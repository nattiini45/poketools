/**
 * The bindings of every Build and Go-live operation (spec §18.4): the allow-list of routes the approve route can dispatch.
 * Only `_lib/approve.ts` imports this file, and that wiring is reachable from the approve and resume routes only (a
 * module-graph test keeps the chat route away from it).
 *
 * Phase 1, slice 2 binds the Build operations of the thin vertical, one file per operation: league, roster, phases and a
 * standalone tournament, plus (slice 8) one player added to a standalone tournament (`BUILD_OP_ROUTES` names the same methods
 * and paths; the executor's recheck compares them). The compensating calls they declare as reversals (archive a league or a
 * tournament, remove a roster row or a tournament player) are bound too; `propose_undo` stages them from the ledger (slice 5). `groups_set` (phase 2) and `draft_pool_create` (phase 4)
 * have no binding, so a stored step that names them is `proposal_stale` (unknown op).
 *
 * Slice 3 binds the four stageable Go-live operations (`GOLIVE_STAGEABLE`): publish a ruleset, move a pin, start a phase and
 * generate a bracket. Each is class G and ONE exact route call; `method` and `path` equal what `proposals/golive.ts` stores.
 * The other Go-live tools have no binding until they are staged.
 *
 * Slice 5 adds the two reversals that only an undo holds (`UNDO_BINDINGS`); `propose_undo` is staged from the ledger.
 *
 * Every binding declares a strict body schema and, for a path with parameters, a params schema (`schemas.ts`); the executor
 * parses the resolved request with them before it dispatches.
 */
import { createBindingRegistry, type BindingRegistry, type RouteBinding } from '@/lib/ai/admin-agent/dispatch';
import { generateBracket } from './generate-bracket';
import { leagueArchive } from './league-archive';
import { leagueCreate } from './league-create';
import { movePin } from './move-pin';
import { phaseCreate } from './phase-create';
import { publishRuleset } from './publish-ruleset';
import { rosterAdd } from './roster-add';
import { rosterRemove } from './roster-remove';
import { rulesetDeleteDraft } from './ruleset-delete-draft';
import { rulesetRestoreDraft } from './ruleset-restore-draft';
import { startPhase } from './start-phase';
import { tournamentArchive } from './tournament-archive';
import { tournamentCreate } from './tournament-create';
import { tournamentParticipantAdd } from './tournament-participant-add';
import { tournamentParticipantRemove } from './tournament-participant-remove';

/** In the order the Build runs them, then the reversals. */
export const BUILD_BINDINGS: readonly RouteBinding[] = [
  leagueCreate,
  rosterAdd,
  phaseCreate,
  tournamentCreate,
  tournamentParticipantAdd,
  leagueArchive,
  rosterRemove,
  tournamentArchive,
  tournamentParticipantRemove,
];

/** The stageable Go-live operations, in the order of `GOLIVE_STAGEABLE`. */
export const GOLIVE_BINDINGS: readonly RouteBinding[] = [publishRuleset, movePin, startPhase, generateBracket];

/**
 * The reversals only an undo proposal holds (slice 5): restoring a ruleset draft and deleting one that was never published.
 * The archives and the roster remove are in `BUILD_BINDINGS`; a pin moved back is the `move_pin` binding again.
 */
export const UNDO_BINDINGS: readonly RouteBinding[] = [rulesetRestoreDraft, rulesetDeleteDraft];

/** Every binding the approve and resume routes can dispatch. */
export const OP_BINDINGS: readonly RouteBinding[] = [...BUILD_BINDINGS, ...GOLIVE_BINDINGS, ...UNDO_BINDINGS];

let registry: BindingRegistry | undefined;

export function getBindingRegistry(): BindingRegistry {
  registry ??= createBindingRegistry(OP_BINDINGS);
  return registry;
}
