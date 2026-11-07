import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { assertSeasonOpenForPlay, requireSeasonMember } from '@/lib/auth/season-member';
import { saveAction } from '@/lib/format-engine/runtime/actions-server';
import { readBoundedJson } from '@/lib/format-engine/runtime/api-body';
import { actionBody, actionKeyParam, SMALL_BODY_MAX_BYTES } from '@/lib/format-engine/runtime/api-schemas';
import { actionRejectedResponse } from '@/lib/format-engine/runtime/http';
import { refuse } from '@/lib/format-engine/runtime/refusal';
import { toSubmissionView } from '@/lib/format-engine/runtime/views';
import type { SubmissionResponse } from '@/lib/format-engine/runtime/view-types';
import { validationFailedResponse } from '@/lib/format-studio/api-schemas';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import { ACTION_SAVE_LIMIT } from '../../_lib/limits';

interface RouteParams {
  params: Promise<{ id: string; actionId: string }>;
}

/**
 * PUT /api/seasons/[id]/format/actions/[actionId]
 *
 * A participant saves a DRAFT pick for themselves (the actor is always the session player; a body that names one is a
 * 400). Refused when the pick is already submitted (409 `format_action_already_submitted`: the player submits again to
 * change it) and in a completed or archived league (409 `format_season_closed`). A rejected pick answers
 * `format_action_invalid` with the problems in `issues` (422, or 404 / 409 / 403 for the state of the league). The
 * database refuses a save as 409 `action_locked` (the action or the actor's submission is locked) or 409
 * `format_context_stale` (an admin changed the format after the pick was validated; the client reloads and validates
 * again); a save grants nothing, so it never answers `resource_item_taken` or `resource_capacity_reached`. Drafts are
 * not audited; the library expires the league reads.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, actionId } = await params;
    const { player, seasonId } = await requireSeasonMember(id);

    const key = actionKeyParam.safeParse(actionId);
    if (!key.success) throw refuse('format_action_unknown');
    await assertSeasonOpenForPlay(seasonId);

    const rate = await checkRateLimit(ACTION_SAVE_LIMIT.bucket, player.playerId, ACTION_SAVE_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = actionBody.safeParse(await readBoundedJson(request, SMALL_BODY_MAX_BYTES));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const result = await saveAction({ seasonId, actionId: key.data, actorId: player.playerId, picks: parsed.data.picks });
    if (!result.ok) return actionRejectedResponse(result.issues);

    return NextResponse.json<ApiResult<SubmissionResponse>>({
      success: true,
      data: { submission: toSubmissionView(result.submission) },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to save the pick');
  }
}
