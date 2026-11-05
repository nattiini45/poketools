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
import type { FormatOp } from '@/lib/supabase/queries/format-runtime';

export type { FormatOp };

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

export interface RuntimeCheck {
  id: string;
  source: 'unresolved_outcome' | 'standings_tie' | 'pairing_rematch' | 'pairing_forbidden' | 'deadline_missed' | 'expr';
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
