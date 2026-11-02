import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { UserFacingError } from '@/lib/api/user-facing-error';

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

/** The submitter is neither a participant nor an admin of the match (a site admin or a resource admin of its tournament or league). HTTP 403. */
export class MatchSubmitForbiddenError extends UserFacingError {
  constructor() {
    super('Only match participants or admins can submit results', { code: 'match_submit_forbidden', status: 403 });
    this.name = 'MatchSubmitForbiddenError';
  }
}

/**
 * Refuses a submitter who neither plays in the match nor administers it
 * (`MatchSubmitForbiddenError`) and returns whether the submission acts with admin authority
 * (`is_admin` of `recordGameResult`). Routes that do work before `recordGameResult` (fetching a
 * replay) call it first, so an unauthorized caller costs no outbound request.
 */
export async function assertMayRecordResult(
  actor: { readonly playerId: string; readonly isAdmin: boolean },
  match: { readonly tournament_id: string; readonly player_1_id: string; readonly player_2_id: string }
): Promise<{ readonly asAdmin: boolean }> {
  const asAdmin = await submitsAsMatchAdmin(actor, match);
  const isParticipant = actor.playerId === match.player_1_id || actor.playerId === match.player_2_id;
  if (!asAdmin && !isParticipant) throw new MatchSubmitForbiddenError();
  return { asAdmin };
}
