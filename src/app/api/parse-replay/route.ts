import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { resolveIdOnlyMatchRoute } from '@/lib/league-phase/match-route-owner';
import { prepareReplayGame } from '@/lib/pkmn/replay-submission';
import { revalidatePhaseMatchPages } from '@/lib/revalidation';
import { recordGameResult } from '@/lib/pkmn/game-pipeline';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { assertMayRecordResult } from '@/lib/auth/match-access';
import { parseReplayReference } from '@/lib/pkmn/replay-reference';
import { emitMatchResultEffects } from '@/lib/match/result-effects';
import { parseReplaySchema, formatZodErrors } from '@/lib/validation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

export async function POST(request: NextRequest) {
  try {
    const player = await requirePlayer();

    const rateResult = await checkRateLimit('parse-replay', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
    if (!rateResult.allowed) return rateLimitedResponse(rateResult.retryAfterSeconds);

    const rawBody = await request.json();
    const zodResult = parseReplaySchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    // 1. Refuse a malformed replay reference, then a caller who may not submit for this match,
    //    BEFORE any outbound request: an unauthorized caller costs no fetch and learns nothing
    //    from the replay.
    parseReplayReference(body.replay_url);

    const owner = await resolveIdOnlyMatchRoute(body.match_id.toLowerCase());
    if (!owner) throw new UserFacingError('Match not found', { code: 'match_not_found', status: 404 });
    if (owner.kind === 'phase') {
      const { submitNativeReplay } = await import('@/lib/league-phase/replay-result');
      return await submitNativeReplay(owner, player, body, revalidatePhaseMatchPages);
    }

    const match = await getMatchById(body.match_id);
    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 }
      );
    }
    const { asAdmin } = await assertMayRecordResult(player, match);

    const input = await prepareReplayGame(body.replay_url, match);
    if (input instanceof NextResponse) return input;
    const result = await recordGameResult({
      ...input,
      match_id: body.match_id,
      source: 'ps_replay',
      submitter_id: player.playerId,
      is_admin: asAdmin,
    });

    // Shared post-record side effects (revalidate, notify, AI, aggregates)
    await emitMatchResultEffects(body.match_id, {
      boReached: result.bo_reached,
      requestCookie: request.headers.get('cookie'),
      replayUrl: body.replay_url,
    });

    return NextResponse.json<ApiResult<typeof result>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to parse replay');
  }
}
