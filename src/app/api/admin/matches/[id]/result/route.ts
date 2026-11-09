import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { authorizeMatchAdmin } from '@/lib/auth/match-admin';
import { formatZodErrors, matchResultSchema } from '@/lib/validation';
import { getMatchById, updateMatchStatus } from '@/lib/supabase/queries/matches';
import { validateTransition } from '@/lib/tournament/match-state';
import {
  discardStagedAdminOutcome,
  finalizeMatchCompletion,
  stageAdminOutcome,
  type StagedAdminOutcome,
} from '@/lib/match/finalize';
import { StagedOutcomeBlockedError } from '@/lib/match/staged-outcome';
import { logger } from '@/lib/logger';
import { revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import type { Match } from '@/types/match';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * The status write did not complete the match (it lost the compare-and-set or threw): the outcome staged before it
 * describes a result that never happened, so it goes. It stays when its status is unknown (`current` null: the write
 * may have committed). When the match is completed by now, the request that completed it either rewrote the row (an
 * admin result: the row is no longer ours) or finalized without any admin intent (a player's confirmation, the
 * auto-confirm), which keeps our admin row and would score a played match as a forfeit; `staged` identifies our own
 * row so exactly that one is taken back (and the played row put in its place). Without a handle (nothing written, or
 * not readable back) a completed match's row is left alone. Best effort, logged.
 */
async function unstageOutcome(
  matchId: string,
  current: Pick<Match, 'status'> | null,
  staged: StagedAdminOutcome | null
): Promise<void> {
  if (current === null || (current.status === 'completed' && staged === null)) return;
  try {
    await discardStagedAdminOutcome(matchId, staged);
  } catch (err) {
    logger.error('admin-match-result', 'could not remove the staged outcome of a result that did not complete', { matchId, error: err });
  }
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
 * required and lands in the `match.admin_result` audit event. `outcome` (played,
 * forfeit or no_show; default played) and the reason become the match's admin
 * `match_outcomes` row: a format with forfeit scoring scores a forfeit or
 * no-show apart from a played win. The row is written BEFORE the status flip
 * (`stageAdminOutcome`), so a completed match can never lose the admin's
 * intent to a failed follow-up write (the heal would write a played row); a
 * flip that loses the compare-and-set removes it again (only the row it wrote itself, even when the match was
 * completed meanwhile by a request without an admin outcome). Finalize's outcome
 * step rewrites it with the faints of a played result. A match a replay-tie has
 * disputed since the read above keeps its `unresolved` row: staging refuses and the
 * request answers 409 `match_state_changed`; a dispute that lands between the staging
 * and the status write has its row put back when the staged one is taken back.
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
    const { winner_id: winnerId, reason, outcome } = parsed.data;

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
    const adminOutcome = { kind: outcome, reason, setBy: player.playerId };
    let staged: StagedAdminOutcome | null;
    try {
      staged = (await stageAdminOutcome(id, adminOutcome)) ?? null;
    } catch (err) {
      if (!(err instanceof StagedOutcomeBlockedError)) throw err;
      // A replay-tie disputed the match since it was read: a deliberate client-facing 409, logged so the dispute is traceable.
      logger.warn('admin-match-result', 'staged outcome blocked: the match changed state since it was read', { matchId: id, status: err.status, error: err });
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `The match changed to ${err.status} while you were editing it. Review it and try again.`,
          code: 'match_state_changed',
          params: { status: err.status },
        },
        { status: 409 }
      );
    }
    let updated: Match | null;
    try {
      updated = await updateMatchStatus(
        id,
        'completed',
        winnerId,
        // The original reporter stays the submitter; an unplayed match gets the admin.
        match.submitter_id ?? player.playerId,
        undefined,
        previousStatus
      );
    } catch (err) {
      // The write threw, so it may have committed: a completed match may be this request's own, whose row stays.
      const current = await getMatchById(id).catch(() => null);
      await unstageOutcome(id, current, current?.status === 'completed' ? null : staged);
      throw err;
    }

    if (!updated) {
      // The compare-and-set missed: the match left `previousStatus` meanwhile.
      const current = await getMatchById(id);
      await unstageOutcome(id, current, staged);
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
        outcome,
        from_status: previousStatus,
        games_recorded: match.games.length,
      },
    });

    const finalize = await finalizeMatchCompletion({
      match: { ...match, winner_id: winnerId, status: 'completed' },
      winnerId,
      previousStatus,
      adminOutcome,
    });
    if (!finalize.finalized && finalize.reason === 'match_changed') {
      // Another request reset or reopened the match after the status flip above; it owns the cleanup, nothing is left to finalize.
      const status = finalize.current_status ?? 'removed';
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `The match changed to ${status} while you were editing it. Review it and try again.`,
          code: 'match_state_changed',
          params: { status },
        },
        { status: 409 }
      );
    }
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
