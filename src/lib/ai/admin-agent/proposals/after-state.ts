/**
 * What an undo compares against (spec §18.8 "Drift protocol", plan 4.7): the fingerprint of an entity right after a chat write,
 * and the facts the ledger keeps so a reversal can be built later.
 *
 * Two jobs, one vocabulary:
 *  - the pure state shapes (`rosterMembersState`, `pinTargetsState`, `draftDocState`, `draftLifeState`): the live reads in
 *    `live.ts` return exactly these, the ledger stores their hash, and staging computes the expected hash of a state it has
 *    not read (one roster player, one pin-back group) from the same functions, so both sides hash the same value;
 *  - `afterFingerprintFor`: the hook the approve wiring hands the executor, which fingerprints the entity a step just wrote.
 *    It reads through the same `FingerprintSource` the preconditions use.
 *
 * Pure apart from the injected source. No route, no store, no domain table.
 */
import type { JsonValue } from '@/lib/studio-core/json';
import { hashJson } from '../plans/hash';
import { uuidOf } from '../plans/undo-recipes';
import type { FingerprintSource, ReadName, ReadTarget } from './fingerprints';

/** What a hook sees of a step that just finished `ok`. */
export interface StepFacts {
  readonly step: { readonly key: string; readonly op: string };
  /** The resolved request the step was sent with. */
  readonly call?: { readonly params: Readonly<Record<string, string>>; readonly body: unknown };
  /** The ledger result (ids only). */
  readonly result: Readonly<Record<string, JsonValue>> | null;
  /** The entity id the ledger row is filed under. */
  readonly entityId: string | null;
}

export type TargetRef = { kind: 'season' | 'tournament'; id: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The lower-cased, de-duplicated, sorted player ids. */
export const sortedIds = (ids: readonly string[]): string[] => [...new Set(ids.map((id) => id.toLowerCase()))].sort();

/** `roster_members`: which of the named players are on the league's roster. */
export const rosterMembersState = (present: readonly string[]): JsonValue => sortedIds(present);

/** `pin_targets`: the version each target pins now (`null`: none). Targets are sorted by kind and id. */
export function pinTargetsState(rows: ReadonlyArray<{ kind: 'season' | 'tournament'; id: string; ruleset_id: string | null }>): JsonValue {
  const targets = rows
    .map((row) => ({ kind: row.kind, id: row.id.toLowerCase(), ruleset_id: row.ruleset_id === null ? null : row.ruleset_id.toLowerCase() }))
    .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  return { targets };
}

/** `ruleset_draft_doc`: the revision and the hash of the document. A draft save of the chat leaves this state. */
export const draftDocState = (draftRev: number, docHash: string): JsonValue => ({ draft_rev: draftRev, doc_hash: docHash });

/** `ruleset_draft_state`: the revision and whether any version exists. The state a freshly created draft is in. */
export const draftLifeState = (draftRev: number, published: boolean): JsonValue => ({ draft_rev: draftRev, published });

/**
 * `league_after`: what an admin EDITS about a league, and nothing the league does by itself.
 *
 * The undo compares this state with the one right after the chat's write, so a field in it is a field whose change reads
 * "edited outside the chat" and leaves the league alone. A field that the assistant's own later steps or normal play change
 * would make the chat's own work look like somebody else's edit; that is why `status` is NOT here: the league goes
 * `upcoming` -> `active` when its first round is generated (a Go-live card of this very chat), and an undo of the Build must
 * still be able to archive it afterwards. The same goes for counters and timestamps (`updated_at`), which are not listed.
 *
 * Listed: the name, the description, the format, `archived`, the dates and the language. The ruleset pin is NOT listed: the
 * chat's own `move_pin` card changes it, and a pin move is undone by its own card, which compares the pins themselves
 * (`pin_targets`); archiving the league does not depend on which version it pins.
 */
export function leagueAfterState(season: {
  name: string;
  description: string | null;
  format_type: string;
  archived: boolean;
  start_date: string | null;
  end_date: string | null;
  language?: string | null;
}): JsonValue {
  return {
    name: season.name,
    description: season.description,
    format_type: season.format_type,
    archived: season.archived,
    start_date: season.start_date,
    end_date: season.end_date,
    language: season.language ?? null,
  };
}

/**
 * `tournament_after`: what an admin edits about a standalone tournament or a phase, without its lifecycle. `status` is not
 * listed (starting it is a Go-live card of the chat or the site's normal play), nor are rounds, participants or timestamps,
 * nor the ruleset pin (as for a league: a pin move has its own undo). Listed: the name, the description, the league it
 * belongs to, the bracket type, the default best-of, `archived` and the phase order.
 */
export function tournamentAfterState(tournament: {
  name: string;
  description: string | null;
  season_id: string | null;
  bracket_type: string;
  best_of_default: number;
  archived: boolean;
  stage_order: number | null;
}): JsonValue {
  return {
    name: tournament.name,
    description: tournament.description,
    season_id: tournament.season_id,
    bracket_type: tournament.bracket_type,
    best_of_default: tournament.best_of_default,
    archived: tournament.archived,
    stage_order: tournament.stage_order,
  };
}

/** The hash a state stores as, the same one `fingerprintOf` gives a read that returns it. */
export const stateHash = (state: JsonValue): string => hashJson(state);

/** The read and target that fingerprint the entity a finished step left behind, or `null` for a step with no undo. */
export function afterRead(facts: StepFacts): { read: ReadName; target: ReadTarget } | null {
  const callBody = facts.call?.body;
  const body: Record<string, unknown> = isRecord(callBody) ? callBody : {};
  switch (facts.step.op) {
    case 'league_create':
      return facts.entityId === null ? null : { read: 'league_after', target: { kind: 'id', id: facts.entityId } };
    case 'tournament_create':
      return facts.entityId === null ? null : { read: 'tournament_after', target: { kind: 'id', id: facts.entityId } };
    case 'roster_add': {
      const seasonId = uuidOf(facts.call?.params.id);
      const players = Array.isArray(body.player_ids) ? body.player_ids.filter((id): id is string => typeof id === 'string') : [];
      return seasonId === null || players.length === 0 ? null : { read: 'roster_members', target: { kind: 'params', params: { season_id: seasonId, player_ids: sortedIds(players) } } };
    }
    case 'move_pin': {
      const targets = Array.isArray(body.targets) ? body.targets.filter((t): t is TargetRef => isRecord(t) && typeof t.id === 'string' && (t.kind === 'season' || t.kind === 'tournament')) : [];
      return targets.length === 0 ? null : { read: 'pin_targets', target: { kind: 'params', params: { targets: targets.map((t) => ({ kind: t.kind, id: t.id.toLowerCase() })) } } };
    }
    default:
      return null;
  }
}

/**
 * The executor's `afterFingerprint` hook over a fingerprint source: the hash of the state the step left, for the ops that have
 * an undo rule; `null` for the others (a start, a bracket, a publish and a phase have nothing to compare later).
 */
export function afterFingerprintFor(source: FingerprintSource): (facts: StepFacts) => Promise<string | null> {
  return async (facts) => {
    const wanted = afterRead(facts);
    if (wanted === null) return null;
    const state = await source.read(wanted.read, wanted.target);
    // A read that finds nothing means the entity is gone: there is no state to store.
    return state === null ? null : hashJson(state);
  };
}
