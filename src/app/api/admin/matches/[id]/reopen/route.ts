import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { formatZodErrors, matchReopenSchema } from '@/lib/validation';
import { reopenMatch } from '@/lib/match/reopen';
import { logAuditEvent } from '@/lib/audit/log';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import { stageEndedParams } from '@/lib/match/stage-ended-warning';
import type { ReopenMatchResult } from '@/lib/admin/match-detail';
import type { ApiResult } from '@/types/api';
import { authorizeCorrectionTarget, correctionAuditTarget, nativeCorrectionServices, revalidateCorrectionTarget } from '../reset/correction-target';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/matches/[id]/reopen — send a completed, pending-confirmation
 * or disputed match back to in_progress without deleting its games. A reason
 * is required and lands in the audit event.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await authorizeCorrectionTarget(params);
    if (!access.ok) return access.response;
    const { player, target } = access;
    const { id, match } = target;

    const rateResult = await checkRateLimit('admin-match-reopen', player.playerId, {
      limit: 20,
      windowSeconds: 60 * 60,
    });
    if (!rateResult.allowed) return rateLimitedResponse(rateResult.retryAfterSeconds);

    let rawBody: unknown = null;
    try {
      rawBody = await request.json();
    } catch {
      rawBody = null;
    }
    const parsed = matchReopenSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const result = target.kind === 'phase'
      ? await (await nativeCorrectionServices(target.owner)).reopenMatch(id, player.playerId)
      : await reopenMatch(id, player.playerId);
    const incomplete = result.failed_steps.length > 0;

    await revalidateCorrectionTarget(target);

    const audit = correctionAuditTarget(target);
    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'match.reopen',
      resource_type: audit.resourceType,
      resource_id: id,
      resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
      changes: {
        status: { before: result.from_status, after: 'in_progress' },
        winner_id: { before: match.winner_id, after: null },
      },
      metadata: {
        ...audit.metadata,
        reason: parsed.data.reason,
        from_status: result.from_status,
        ratings_rebuilt_players: result.ratings_rebuilt_players,
        bracket_matches_removed: result.bracket_matches_removed,
        ...(incomplete ? { incomplete: true, failed_steps: result.failed_steps } : {}),
        ...(result.stage_already_ended ? { stage_already_ended: true } : {}),
      },
    });

    if (incomplete) {
      // The status change is committed and stays; reopenMatch already logged
      // each failed step. The admin still learns the reopen did not fully succeed.
      const count = result.failed_steps.length;
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `The match was reopened, but ${count} follow-up step${count === 1 ? '' : 's'} failed. The failure was logged; a site admin should run the season reconcile.`,
          code: 'match_reopen_incomplete',
          // The notice of an ended stage has no `data` to ride in on, so it travels as flat params (`stageEndedApiWarning`).
          params: { count, ...(result.stage_already_ended ? stageEndedParams(result.stage_already_ended) : {}) },
        },
        { status: 500 }
      );
    }

    return NextResponse.json<ApiResult<ReopenMatchResult>>({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to reopen the match');
  }
}
