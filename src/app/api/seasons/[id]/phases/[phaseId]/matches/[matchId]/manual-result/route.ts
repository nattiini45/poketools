import { NextRequest, NextResponse } from 'next/server';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { requirePlayer } from '@/lib/auth/helpers';
import { recordNativeManualResult } from '@/lib/league-phase/manual-result';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { revalidatePhaseMatchPages } from '@/lib/revalidation';
import { findNativePhaseAliasOwner } from '@/lib/supabase/queries/phase-route-owners';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import { formatZodErrors, manualResultSchema } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string; matchId: string }> },
) {
  try {
    const player = await requirePlayer();
    const rateResult = await checkRateLimit('manual-result', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
    if (!rateResult.allowed) return rateLimitedResponse(rateResult.retryAfterSeconds);

    const { id, phaseId, matchId } = await params;
    const invalid = rejectInvalidPathId(id, 'INVALID_SEASON_ID')
      ?? rejectInvalidPathId(phaseId, 'INVALID_PHASE_ID')
      ?? rejectInvalidPathId(matchId, 'INVALID_MATCH_ID');
    if (invalid) return invalid;

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch (error) {
      return safeErrorResponse(error, 'Invalid JSON body', 400, 'invalid_json');
    }
    const mid = matchId.toLowerCase();
    const parsed = manualResultSchema.safeParse(rawBody);
    if (!parsed.success || parsed.data.match_id.toLowerCase() !== mid) {
      const issues = parsed.success ? 'match_id: Must match the route match ID' : formatZodErrors(parsed.error);
      throw new UserFacingError(issues, { code: 'validation_failed', status: 400, params: { issues } });
    }
    const body = parsed.data;

    const owner = await requireOpenPhaseRouteMode() === 'phase'
      ? await findNativePhaseAliasOwner({ phaseId: phaseId.toLowerCase(), matchId: mid })
      : null;
    if (owner?.season_id !== id.toLowerCase()) {
      throw new UserFacingError('Match not found', { code: 'match_not_found', status: 404 });
    }
    const data = await recordNativeManualResult(owner, player, body,
      (phase, match, season) => revalidatePhaseMatchPages(phase, match, season),
    );
    return NextResponse.json<ApiResult<typeof data>>({ success: true, data });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to submit manual result');
  }
}
