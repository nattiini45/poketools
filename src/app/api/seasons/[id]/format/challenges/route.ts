import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logAuditEvent } from '@/lib/audit/log';
import { assertSeasonOpenForPlay, requireSeasonMember } from '@/lib/auth/season-member';
import { makeChallenge } from '@/lib/format-engine/challenge-server';
import { readBoundedJson } from '@/lib/format-engine/runtime/api-body';
import { challengeMakeBody, SMALL_BODY_MAX_BYTES } from '@/lib/format-engine/runtime/api-schemas';
import { toChallengeView } from '@/lib/format-engine/runtime/views';
import { loadParticipantNames } from '@/lib/format-engine/runtime/views-server';
import type { ChallengeResponse } from '@/lib/format-engine/runtime/view-types';
import { validationFailedResponse } from '@/lib/format-studio/api-schemas';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import { CHALLENGE_MAKE_LIMIT } from '../_lib/limits';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/seasons/[id]/format/challenges
 *
 * A participant challenges another player in the challenge stage `phase_id`. The challenger is always the session player
 * (a body that names one is a 400). The stage's rules (rank range, open cap, cooldown, an open round) are enforced by the
 * database under a per-phase lock; its signals come back as typed errors (`challenge_rank_range` 400,
 * `challenge_cooldown` 409, ...). Refused in a completed or archived league (409 `format_season_closed`). The limiter
 * fails closed (503 `rate_limit_unavailable`). A challenge is read live per viewer, so nothing public is expired.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { player, seasonId } = await requireSeasonMember(id);
    await assertSeasonOpenForPlay(seasonId);

    const rate = await checkRateLimit(CHALLENGE_MAKE_LIMIT.bucket, player.playerId, CHALLENGE_MAKE_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = challengeMakeBody.safeParse(await readBoundedJson(request, SMALL_BODY_MAX_BYTES));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const row = await makeChallenge({
      seasonId,
      phaseId: parsed.data.phase_id.toLowerCase(),
      challengerId: player.playerId,
      defenderId: parsed.data.defender_id.toLowerCase(),
    });

    logAuditEvent({
      action: 'season.format.challenge.make',
      actor_id: player.playerId,
      actor_name: player.name,
      resource_type: 'season',
      resource_id: seasonId,
      metadata: { challenge_id: row.id, phase_id: row.phase_id, defender_id: row.defender_id },
    });

    const names = await loadParticipantNames(seasonId);
    return NextResponse.json<ApiResult<ChallengeResponse>>(
      { success: true, data: { challenge: toChallengeView(row, names, new Date()) } },
      { status: 201 },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to make the challenge');
  }
}
