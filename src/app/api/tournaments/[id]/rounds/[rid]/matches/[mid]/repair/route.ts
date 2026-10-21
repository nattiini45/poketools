import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { adminMatchRepairSchema, formatZodErrors } from '@/lib/validation';
import { getMatchById, repairMatchPairing } from '@/lib/supabase/queries/matches';
import { cancelPendingMatchProposalsForMatch } from '@/lib/supabase/queries/match-proposals';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getParticipants } from '@/lib/supabase/queries/tournaments';
import { logAuditEvent } from '@/lib/audit/log';
import { revalidateMatchPages } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

/**
 * PATCH /api/tournaments/[id]/rounds/[rid]/matches/[mid]/repair
 *
 * Re-pair a match: replaces the two participants and resets it to scheduled
 * with no winner, submitter, or date.
 *
 * Admin use only — for correcting bad pairings mid-tournament.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; rid: string; mid: string }> }
) {
  try {
    const { id: tournamentId, rid: roundId, mid: matchId } = await params;

    // Check admin access to the tournament
    const admin = await requireResourceAdmin('tournament', tournamentId);
    const invalidTournamentId = rejectInvalidPathId(tournamentId, 'INVALID_TOURNAMENT_ID');
    if (invalidTournamentId) return invalidTournamentId;
    const invalidRoundId = rejectInvalidPathId(roundId, 'INVALID_ROUND_ID');
    if (invalidRoundId) return invalidRoundId;
    const invalidMatchId = rejectInvalidPathId(matchId, 'INVALID_MATCH_ID');
    if (invalidMatchId) return invalidMatchId;

    const rawBody = await request.json().catch(() => null);
    const zodResult = adminMatchRepairSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    // Verify match belongs to this round
    const match = await getMatchById(matchId);
    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'repair_match_not_found' },
        { status: 404 }
      );
    }
    if (match.round_id !== roundId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match does not belong to this round', code: 'repair_match_wrong_round' },
        { status: 400 }
      );
    }
    if (match.tournament_id !== tournamentId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match does not belong to this tournament', code: 'repair_match_wrong_tournament' },
        { status: 400 }
      );
    }

    if (match.status !== 'scheduled' && match.status !== 'in_progress') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Only scheduled or in-progress matches can be re-paired', code: 'repair_match_status_locked' },
        { status: 409 }
      );
    }

    if (match.games.length > 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Cannot re-pair a match with submitted games. Reset the match first.', code: 'repair_match_has_games' },
        { status: 409 }
      );
    }

    const round = await getRoundById(roundId);
    if (!round || round.tournament_id !== tournamentId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Round not found for this tournament', code: 'repair_round_not_found' },
        { status: 404 }
      );
    }

    const participants = await getParticipants(tournamentId);
    const participantIds = new Set(participants.map((participant) => participant.id));
    if (!participantIds.has(body.player_1_id) || !participantIds.has(body.player_2_id)) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Both players must be tournament participants', code: 'repair_players_not_participants' },
        { status: 400 }
      );
    }

    const before = {
      status: match.status,
      winner_id: match.winner_id,
      player_1_id: match.player_1_id,
      player_2_id: match.player_2_id,
    };

    const updated = await repairMatchPairing(matchId, body.player_1_id, body.player_2_id);
    const cancelledProposals = await cancelPendingMatchProposalsForMatch(matchId);

    await revalidateMatchPages(tournamentId, matchId);

    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'match.repair',
      resource_type: 'match',
      resource_id: matchId,
      resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
      changes: {
        status: { before: before.status, after: updated.status },
        player_1_id: { before: before.player_1_id, after: updated.player_1_id },
        player_2_id: { before: before.player_2_id, after: updated.player_2_id },
        winner_id: { before: before.winner_id, after: null },
        submitter_id: { before: match.submitter_id, after: null },
      },
      metadata: {
        before_player_1_name: match.player_1_name,
        before_player_2_name: match.player_2_name,
        after_player_1_name: updated.player_1_name,
        after_player_2_name: updated.player_2_name,
        cancelled_proposals: cancelledProposals.length,
      },
    });

    return NextResponse.json<ApiResult<typeof updated>>({ success: true, data: updated });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to repair match');
  }
}