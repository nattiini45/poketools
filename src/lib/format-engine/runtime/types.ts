/**
 * The runtime state of a custom format as plain JSON, and the shapes the pure runtime modules share. The state is the
 * season's `format_*` rows reshaped for lookups (`buildRuntimeState`); the planners read it and never write it: a
 * change is a `FormatOp` that the database applies (`format__apply_ops`). Client-safe: no I/O, no clock.
 *
 * The state holds every relation link, hidden sides included, so it is for the server and for admins. What a player
 * may see goes through `visibleLinks` first.
 */
import type { Json } from '@/types/database';
import type { DomainEntry } from '@/lib/format-kit/types';

/**
 * The op vocabulary `format__apply_ops` applies in order (the SQL function is its twin). The planner produces it;
 * a member the database does not know raises `invalid_op`.
 */
export type FormatOp =
  | { op: 'set_flag'; key: string; value: Json }
  /** Inserts the links only when the relation has none yet; otherwise a no-op. */
  | { op: 'set_relation'; relation: string; links: { from: string; to: string }[] }
  | { op: 'reveal_relation'; relation: string }
  | {
      op: 'grant_item';
      resource: string;
      player_id: string;
      item_id: string | null;
      amount: number;
      exclusive: boolean;
      source: 'event' | 'adjustment';
      source_ref: string | null;
    }
  /**
   * Removes `amount` units of the matching rows, oldest first. An inverse of a logged grant carries that grant's `source` and
   * `source_ref`: the rows it wrote are taken first.
   */
  | { op: 'revoke_item'; resource: string; player_id: string; item_id: string | null; amount: number; source?: string; source_ref?: string | null }
  | { op: 'set_attr'; player_id: string; attr: string; value: Json; source: string }
  | { op: 'adjust_points'; stage: string; player_id: string; points: number; reason: string }
  | { op: 'open_action'; action: string }
  | { op: 'lock_action'; action: string }
  /** Only ever raises the step. */
  | { op: 'set_track'; track: string; player_id: string; step: number };

export type AttrValue = string | number | boolean;
/** A resolved tunable: a number[] only for a table, a Key for an enum. */
export type TunableValue = number | boolean | string | number[];

export interface RuntimeLink {
  relation: string;
  from: string;
  to: string;
  revealed: boolean;
}

export interface RuntimeItem {
  id: string;
  resource: string;
  player_id: string;
  item_id: string | null;
  amount: number;
  exclusive: boolean;
  source: 'event' | 'action' | 'adjustment';
  source_ref: string | null;
}

/** One pick of an action: the 0-based step of the action and the domain entry id. */
export interface ActionPick {
  step: number;
  item_id: string;
}

export interface RuntimeSubmission {
  id: string;
  action: string;
  actor: string;
  target: string | null;
  status: 'draft' | 'submitted' | 'locked';
  picks: ActionPick[];
}

/** A `points` or `rank` row of `format_adjustments`, the two kinds the standings read. */
export interface RuntimeAdjustment {
  id: string;
  kind: 'points' | 'rank';
  target: Json;
  delta: Json;
  created_at: string;
}

/**
 * Every source a `format_checks` row can carry: the single list the state whitelist, the query types and the migration's
 * CHECK (`format_checks_source_check`) are all held to (a test compares it with the migration).
 */
export const FORMAT_CHECK_SOURCES = [
  'unresolved_outcome',
  'standings_tie',
  'pairing_rematch',
  'pairing_forbidden',
  'deadline_missed',
  'team_audit',
  'expr',
] as const;

export interface RuntimeCheck {
  id: string;
  source: (typeof FORMAT_CHECK_SOURCES)[number];
  rule_id: string;
  dedupe_key: string;
  subject: Json;
  status: 'open' | 'confirmed' | 'rejected';
  note: string | null;
}

/** An admin's change to a domain's entry list (`season_formats.amendments` holds them in order). */
export interface DomainAmendment {
  domain: string;
  add?: DomainEntry[];
  remove?: string[];
}

export interface KitRuntimeState {
  flags: Record<string, Json>;
  links: RuntimeLink[];
  items: RuntimeItem[];
  submissions: RuntimeSubmission[];
  attrs: Record<string, Record<string, AttrValue>>;
  tracks: Record<string, Record<string, number>>;
  adjustments: RuntimeAdjustment[];
  checks: RuntimeCheck[];
  firedEventKeys: string[];
  tunables: Record<string, TunableValue>;
  amendments: DomainAmendment[];
}

export function emptyRuntimeState(): KitRuntimeState {
  return {
    flags: {},
    links: [],
    items: [],
    submissions: [],
    attrs: {},
    tracks: {},
    adjustments: [],
    checks: [],
    firedEventKeys: [],
    tunables: {},
    amendments: [],
  };
}

/** An own property of a record keyed by user-chosen keys (`constructor` is ordinary data, never the prototype's). */
export function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

/** The points of the advancement row a player expression reads; a missing field is 0. */
export type PlayerRow = Readonly<Partial<Record<'points' | 'wins' | 'losses' | 'games_played' | 'rank' | 'group_rank' | 'faints_dealt' | 'faints_taken' | 'kill_differential' | 'buchholz', number>>>;

/** A problem a planner met and skipped; the caller logs it. Codes and params only. */
export interface RuntimeIssue {
  code: string;
  rule?: string;
  detail?: string;
}
