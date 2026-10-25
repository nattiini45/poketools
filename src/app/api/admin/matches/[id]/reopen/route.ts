import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { authorizeMatchAdmin } from '@/lib/auth/match-admin';
import { formatZodErrors, matchReopenSchema } from '@/lib/validation';
import { reopenMatch } from '@/lib/match/reopen';
import { revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ReopenMatchResult } from '@/lib/admin/match-detail';
import type { ApiResult } from '@/types/api';

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
    const { id } = await params;
    const access = await authorizeMatchAdmin(id);
    if (!access.ok) return access.response;
    const { player, match } = access;

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

    const result = await reopenMatch(id, player.playerId);
    const incomplete = result.failed_steps.length > 0;

    await revalidateMatchPages(match.tournament_id, id);

    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'match.reopen',
      resource_type: 'match',
      resource_id: id,
      resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
      changes: {
        status: { before: result.from_status, after: 'in_progress' },
        winner_id: { before: match.winner_id, after: null },
      },
      metadata: {
        tournament_id: match.tournament_id,
        reason: parsed.data.reason,
        from_status: result.from_status,
        ratings_rebuilt_players: result.ratings_rebuilt_players,
        bracket_matches_removed: result.bracket_matches_removed,
        ...(incomplete ? { incomplete: true, failed_steps: result.failed_steps } : {}),
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
          params: { count },
        },
        { status: 500 }
      );
    }

    return NextResponse.json<ApiResult<ReopenMatchResult>>({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to reopen the match');
  }
}
