import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { logAuditEvent } from '@/lib/audit/log';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { assertSeasonOpenForPlay, requireSeasonMember } from '@/lib/auth/season-member';
import { withdrawChallenge } from '@/lib/format-engine/challenge-server';
import { challengeWithdrawQuery } from '@/lib/format-engine/runtime/api-schemas';
import { toChallengeView } from '@/lib/format-engine/runtime/views';
import { loadParticipantNames } from '@/lib/format-engine/runtime/views-server';
import type { ChallengeResponse } from '@/lib/format-engine/runtime/view-types';
import { validationFailedResponse } from '@/lib/format-studio/api-schemas';
import { logger } from '@/lib/logger';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import { CHALLENGE_WRITE_LIMIT } from '../../_lib/limits';

interface RouteParams {
  params: Promise<{ id: string; challengeId: string }>;
}

/**
 * DELETE /api/seasons/[id]/format/challenges/[challengeId]?as=self|admin
 *
 * Withdraws an OPEN challenge of this league. `as=self` (the default): the challenger, who must take part in the league
 * (refused in a completed or archived league). `as=admin`: a league admin (or site admin) withdraws it for them, and may
 * do so in a closed league. An admin who also plays uses the default and is treated as a player. The `as` parameter picks
 * the guard, so it is read first; the challenge is season-scoped in the database (`challenge_not_found`,
 * `challenge_not_challenger` 403, `challenge_not_open` 409). A challenge whose accept window has run out is stored as
 * expired (which the cooldown counts) and answers `challenge_expired` 409; it is not withdrawn. An ACCEPTED challenge already created a match: an admin
 * removes that match with the match routes, the challenge row stays as history.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, challengeId } = await params;

    // The query only picks the guard and carries no data, so it is read before the guard.
    const as = new URL(request.url).searchParams.get('as');
    const query = challengeWithdrawQuery.safeParse(as === null ? {} : { as });
    if (!query.success) return validationFailedResponse(query.error);

    let seasonId: string;
    let actor: { playerId: string; name: string };
    let playerId: string | null;
    if (query.data.as === 'admin') {
      actor = await requireResourceAdmin('season', id);
      seasonId = id.toLowerCase();
      playerId = null;
    } else {
      const member = await requireSeasonMember(id);
      actor = member.player;
      seasonId = member.seasonId;
      playerId = member.player.playerId;
    }

    const invalid = rejectInvalidPathId(challengeId, 'INVALID_CHALLENGE_ID');
    if (invalid) return invalid;
    if (playerId !== null) await assertSeasonOpenForPlay(seasonId);

    const rate = await checkRateLimit(CHALLENGE_WRITE_LIMIT.bucket, actor.playerId, CHALLENGE_WRITE_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const row = await withdrawChallenge(seasonId, challengeId.toLowerCase(), playerId);

    logAuditEvent({
      action: 'season.format.challenge.withdraw',
      actor_id: actor.playerId,
      actor_name: actor.name,
      resource_type: 'season',
      resource_id: seasonId,
      metadata: { challenge_id: row.id, by: playerId === null ? 'admin' : 'challenger', challenger_id: row.challenger_id },
    });

    // The withdrawal is committed and audited by now: a failed name read must not turn it into an error (the client would
    // retry into a conflict). The names are best effort, the view then carries `name: null`.
    let names: Awaited<ReturnType<typeof loadParticipantNames>> = new Map();
    try {
      names = await loadParticipantNames(seasonId);
    } catch (err) {
      logger.warn('api/format/challenges', 'participant names unavailable after the withdrawal was committed', { seasonId, challengeId: row.id, error: err });
    }
    return NextResponse.json<ApiResult<ChallengeResponse>>({
      success: true,
      data: { challenge: toChallengeView(row, names, new Date()) },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to withdraw the challenge');
  }
}
