/**
 * The bindings of every Build and Go-live operation (spec §18.4): the allow-list of routes the approve route can dispatch.
 * Only the approve and resume routes import this file (a module-graph test keeps the chat route away from it).
 *
 * Phase 1, slice 2 binds the Build operations of the thin vertical, one file per operation: league, roster, phases and a
 * standalone tournament (`BUILD_OP_ROUTES` names the same methods and paths; the executor's recheck compares them). The three
 * compensating calls they declare as reversals (archive a league or a tournament, remove a roster row) are bound too, and
 * staging cannot reach them yet: an undo proposal is a later slice. `groups_set` (phase 2) and `draft_pool_create` (phase 4)
 * have no binding, so a stored step that names them is `proposal_stale` (unknown op). The Go-live bindings come with their
 * cards. Every binding declares a strict body schema and, for a path with parameters, a params schema (`schemas.ts`);
 * the executor parses the resolved request with them before it dispatches.
 */
import { createBindingRegistry, type BindingRegistry, type RouteBinding } from '@/lib/ai/admin-agent/dispatch';
import { leagueArchive } from './league-archive';
import { leagueCreate } from './league-create';
import { phaseCreate } from './phase-create';
import { rosterAdd } from './roster-add';
import { rosterRemove } from './roster-remove';
import { tournamentArchive } from './tournament-archive';
import { tournamentCreate } from './tournament-create';

/** In the order the Build runs them, then the reversals. */
export const BUILD_BINDINGS: readonly RouteBinding[] = [leagueCreate, rosterAdd, phaseCreate, tournamentCreate, leagueArchive, rosterRemove, tournamentArchive];

let registry: BindingRegistry | undefined;

export function getBindingRegistry(): BindingRegistry {
  registry ??= createBindingRegistry(BUILD_BINDINGS);
  return registry;
}
