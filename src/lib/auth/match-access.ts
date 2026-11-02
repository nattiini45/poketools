import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';

/**
 * The one rule for "may act as an admin on this match": a site admin, or a
 * resource admin of the match's tournament or of its league
 * (`isResourceAdminFor` cascades from the tournament to its season).
 *
 * `actor` must come from a live guard (`requirePlayer`, `getLiveAccess`), never
 * the session copy. Shared by the per-match admin routes (`authorizeMatchAdmin`),
 * `confirm-match`, the result submission routes and the submit page, so a
 * league organizer is treated the same everywhere. A failed role read throws
 * (fail closed).
 */
export async function canAdministerMatchAccess(
  actor: { readonly playerId: string; readonly isAdmin: boolean },
  tournamentId: string
): Promise<boolean> {
  if (actor.isAdmin) return true;
  return isResourceAdminFor(actor.playerId, 'tournament', tournamentId);
}

/**
 * Whether a result submission acts with admin authority (`is_admin` of
 * `recordGameResult`): a site admin, or a resource admin of the match's
 * tournament or league who does not play in the match. A participant submits
 * as a participant and costs no role lookup.
 */
export async function submitsAsMatchAdmin(
  actor: { readonly playerId: string; readonly isAdmin: boolean },
  match: { readonly tournament_id: string; readonly player_1_id: string; readonly player_2_id: string }
): Promise<boolean> {
  if (actor.isAdmin) return true;
  if (actor.playerId === match.player_1_id || actor.playerId === match.player_2_id) return false;
  return canAdministerMatchAccess(actor, match.tournament_id);
}
