import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { manualRoundSchema, formatZodErrors } from '@/lib/validation';
import {
  getTournamentById,
  getParticipants,
  updateTournament,
} from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament, createRound } from '@/lib/supabase/queries/rounds';
import { createMatchBatch } from '@/lib/supabase/queries/matches';
import { seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import { ensurePhaseGroupsFromLeague } from '@/lib/tournament/group-rounds';
import { expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { Round } from '@/types/round';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/tournaments/[id]/rounds/manual
 *
 * Admin: Create a round with manually specified matchups.
 * Bypasses the pairing algorithm entirely.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('tournament', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_TOURNAMENT_ID');
    if (invalidId) return invalidId;

    const rawBody = await request.json();
    const zodResult = manualRoundSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    // 2. Validate tournament
    const tournament = await getTournamentById(id);
    if (!tournament) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament not found', code: 'tournament_not_found' },
        { status: 404 }
      );
    }

    if (tournament.status === 'completed') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament is already completed', code: 'tournament_already_completed' },
        { status: 400 }
      );
    }

    // A grouped league's round robin phase follows its week plan (generate-round, generate-all-rounds): a manual round
    // would skip the plan, so it is refused. Other phases of the league mirror the league groups first, like the
    // generate routes (`ensurePhaseGroupsFromLeague`: a Swiss phase before its first round; a no-op for a bracket
    // phase or a league without groups), so a first round is never written without the mirror (docs/season.md).
    if (
      tournament.bracket_type === 'round_robin' &&
      tournament.season_id &&
      (await seasonHasGroups(tournament.season_id))
    ) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'This league has groups, so its table phase follows the week plan. Use Generate Next Round instead.',
          code: 'rounds_manual_league_grouped',
        },
        { status: 409 }
      );
    }

    // 3. Validate current round is completed (if any)
    //    Round Robin pairings are deterministic, so skip this check for RR.
    const existingRounds = await getRoundsByTournament(id);
    if (tournament.bracket_type !== 'round_robin') {
      const currentRound = existingRounds.find(
        (r) => r.round_number === tournament.current_round
      );
      if (currentRound && currentRound.status !== 'completed') {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: `Current round (${currentRound.name}) is not yet completed`,
            code: 'tournament_current_round_incomplete',
            params: { round: currentRound.name },
          },
          { status: 400 }
        );
      }
    }

    // 4. Get participants and validate all player IDs
    const participants = await getParticipants(id);
    const participantIds = new Set(participants.map((p) => p.id));
    const usedPlayerIds = new Set<string>();

    for (const pairing of body.pairings) {
      if (!pairing.player_1_id || !pairing.player_2_id) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Each pairing must have player_1_id and player_2_id', code: 'pairing_players_missing' },
          { status: 400 }
        );
      }

      if (pairing.player_1_id === pairing.player_2_id) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'A player cannot be paired against themselves', code: 'pairing_self' },
          { status: 400 }
        );
      }

      if (!participantIds.has(pairing.player_1_id)) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: `Player ${pairing.player_1_id} is not a participant`,
            code: 'tournament_player_not_participant',
            params: { player: pairing.player_1_id },
          },
          { status: 400 }
        );
      }

      if (!participantIds.has(pairing.player_2_id)) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: `Player ${pairing.player_2_id} is not a participant`,
            code: 'tournament_player_not_participant',
            params: { player: pairing.player_2_id },
          },
          { status: 400 }
        );
      }

      if (usedPlayerIds.has(pairing.player_1_id)) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: `Player ${pairing.player_1_id} appears in multiple pairings`,
            code: 'pairing_player_repeated',
            params: { player: pairing.player_1_id },
          },
          { status: 400 }
        );
      }

      if (usedPlayerIds.has(pairing.player_2_id)) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: `Player ${pairing.player_2_id} appears in multiple pairings`,
            code: 'pairing_player_repeated',
            params: { player: pairing.player_2_id },
          },
          { status: 400 }
        );
      }

      usedPlayerIds.add(pairing.player_1_id);
      usedPlayerIds.add(pairing.player_2_id);
    }

    // 5. Require all participants to be paired (allow one bye for odd count)
    const unpairedCount = participants.length - usedPlayerIds.size;
    if (unpairedCount > 1) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `All participants must be paired. ${unpairedCount} participants are not in any pairing.`,
          code: 'pairing_players_unpaired',
          params: { count: unpairedCount },
        },
        { status: 400 }
      );
    }

    // 6. Create round (a table phase of a grouped league mirrors the league groups first, see above)
    if (tournament.season_id) {
      await ensurePhaseGroupsFromLeague(tournament.season_id, tournament);
    }
    const nextRoundNumber = tournament.current_round + 1;
    const roundName = body.name?.trim() || `Round ${nextRoundNumber}`;
    const roundBestOf =
      body.best_of ?? tournament.bo_overrides[roundName] ?? tournament.best_of_default;

    const round = await createRound({
      tournament_id: id,
      name: roundName,
      round_number: nextRoundNumber,
      best_of: roundBestOf,
    });

    // 7. Create match stubs
    const matchInputs = body.pairings.map((pairing) => ({
      round_id: round.id,
      tournament_id: id,
      player_1_id: pairing.player_1_id,
      player_2_id: pairing.player_2_id,
    }));
    await createMatchBatch(matchInputs);

    // 8. Update tournament status and round counter
    if (tournament.status === 'upcoming') {
      await updateTournament(id, {
        status: 'active',
        current_round: nextRoundNumber,
      });
    } else {
      await updateTournament(id, {
        current_round: nextRoundNumber,
      });
    }
    expireTournamentReads(id, tournament.season_id);

    return NextResponse.json<ApiResult<Round>>(
      { success: true, data: round },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create manual round');
  }
}
