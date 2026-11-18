import type { NextRequest } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { handleLegacyMatchDecision } from '@/lib/match/match-decisions';
import { resolveIdOnlyMatchRoute } from '@/lib/league-phase/match-route-owner';
import { createNativePhaseServices } from '@/lib/league-phase/services';
import { expireSeasonReads, revalidatePhaseMatchPages } from '@/lib/revalidation';
import type { MatchDecisionRouteParams } from '@/lib/match/match-decisions-core';

export async function POST(request: NextRequest, context: MatchDecisionRouteParams) {
  try {
    const player = await requirePlayer();
    const { mid } = await context.params;
    const invalid = rejectInvalidPathId(mid, 'INVALID_MATCH_ID');
    if (invalid) return invalid;
    const owner = await resolveIdOnlyMatchRoute(mid.toLowerCase());
    if (!owner) throw new UserFacingError('Match not found', { code: 'match_not_found', status: 404 });
    if (owner.kind === 'legacy') return await handleLegacyMatchDecision(request, context, player);
    const { matches } = createNativePhaseServices({
      invalidateMatch: (phase, match) => revalidatePhaseMatchPages(phase, match, phase === owner.phase_id ? owner.season_id : undefined),
      invalidateSeason: (season, phaseIds) => expireSeasonReads(season, { phaseIds }),
      invalidateWiki: (phase) => revalidatePhaseMatchPages(phase),
    });
    return await matches.decide(request, { params: Promise.resolve({ mid: mid.toLowerCase() }) }, player);
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update match');
  }
}
