import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getMatchById, updateMatchStatus } from '@/lib/supabase/queries/matches';
import { validateTransition } from '@/lib/tournament/match-state';
import { revalidateMatchPages } from '@/lib/revalidation';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { finalizeMatchCompletion } from '@/lib/match/finalize';
import { confirmMatchSchema, formatZodErrors } from '@/lib/validation';
import { logAuditEvent } from '@/lib/audit/log';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import type { Match } from '@/types/match';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ mid: string }>;
}

// Authenticated — confirm or dispute a match result
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { mid } = await params;
    const invalidMid = rejectInvalidPathId(mid, 'INVALID_MATCH_ID');
    if (invalidMid) return invalidMid;

    const rateResult = await checkRateLimit('confirm-match', player.playerId, { limit: 30, windowSeconds: 60 * 60 });
    if (!rateResult.allowed) return rateLimitedResponse(rateResult.retryAfterSeconds);

    const rawBody = await request.json();
    const parsedBody = confirmMatchSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      const issues = formatZodErrors(parsedBody.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const { action, winner_id: requestedWinnerId, notes, reason } = parsedBody.data;

    const match = await getMatchById(mid);

    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 }
      );
    }

    const targetStatus = action === 'confirm' ? 'completed' as const : 'disputed' as const;

    // Site admins or resource admins for this tournament can act as admin
    const hasAdminAccess = player.isAdmin ||
      await isResourceAdminFor(player.playerId, 'tournament', match.tournament_id);

    if ((requestedWinnerId || notes) && !hasAdminAccess) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Only admins can override match winner or notes', code: 'match_override_admin_only' },
        { status: 403 }
      );
    }

    const winnerId = targetStatus === 'completed'
      ? requestedWinnerId ?? match.winner_id
      : undefined;

    if (targetStatus === 'completed' && winnerId !== match.player_1_id && winnerId !== match.player_2_id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Winner must be one of the match participants', code: 'match_winner_not_participant' },
        { status: 400 }
      );
    }

    const result = validateTransition(match.status, targetStatus, {
      actor_id: player.playerId,
      is_admin: hasAdminAccess,
      winner_id: winnerId ?? undefined,
      player_1_id: match.player_1_id,
      player_2_id: match.player_2_id,
    });

    if (!result.valid) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: result.error ?? 'Invalid transition', code: result.code, params: result.params },
        { status: 400 }
      );
    }

    // The confirmer should not be the submitter (unless admin)
    if (action === 'confirm' && match.submitter_id === player.playerId && !hasAdminAccess) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Cannot confirm your own submission', code: 'match_confirm_own_submission' },
        { status: 400 }
      );
    }

    const previousStatus = match.status;
    const updated = await updateMatchStatus(
      mid,
      targetStatus,
      targetStatus === 'completed' ? winnerId : undefined,
      // A dispute keeps the original reporter; the disputer is recorded in the
      // match.dispute audit event instead.
      targetStatus === 'completed' ? player.playerId : undefined,
      notes,
      previousStatus
    );

    if (!updated) {
      const current = await getMatchById(mid);
      if (hasAdminAccess) {
        // An admin acts on what the page showed; if the match moved on, say so
        // instead of reporting a success that wrote nothing.
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: 'The match changed while you were editing it; your change was not applied. Reload and review it.',
            code: 'match_state_changed',
          },
          { status: 409 }
        );
      }
      return NextResponse.json<ApiResult<Match>>({
        success: true,
        data: current ?? match,
      });
    }

    if (targetStatus === 'disputed') {
      // The dispute reason is audit data, never match.notes. A player gives it
      // as `reason`; an admin may give it as `reason` or as the notes text.
      const disputeReason = reason ?? (hasAdminAccess ? notes || undefined : undefined);
      logAuditEvent({
        actor_id: player.playerId,
        actor_name: player.name,
        action: 'match.dispute',
        resource_type: 'match',
        resource_id: mid,
        resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
        changes: {
          status: { before: previousStatus, after: 'disputed' },
        },
        metadata: {
          tournament_id: match.tournament_id,
          ...(disputeReason ? { reason: disputeReason } : {}),
          by_admin: hasAdminAccess,
        },
      });
    }

    if (
      targetStatus === 'completed' &&
      hasAdminAccess &&
      (requestedWinnerId || notes || match.status === 'disputed')
    ) {
      logAuditEvent({
        actor_id: player.playerId,
        actor_name: player.name,
        action: 'match.override',
        resource_type: 'match',
        resource_id: mid,
        resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
        changes: {
          status: { before: previousStatus, after: targetStatus },
          winner_id: { before: match.winner_id, after: targetStatus === 'completed' ? winnerId : match.winner_id },
          notes: { before: match.notes, after: notes ?? match.notes },
        },
      });
    }

    if (targetStatus === 'completed' && winnerId) {
      const finalize = await finalizeMatchCompletion({
        match: { ...match, winner_id: winnerId, status: 'completed' },
        winnerId,
        previousStatus,
      });
      if (!finalize.finalized) {
        // Unreachable after the checks above (winner is a participant, the
        // transition left a non-completed status); surface it as a 500.
        throw new Error(`Finalize did not run for match ${mid}: ${finalize.reason ?? 'unknown'}`);
      }
      const failedSteps = finalize.failed_steps ?? [];
      if (failedSteps.length > 0) {
        // The completion itself is committed and stays; finalize already logged
        // each step's error and wrote match.finalize_failed for admins. The
        // caller still learns that the confirm did not fully succeed (code
        // review C2; same shape as the cron's auto_confirm_partial_failure).
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: `The result was confirmed, but ${failedSteps.length} follow-up step${failedSteps.length === 1 ? '' : 's'} failed.`,
            code: 'match_finalize_incomplete',
            params: { count: failedSteps.length },
          },
          { status: 500 }
        );
      }
    } else {
      await revalidateMatchPages(match.tournament_id, match.id);
      const tournament = await getTournamentById(match.tournament_id);
      if (tournament) {
        const disputePayload = {
          event_type: 'match_disputed' as const,
          tournament_id: match.tournament_id,
          season_id: tournament.season_id,
          data: {
            kind: 'match_disputed' as const,
            player_1_name: match.player_1_name,
            player_2_name: match.player_2_name,
            disputer_name: player.name,
            tournament_name: tournament.name,
          },
        };
        void emitDiscordEvent(disputePayload);
        void emitSocialEvent(disputePayload);
      }
    }

    return NextResponse.json<ApiResult<Match>>({
      success: true,
      data: updated,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update match');
  }
}
