import type { NextRequest } from 'next/server';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { requirePlayer } from '@/lib/auth/helpers';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { createNativePhaseServices } from '@/lib/league-phase/services';
import { expireSeasonReads, revalidatePhaseMatchPages } from '@/lib/revalidation';
import { findNativePhaseAliasOwner } from '@/lib/supabase/queries/phase-route-owners';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string; matchId: string }> },
) {
  try {
    const player = await requirePlayer();
    const { id, phaseId, matchId } = await params;
    const invalid = rejectInvalidPathId(id, 'INVALID_SEASON_ID')
      ?? rejectInvalidPathId(phaseId, 'INVALID_PHASE_ID')
      ?? rejectInvalidPathId(matchId, 'INVALID_MATCH_ID');
    if (invalid) return invalid;

    const mid = matchId.toLowerCase();
    const owner = await requireOpenPhaseRouteMode() === 'phase'
      ? await findNativePhaseAliasOwner({ phaseId: phaseId.toLowerCase(), matchId: mid })
      : null;
    if (owner?.season_id !== id.toLowerCase()) {
      throw new UserFacingError('Match not found', { code: 'match_not_found', status: 404 });
    }

    const { matches } = createNativePhaseServices({
      invalidateMatch: (phase, match) => revalidatePhaseMatchPages(phase, match, phase === owner.phase_id ? owner.season_id : undefined),
      invalidateSeason: (season, phaseIds) => expireSeasonReads(season, { phaseIds }),
      invalidateWiki: (phase) => revalidatePhaseMatchPages(phase),
    });
    return await matches.decide(request, { params: Promise.resolve({ mid }) }, player);
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update match');
  }
}
