import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { logAuditEvent } from '@/lib/audit/log';
import { assertSeasonOpenForPlay, requireSeasonMember } from '@/lib/auth/season-member';
import { answerChallenge } from '@/lib/format-engine/challenge-server';
import { readBoundedJson } from '@/lib/format-engine/runtime/api-body';
import { challengeAnswerBody, SMALL_BODY_MAX_BYTES } from '@/lib/format-engine/runtime/api-schemas';
import { toChallengeView } from '@/lib/format-engine/runtime/views';
import { loadParticipantNames } from '@/lib/format-engine/runtime/views-server';
import type { ChallengeResponse } from '@/lib/format-engine/runtime/view-types';
import { validationFailedResponse } from '@/lib/format-studio/api-schemas';
import { logger } from '@/lib/logger';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import { CHALLENGE_WRITE_LIMIT } from '../../../_lib/limits';

interface RouteParams {
  params: Promise<{ id: string; challengeId: string }>;
}

/**
 * POST /api/seasons/[id]/format/challenges/[challengeId]/answer
 *
 * The defender accepts or declines an open challenge of this league. The database scopes the challenge to the league (a
 * challenge of another league is 404 `challenge_not_found`) and enforces defender-only (403 `challenge_not_defender`),
 * open-only (409 `challenge_not_open`) and the accept window (409 `challenge_expired`, stored as expired). An accepted
 * challenge creates a match, so `answerChallenge` expires the phase reads. Refused in a completed or archived league.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, challengeId } = await params;
    const { player, seasonId } = await requireSeasonMember(id);

    const invalid = rejectInvalidPathId(challengeId, 'INVALID_CHALLENGE_ID');
    if (invalid) return invalid;
    await assertSeasonOpenForPlay(seasonId);

    const rate = await checkRateLimit(CHALLENGE_WRITE_LIMIT.bucket, player.playerId, CHALLENGE_WRITE_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = challengeAnswerBody.safeParse(await readBoundedJson(request, SMALL_BODY_MAX_BYTES));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const row = await answerChallenge({
      seasonId,
      challengeId: challengeId.toLowerCase(),
      playerId: player.playerId,
      accept: parsed.data.accept,
    });

    logAuditEvent({
      action: 'season.format.challenge.answer',
      actor_id: player.playerId,
      actor_name: player.name,
      resource_type: 'season',
      resource_id: seasonId,
      metadata: { challenge_id: row.id, phase_id: row.phase_id, accept: parsed.data.accept, match_id: row.match_id },
    });

    // The answer is committed and audited by now: a failed name read must not turn it into an error (the client would
    // retry into a conflict). The names are best effort, the view then carries `name: null`.
    let names: Awaited<ReturnType<typeof loadParticipantNames>> = new Map();
    try {
      names = await loadParticipantNames(seasonId);
    } catch (err) {
      logger.warn('api/format/challenges', 'participant names unavailable after the answer was committed', { seasonId, challengeId: row.id, error: err });
    }
    return NextResponse.json<ApiResult<ChallengeResponse>>({
      success: true,
      data: { challenge: toChallengeView(row, names, new Date()) },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to answer the challenge');
  }
}
