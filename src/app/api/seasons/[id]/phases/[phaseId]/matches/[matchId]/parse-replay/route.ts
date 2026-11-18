import { NextRequest } from 'next/server';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { requirePlayer } from '@/lib/auth/helpers';
import { submitNativeReplay } from '@/lib/league-phase/replay-result';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { parseReplayReference } from '@/lib/pkmn/replay-reference';
import { revalidatePhaseMatchPages } from '@/lib/revalidation';
import { findNativePhaseAliasOwner } from '@/lib/supabase/queries/phase-route-owners';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import { formatZodErrors, parseReplaySchema } from '@/lib/validation';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string; matchId: string }> },
) {
  try {
    const player = await requirePlayer();
    const rate = await checkRateLimit('parse-replay', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

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
    const parsed = parseReplaySchema.safeParse(rawBody);
    if (!parsed.success || parsed.data.match_id.toLowerCase() !== mid) {
      const issues = parsed.success ? 'match_id: Must match the route match ID' : formatZodErrors(parsed.error);
      throw new UserFacingError(issues, { code: 'validation_failed', status: 400, params: { issues } });
    }
    parseReplayReference(parsed.data.replay_url);

    const phase = phaseId.toLowerCase();
    const owner = await requireOpenPhaseRouteMode() === 'phase'
      ? await findNativePhaseAliasOwner({ phaseId: phase, matchId: mid })
      : null;
    if (owner?.season_id !== id.toLowerCase() || owner.phase_id !== phase) {
      throw new UserFacingError('Match not found', { code: 'match_not_found', status: 404 });
    }
    return await submitNativeReplay(owner, player, parsed.data,
      (phase, match, season) => revalidatePhaseMatchPages(phase, match, season),
    );
  } catch (error) {
    return safeErrorResponse(error, 'Failed to parse replay');
  }
}
