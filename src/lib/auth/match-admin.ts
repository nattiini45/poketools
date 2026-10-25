import { NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import type { ApiResult } from '@/types/api';
import type { SessionPlayer } from '@/types/auth';
import type { MatchWithPlayers } from '@/types/match';

export type MatchAdminAuthorization =
  | { ok: true; player: SessionPlayer; match: MatchWithPlayers }
  | { ok: false; response: NextResponse };

/**
 * Gate of the per-match admin routes: a site admin, or a resource admin of the
 * match's tournament (a league admin cascades to its tournaments). The same
 * rule as the match reset route and the admin match page, so a resource admin
 * only ever reaches matches of their own leagues and tournaments.
 *
 * Order: live player guard (an `AuthError` propagates to the caller's
 * `safeErrorResponse`), path id, match lookup (404), access (403).
 */
export async function authorizeMatchAdmin(matchId: string): Promise<MatchAdminAuthorization> {
  const player = await requirePlayer();

  const invalidId = rejectInvalidPathId(matchId, 'INVALID_MATCH_ID');
  if (invalidId) return { ok: false, response: invalidId };

  const match = await getMatchById(matchId);
  if (!match) {
    return {
      ok: false,
      response: NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 }
      ),
    };
  }

  const hasAdminAccess =
    player.isAdmin || (await isResourceAdminFor(player.playerId, 'tournament', match.tournament_id));
  if (!hasAdminAccess) {
    return {
      ok: false,
      response: NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Admin access required', code: 'forbidden' },
        { status: 403 }
      ),
    };
  }

  return { ok: true, player, match };
}
