/**
 * Reshapes the rows of a league's `format_*` tables into the `KitRuntimeState` the planners read, and parses the
 * stored amendments. A row or value that does not parse is dropped rather than trusted. Pure: it gets the rows from the
 * caller (`getFormatRuntime`) and does no I/O.
 */
import type { FormatRuntime } from '@/lib/supabase/queries/format-runtime';
import type { Json } from '@/types/database';
import type { DomainEntry, FormatDefinition } from '@/lib/format-kit/types';
import { resolveTunables, type TunableIssue } from './tunables';
import {
  FORMAT_CHECK_SOURCES,
  emptyRuntimeState,
  type ActionPick,
  type AttrValue,
  type DomainAmendment,
  type KitRuntimeState,
  type RuntimeCheck,
  type RuntimeItem,
  type RuntimeSubmission,
} from './types';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function parseEntry(raw: unknown): DomainEntry | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  const attrs = Array.isArray(raw.attrs)
    ? raw.attrs.flatMap((a) =>
        isRecord(a) && typeof a.key === 'string' && (typeof a.value === 'string' || typeof a.value === 'number' || typeof a.value === 'boolean' || (Array.isArray(a.value) && a.value.every((v) => typeof v === 'string')))
          ? [{ key: a.key, value: a.value as string | number | boolean | string[] }]
          : [],
      )
    : [];
  return { id: raw.id, attrs };
}

/** The stored `season_formats.amendments` array; an entry that is not an amendment is dropped. */
export function parseAmendments(stored: Json | undefined): DomainAmendment[] {
  if (!Array.isArray(stored)) return [];
  const out: DomainAmendment[] = [];
  for (const raw of stored) {
    if (!isRecord(raw) || typeof raw.domain !== 'string') continue;
    const add = Array.isArray(raw.add) ? raw.add.flatMap((e) => parseEntry(e) ?? []) : undefined;
    const remove = Array.isArray(raw.remove) ? raw.remove.filter((id): id is string => typeof id === 'string') : undefined;
    out.push({ domain: raw.domain, ...(add !== undefined ? { add } : {}), ...(remove !== undefined ? { remove } : {}) });
  }
  return out;
}

function parsePicks(raw: Json): ActionPick[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p) => (isRecord(p) && typeof p.step === 'number' && typeof p.item_id === 'string' ? [{ step: p.step, item_id: p.item_id }] : []));
}

const SUBMISSION_STATUSES: ReadonlySet<string> = new Set(['draft', 'submitted', 'locked']);
const ITEM_SOURCES: ReadonlySet<string> = new Set(['event', 'action', 'adjustment']);
const CHECK_SOURCES: ReadonlySet<string> = new Set(FORMAT_CHECK_SOURCES);
const CHECK_STATUSES: ReadonlySet<string> = new Set(['open', 'confirmed', 'rejected']);

export interface BuiltRuntimeState {
  state: KitRuntimeState;
  tunableIssues: TunableIssue[];
}

/** The state of a league: its rows, the resolved tunables (`season_formats.tunables`) and the domain amendments. */
export function buildRuntimeState(
  def: Pick<FormatDefinition, 'tunables'>,
  runtime: FormatRuntime,
  stored: { tunables: Json | undefined; amendments: Json | undefined },
): BuiltRuntimeState {
  const state = emptyRuntimeState();

  for (const row of runtime.flags) state.flags[row.key] = row.value;
  state.links = runtime.relationLinks.map((row) => ({
    relation: row.relation_key,
    from: row.from_player_id,
    to: row.to_player_id,
    revealed: row.revealed_at !== null,
  }));
  state.items = runtime.resourceItems.flatMap((row): RuntimeItem[] =>
    ITEM_SOURCES.has(row.source)
      ? [
          {
            id: row.id,
            resource: row.resource_key,
            player_id: row.player_id,
            item_id: row.item_id,
            amount: row.amount,
            exclusive: row.exclusive,
            source: row.source as RuntimeItem['source'],
            source_ref: row.source_ref,
          },
        ]
      : [],
  );
  state.submissions = runtime.actionSubmissions.flatMap((row): RuntimeSubmission[] =>
    SUBMISSION_STATUSES.has(row.status)
      ? [
          {
            id: row.id,
            action: row.action_key,
            actor: row.actor_player_id,
            target: row.target_player_id,
            status: row.status as RuntimeSubmission['status'],
            picks: parsePicks(row.picks),
          },
        ]
      : [],
  );
  for (const row of runtime.playerAttrs) {
    const value = row.value;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    const forPlayer: Record<string, AttrValue> = Object.prototype.hasOwnProperty.call(state.attrs, row.player_id) ? state.attrs[row.player_id] : {};
    forPlayer[row.attr_key] = value;
    state.attrs[row.player_id] = forPlayer;
  }
  for (const row of runtime.trackProgress) {
    const forPlayer: Record<string, number> = Object.prototype.hasOwnProperty.call(state.tracks, row.player_id) ? state.tracks[row.player_id] : {};
    forPlayer[row.track_key] = row.step;
    state.tracks[row.player_id] = forPlayer;
  }
  state.adjustments = runtime.adjustments.flatMap((row) =>
    row.kind === 'points' || row.kind === 'rank'
      ? [{ id: row.id, kind: row.kind, target: row.target, delta: row.delta, created_at: row.created_at }]
      : [],
  );
  state.checks = runtime.checks.flatMap((row): RuntimeCheck[] =>
    CHECK_SOURCES.has(row.source) && CHECK_STATUSES.has(row.status)
      ? [
          {
            id: row.id,
            source: row.source as RuntimeCheck['source'],
            rule_id: row.rule_id,
            dedupe_key: row.dedupe_key,
            subject: row.subject,
            status: row.status as RuntimeCheck['status'],
            note: row.note,
          },
        ]
      : [],
  );
  state.firedEventKeys = runtime.eventLog.map((row) => row.event_key);

  const tunables = resolveTunables(def, stored.tunables);
  state.tunables = tunables.values;
  state.amendments = parseAmendments(stored.amendments);
  return { state, tunableIssues: tunables.issues };
}
