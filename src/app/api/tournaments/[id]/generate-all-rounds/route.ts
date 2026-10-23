import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getTournamentById,
  getParticipants,
  updateTournament,
} from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament, createRound, updateRoundByePlayers } from '@/lib/supabase/queries/rounds';
import { createMatchBatch, getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { generateRoundRobinRound, getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
import {
  ensurePhaseGroupsFromLeague,
  pendingWeeks,
  planPhaseWeeks,
  resolveWeekPairings,
  roundsAwaitingMatches,
} from '@/lib/tournament/group-rounds';
import { expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { Round } from '@/types/round';
import type { Pairing } from '@/lib/tournament/types';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/tournaments/[id]/generate-all-rounds
 *
 * Admin: Generate all remaining rounds for a Round Robin tournament.
 * Round Robin pairings are deterministic (circle method), so all
 * rounds can be created upfront without waiting for results.
 *
 * A grouped phase follows its week plan (`src/lib/tournament/group-schedule.ts`): every group its own round
 * count inside the shared weeks, and for groups that mirror league groups the cross-group weeks. A placement
 * week needs the group tables after the week before, so generation stops in front of it; once every earlier
 * match is completed, the next call generates it and continues to the next placement week. Every week is
 * planned and validated before the first one is written. A round and its matches are two writes: a written week
 * an interrupted call left without matches is filled by the next call (`roundsAwaitingMatches`), never skipped.
 * A phase without groups does the same for its circle-method rounds: a written round with no match is refilled.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('tournament', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_TOURNAMENT_ID');
    if (invalidId) return invalidId;

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
    // A phase of a league with groups mirrors them (rebuilt from the league groups while it has no round yet).
    const groups = tournament.season_id
      ? await ensurePhaseGroupsFromLeague(tournament.season_id, tournament)
      : await getGroupsByTournament(id);

    // Every week to write with its pairings, computed in full before the first write. `byePlayerIds` lists the
    // trainers the circle method seats out (a phase without groups); a grouped week has none: a trainer without an
    // in-group match is paired across groups or rests, and the week plan records no bye for it.
    const weeksToWrite: { roundNumber: number; pairings: Pairing[]; byePlayerIds: string[] }[] = [];
    // Written rounds an interrupted write left without matches, keyed by round number; they are filled, not skipped.
    let emptyRounds = new Map<number, Round>();

    if (groups.length > 0) {
      const context = { groups, rounds: existingRounds, matches: await getMatchesByTournament(id) };
      const plan = planPhaseWeeks(context);
      emptyRounds = roundsAwaitingMatches(context, plan);
      const missing = pendingWeeks(context, plan);
      // Up to (not including) the next placement week, unless the first missing week is one.
      const batch: number[] = [];
      for (const week of missing) {
        if (week.awaitingTables && batch.length > 0) break;
        batch.push(week.week);
      }
      const { resolved } = await resolveWeekPairings(tournament.season_id, context, batch);
      for (const { week, pairings } of resolved) weeksToWrite.push({ roundNumber: week.week, pairings, byePlayerIds: [] });
    } else {
      // Every round of the circle method that has no round yet, or whose round an interrupted call wrote without
      // its matches (a round robin round of two or more trainers always has a pairing): filled, never skipped.
      const totalRounds = getRoundRobinTotalRounds(participants.length);
      const participantIds = participants.map((p) => p.id);
      const withMatches = new Set((await getMatchesByTournament(id)).map((match) => match.round_id));
      for (let r = 1; r <= totalRounds; r++) {
        const written = existingRounds.filter((round) => round.round_number === r);
        if (written.length > 0 && written.some((round) => withMatches.has(round.id))) continue;
        if (written.length > 0) emptyRounds.set(r, written[0]);
        const generated = generateRoundRobinRound(participantIds, r);
        weeksToWrite.push({ roundNumber: r, pairings: generated.pairings, byePlayerIds: generated.bye_player_ids });
      }
    }

    if (weeksToWrite.length === 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'All rounds have already been generated', code: 'rounds_all_generated' },
        { status: 400 }
      );
    }

    const createdRounds: Round[] = [];

    for (const { roundNumber, pairings: allPairings, byePlayerIds } of weeksToWrite) {
      const roundName = `Round ${roundNumber}`;
      const roundBestOf =
        tournament.bo_overrides[roundName] ?? tournament.best_of_default;

      // A reused round (an interrupted call wrote it without matches) is brought to this call's byes, so it carries
      // them exactly like a freshly inserted one.
      const reused = emptyRounds.get(roundNumber);
      let round: Round;
      if (reused) {
        const storedByes = reused.bye_player_ids ?? [];
        const byesChanged =
          storedByes.length !== byePlayerIds.length || storedByes.some((pid) => !byePlayerIds.includes(pid));
        round = byesChanged ? await updateRoundByePlayers(reused.id, byePlayerIds) : reused;
      } else {
        round = await createRound({
          tournament_id: id,
          name: roundName,
          round_number: roundNumber,
          best_of: roundBestOf,
          // Round robin byes are stored for display; they earn nothing in standings.
          bye_player_ids: byePlayerIds,
        });
      }

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
    // Never backwards: a call may fill an earlier week an interrupted call left without matches.
    const highestRound = Math.max(tournament.current_round, ...weeksToWrite.map((week) => week.roundNumber));
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
