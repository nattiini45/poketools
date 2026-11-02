import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { authorizeMatchAdmin } from '@/lib/auth/match-admin';
import { formatZodErrors, matchResultSchema } from '@/lib/validation';
import { getMatchById, updateMatchStatus } from '@/lib/supabase/queries/matches';
import { validateTransition } from '@/lib/tournament/match-state';
import { finalizeMatchCompletion } from '@/lib/match/finalize';
import { revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import type { Match } from '@/types/match';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/matches/[id]/result
 *
 * A site admin, or a resource admin of the match's tournament or league, settles
 * a match that was never played out in the app (a no-show, a player who dropped,
 * a result agreed outside the app, a Champions match with no replay). The match
 * goes from `scheduled` or `in_progress` straight to `completed` with the given
 * winner: no confirmation step, the admin's decision is the confirmation. No
 * game rows are written, so the match has no battle stats (streaks, EPB kills
 * and aggregates treat that as unknown, not as zero). A match that already has
 * games keeps them.
 *
 * The status write is a compare-and-set on the status this request read, so of
 * two simultaneous requests one wins and the other answers 409
 * `match_state_changed`; only the winner runs `finalizeMatchCompletion` (ratings,
 * streaks, bracket propagation, announcements), exactly once. The reason is
 * required and lands in the `match.admin_result` audit event. A real forfeit
 * (scored differently) is out of scope while `CURRENT_ENV.forfeits` is off.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const access = await authorizeMatchAdmin(id);
    if (!access.ok) return access.response;
    const { player, match } = access;

    const rateResult = await checkRateLimit('admin-match-result', player.playerId, {
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
    const parsed = matchResultSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const { winner_id: winnerId, reason } = parsed.data;

    if (match.status !== 'scheduled' && match.status !== 'in_progress') {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `A result can only be set for a match that is scheduled or in progress, but this match is ${match.status}.`,
          code: 'match_result_wrong_status',
          params: { status: match.status },
        },
        { status: 409 }
      );
    }

    // The state machine decides: an admin may complete a scheduled or in-progress
    // match directly, and the winner must be one of its two players.
    const transition = validateTransition(match.status, 'completed', {
      actor_id: player.playerId,
      is_admin: true,
      winner_id: winnerId,
      player_1_id: match.player_1_id,
      player_2_id: match.player_2_id,
    });
    if (!transition.valid) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: transition.error ?? 'Invalid transition', code: transition.code, params: transition.params },
        { status: 400 }
      );
    }

    const previousStatus = match.status;
    const updated = await updateMatchStatus(
      id,
      'completed',
      winnerId,
      // The original reporter stays the submitter; an unplayed match gets the admin.
      match.submitter_id ?? player.playerId,
      undefined,
      previousStatus
    );

    if (!updated) {
      // The compare-and-set missed: the match left `previousStatus` meanwhile.
      const current = await getMatchById(id);
      if (!current) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Match not found', code: 'match_not_found' },
          { status: 404 }
        );
      }
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `The match changed to ${current.status} while you were editing it. Review it and try again.`,
          code: 'match_state_changed',
          params: { status: current.status },
        },
        { status: 409 }
      );
    }

    await revalidateMatchPages(match.tournament_id, id);

    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'match.admin_result',
      resource_type: 'match',
      resource_id: id,
      resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
      changes: {
        status: { before: previousStatus, after: 'completed' },
        winner_id: { before: match.winner_id, after: winnerId },
      },
      metadata: {
        tournament_id: match.tournament_id,
        reason,
        from_status: previousStatus,
        games_recorded: match.games.length,
      },
    });

    const finalize = await finalizeMatchCompletion({
      match: { ...match, winner_id: winnerId, status: 'completed' },
      winnerId,
      previousStatus,
    });
    if (!finalize.finalized) {
      // Unreachable after the checks above (the winner is a participant and the
      // match was not completed); surface it as a 500 with the reason logged.
      throw new Error(`Finalize did not run for match ${id}: ${finalize.reason ?? 'unknown'}`);
    }
    const failedSteps = finalize.failed_steps ?? [];
    if (failedSteps.length > 0) {
      // The completion is committed and stays; finalize logged each step's
      // error and wrote match.finalize_failed for admins, and the cron heals
      // the replay-safe steps. The caller still learns it did not fully succeed.
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `The result was recorded, but ${failedSteps.length} follow-up step${failedSteps.length === 1 ? '' : 's'} failed.`,
          code: 'match_finalize_incomplete',
          params: { count: failedSteps.length },
        },
        { status: 500 }
      );
    }

    return NextResponse.json<ApiResult<Match>>({ success: true, data: updated });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to set the match result');
  }
}
