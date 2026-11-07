import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logAuditEvent } from '@/lib/audit/log';
import { assertSeasonOpenForPlay, requireSeasonMember } from '@/lib/auth/season-member';
import { submitAction } from '@/lib/format-engine/runtime/actions-server';
import { readBoundedJson } from '@/lib/format-engine/runtime/api-body';
import { loadFreshKitContext } from '@/lib/format-engine/runtime/load';
import { actionBody, actionKeyParam, SMALL_BODY_MAX_BYTES } from '@/lib/format-engine/runtime/api-schemas';
import { actionRejectedResponse } from '@/lib/format-engine/runtime/http';
import { refuse } from '@/lib/format-engine/runtime/refusal';
import { hiddenGiverActions, toSubmissionView } from '@/lib/format-engine/runtime/views';
import type { SubmissionResponse } from '@/lib/format-engine/runtime/view-types';
import { validationFailedResponse } from '@/lib/format-studio/api-schemas';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import { ACTION_SUBMIT_LIMIT } from '../../../_lib/limits';

interface RouteParams {
  params: Promise<{ id: string; actionId: string }>;
}

/**
 * POST /api/seasons/[id]/format/actions/[actionId]/submit
 *
 * A participant submits their pick for themselves (the actor is the session player). Idempotent: a second submit
 * replaces the row and the items it granted. Refused in a completed or archived league (409 `format_season_closed`). A
 * rejected pick answers `format_action_invalid` with `issues`; `action_locked`, `resource_item_taken`,
 * `resource_capacity_reached` and `format_context_stale` (all 409) come from the database under its lock. A stale
 * format (an admin changed it after the pick was validated) is answered 409 `format_context_stale`: the client reloads
 * and validates again. The library expires the league reads; the audit entry holds ids and counts, never the picks.
 *
 * The audit log is readable by every site admin, a site admin may play, and the entry is stamped with a time: for an
 * action whose giver a relation hides (`hiddenGiverActions`, whoever the giver is, also one no longer in a phase; e.g. a Secret Santa gift) the entry therefore names no
 * giver (`actor_id` null, `actor_name` 'Player', `giver_hidden: true`), or it would hand an admin who is a recipient the
 * hidden side without the audited unmask. The action key, the pick count and the lock flag stay.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, actionId } = await params;
    const { player, seasonId } = await requireSeasonMember(id);

    const key = actionKeyParam.safeParse(actionId);
    if (!key.success) throw refuse('format_action_unknown');
    await assertSeasonOpenForPlay(seasonId);

    const rate = await checkRateLimit(ACTION_SUBMIT_LIMIT.bucket, player.playerId, ACTION_SUBMIT_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = actionBody.safeParse(await readBoundedJson(request, SMALL_BODY_MAX_BYTES));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    // Read before the write, so a failure here leaves nothing saved. `hiddenGiverActions` is false for a league that
    // runs no kit format (submitAction then refuses) and once the relation is revealed. It does not ask whether the
    // giver is still in a phase: an admin may have removed them after the draw, their link (and gift) stays.
    const ctx = await loadFreshKitContext(seasonId);
    const giverHidden = ctx !== null && hiddenGiverActions(ctx).has(key.data);

    const result = await submitAction({ seasonId, actionId: key.data, actorId: player.playerId, picks: parsed.data.picks });
    if (!result.ok) return actionRejectedResponse(result.issues);

    const submission = toSubmissionView(result.submission);
    logAuditEvent({
      action: 'season.format.action.submit',
      actor_id: giverHidden ? null : player.playerId,
      actor_name: giverHidden ? 'Player' : player.name,
      resource_type: 'season',
      resource_id: seasonId,
      metadata: {
        action_id: key.data,
        pick_count: parsed.data.picks.length,
        locked: submission.state === 'locked',
        ...(giverHidden ? { giver_hidden: true } : {}),
      },
    });

    return NextResponse.json<ApiResult<SubmissionResponse>>({ success: true, data: { submission } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to submit the pick');
  }
}
