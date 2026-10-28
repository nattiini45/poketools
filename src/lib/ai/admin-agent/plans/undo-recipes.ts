/**
 * The calls an undo makes (plan 4.7, spec §18.8), as pure data. One source for both sides: the bindings in `_ops/g` build their
 * declared `reversal.buildInput` from these functions, and the staging of `propose_undo` builds the stored steps from the same
 * ones, so what staging shows and what the binding would derive cannot drift (`ops-undo.test.ts` pins the routes and classes
 * against the bindings). Staging cannot import `_ops/g` (the chat side never reaches a privileged binding), which is why the
 * recipes live here.
 *
 * Nothing here reads or writes anything.
 */
import type { JsonValue } from '@/lib/studio-core/json';

export type UndoOperation = 'league_archive' | 'tournament_archive' | 'roster_remove' | 'move_pin' | 'ruleset_restore_draft' | 'ruleset_delete_draft';

export interface UndoRoute {
  readonly method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly routeTemplate: string;
  /** The class of the binding: archives and removes are live rows (B), a pin back and a delete are G, a draft restore is D. */
  readonly class: 'B' | 'G' | 'D';
  readonly pathParam: 'id';
}

export const UNDO_ROUTES: Readonly<Record<UndoOperation, UndoRoute>> = Object.freeze({
  league_archive: { method: 'PATCH', routeTemplate: '/api/seasons/[id]', class: 'B', pathParam: 'id' },
  tournament_archive: { method: 'PATCH', routeTemplate: '/api/tournaments/[id]', class: 'B', pathParam: 'id' },
  roster_remove: { method: 'DELETE', routeTemplate: '/api/seasons/[id]/participants', class: 'B', pathParam: 'id' },
  move_pin: { method: 'POST', routeTemplate: '/api/ruleset-definitions/[id]/pins', class: 'G', pathParam: 'id' },
  ruleset_restore_draft: { method: 'PUT', routeTemplate: '/api/ruleset-definitions/[id]/draft', class: 'D', pathParam: 'id' },
  ruleset_delete_draft: { method: 'DELETE', routeTemplate: '/api/ruleset-definitions/[id]', class: 'G', pathParam: 'id' },
});

/** The operations an undo proposal may hold. The executor refuses any other op in a stored undo step. */
export const UNDO_OPERATIONS: readonly UndoOperation[] = Object.freeze(Object.keys(UNDO_ROUTES) as UndoOperation[]);

export const isUndoOperation = (op: string): op is UndoOperation => (UNDO_OPERATIONS as readonly string[]).includes(op);

/** A reversal call: the path parameters and the JSON body (`null`: the route takes none). */
export interface UndoCall {
  readonly params: Readonly<Record<string, string>>;
  readonly body: JsonValue;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A uuid in lower case, or `null`. */
export const uuidOf = (value: unknown): string | null => (typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null);

/** The id a ledger result carries (`{ id }`), or `null`. */
export const idOfLedgerResult = (result: unknown): string | null => (isRecord(result) ? uuidOf(result.id) : null);

export function leagueArchiveCall(result: unknown): UndoCall {
  const id = idOfLedgerResult(result);
  if (id === null) throw new Error('league_create left no league id to archive');
  return { params: { id }, body: { archived: true } };
}

export function tournamentArchiveCall(result: unknown): UndoCall {
  const id = idOfLedgerResult(result);
  if (id === null) throw new Error('tournament_create left no tournament id to archive');
  return { params: { id }, body: { archived: true } };
}

/** One call per player: the remove route takes one. */
export function rosterRemoveCalls(leagueId: string, playerIds: readonly string[]): UndoCall[] {
  return playerIds.map((playerId) => ({ params: { id: leagueId }, body: { player_id: playerId } }));
}

/** Moves the given targets back to `versionNo` of the ruleset. `started` are the ids that have started (they need `confirm_started`). */
export function pinBackCall(definitionId: string, versionNo: number, targets: ReadonlyArray<{ kind: 'season' | 'tournament'; id: string }>, started: readonly string[]): UndoCall {
  return {
    params: { id: definitionId },
    body: {
      to_version_no: versionNo,
      targets: targets.map((target) => ({ kind: target.kind, id: target.id })),
      ...(started.length > 0 ? { confirm_started: [...started] } : {}),
    },
  };
}

/** Writes the previous document back with a compare-and-set on the revision the chat's write left. */
export function restoreDraftCall(definitionId: string, draftRev: number, document: JsonValue): UndoCall {
  return { params: { id: definitionId }, body: { draft_rev: draftRev, document } };
}

/** Deletes a draft that has never been published (the route takes no body). */
export function deleteDraftCall(definitionId: string): UndoCall {
  return { params: { id: definitionId }, body: null };
}
