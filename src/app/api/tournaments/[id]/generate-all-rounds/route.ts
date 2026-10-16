import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getTournamentById,
  getParticipants,
  updateTournament,
} from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament, createRound } from '@/lib/supabase/queries/rounds';
import { createMatchBatch } from '@/lib/supabase/queries/matches';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { generateRoundRobinRound, getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
import { expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { Round } from '@/types/round';
import type { Pairing } from '@/lib/tournament/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/tournaments/[id]/generate-all-rounds
 *
 * Admin: Generate all remaining rounds for a Round Robin tournament.
 * Round Robin pairings are deterministic (circle method), so all
 * rounds can be created upfront without waiting for results.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('tournament', id);

    const tournament = await getTournamentById(id);
    if (!tournament) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament not found', code: 'tournament_not_found' },
        { status: 404 }
      );
    }

    if (tournament.bracket_type !== 'round_robin') {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Generate-all-rounds is only supported for round_robin tournaments',
          code: 'rounds_round_robin_only',
        },
        { status: 400 }
      );
    }

    if (tournament.status === 'completed') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament is already completed', code: 'tournament_already_completed' },
        { status: 400 }
      );
    }

    const participants = await getParticipants(id);
    if (participants.length < 2) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Need at least 2 participants', code: 'tournament_participants_too_few' },
        { status: 400 }
      );
    }

    const existingRounds = await getRoundsByTournament(id);
    const existingRoundNumbers = new Set(existingRounds.map((r) => r.round_number));
    const groups = await getGroupsByTournament(id);

    // Determine total rounds needed and which are missing
    const participantCount =
      groups.length > 0
        ? Math.max(...groups.map((g) => g.members.length))
        : participants.length;
    const totalRounds = getRoundRobinTotalRounds(participantCount);

    const roundsToGenerate: number[] = [];
    for (let r = 1; r <= totalRounds; r++) {
      if (!existingRoundNumbers.has(r)) {
        roundsToGenerate.push(r);
      }
    }

    if (roundsToGenerate.length === 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'All rounds have already been generated', code: 'rounds_all_generated' },
        { status: 400 }
      );
    }

    const createdRounds: Round[] = [];

    for (const roundNumber of roundsToGenerate) {
      const roundName = `Round ${roundNumber}`;
      const roundBestOf =
        tournament.bo_overrides[roundName] ?? tournament.best_of_default;

      let allPairings: Pairing[] = [];

      if (groups.length > 0) {
        for (const group of groups) {
          const groupPlayerIds = group.members.map((m) => m.player_id);
          const generated = generateRoundRobinRound(groupPlayerIds, roundNumber);
          allPairings.push(...generated.pairings);
        }
      } else {
        const participantIds = participants.map((p) => p.id);
        const generated = generateRoundRobinRound(participantIds, roundNumber);
        allPairings = generated.pairings;
      }

      const round = await createRound({
        tournament_id: id,
        name: roundName,
        round_number: roundNumber,
        best_of: roundBestOf,
      });

      if (allPairings.length > 0) {
        const matchInputs = allPairings.map((pairing) => ({
          round_id: round.id,
          tournament_id: id,
          player_1_id: pairing.player_1_id,
          player_2_id: pairing.player_2_id,
        }));
        await createMatchBatch(matchInputs);
      }

      createdRounds.push(round);
    }

    // Update tournament to the highest round number
    const highestRound = Math.max(...roundsToGenerate);
    const updates: Record<string, unknown> = { current_round: highestRound };
    if (tournament.status === 'upcoming') {
      updates.status = 'active';
    }
    await updateTournament(id, updates);
    expireTournamentReads(id, tournament.season_id);

    return NextResponse.json<ApiResult<Round[]>>(
      { success: true, data: createdRounds },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to generate all rounds');
  }
}
