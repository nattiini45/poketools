import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  getTournamentById,
  getParticipants,
  updateTournament,
} from '@/lib/supabase/queries/tournaments';
import { getSeasonById, updateSeason } from '@/lib/supabase/queries/seasons';
import { getRoundsByTournament, createRound } from '@/lib/supabase/queries/rounds';
import {
  createMatchBatch,
  getCompletedMatchRecords,
  getMatchesByTournament,
} from '@/lib/supabase/queries/matches';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import {
  ensurePhaseGroupsFromLeague,
  pendingWeeks,
  planPhaseWeeks,
  resolveWeekPairings,
  roundsAwaitingMatches,
} from '@/lib/tournament/group-rounds';
import { generateRound } from '@/lib/tournament';
import {
  countUpperBracketStarters,
  startingBracketsFromParticipants,
} from '@/lib/tournament/double-elim';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { triggerTournamentReport } from '@/lib/ai/trigger';
import { expireTournamentReads } from '@/lib/revalidation';
import { ENABLE_KALE_CABBAGE } from '@/lib/feature-flags';
import type { ApiResult } from '@/types/api';
import type { Round } from '@/types/round';
import type { Pairing } from '@/lib/tournament/types';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ tid: string }>;
}

/**
 * POST /api/generate-round/[tid]
 *
 * Admin: Generate the next round of pairings for a tournament.
 * Spec Section 6.4:
 *   1. Fetch completed match results
 *   2. Compute standings
 *   3. Run bracket/pairing algorithm
 *   4. Write Round + Match stubs
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { tid } = await params;
    await requireResourceAdmin('tournament', tid);
    const invalidTid = rejectInvalidPathId(tid, 'INVALID_TOURNAMENT_ID');
    if (invalidTid) return invalidTid;

    // 1. Validate tournament
    const tournament = await getTournamentById(tid);
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

    // 2. Validate that current round (if any) is completed
    //    Round Robin pairings are deterministic (circle method) and don't
    //    depend on results, so rounds can be generated in advance.
    const existingRounds = await getRoundsByTournament(tid);

    const isElimination =
      tournament.bracket_type === 'single_elim' ||
      tournament.bracket_type === 'double_elim';
    if (
      isElimination &&
      existingRounds.some((r) => r.bracket_side != null)
    ) {
      throw new UserFacingError(
        'This tournament bracket is managed by the bracket engine. Use Generate Bracket or Regenerate Bracket instead.',
        { code: 'BRACKET_V2_MANAGED' }
      );
    }

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

    // 3. Get participants
    const participants = await getParticipants(tid);
    if (participants.length < 2) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Need at least 2 participants', code: 'tournament_participants_too_few' },
        { status: 400 }
      );
    }

    const participantIds = participants.map((p) => p.id);
    const participantNames: Record<string, string> = {};
    for (const p of participants) {
      participantNames[p.id] = p.name;
    }

    const startingBrackets = startingBracketsFromParticipants(participants);

    // 4. Fetch match history and groups. A phase of a league with groups mirrors them (rebuilt from the league
    // groups while the phase has no round yet); every other phase keeps its own groups.
    const matchHistory = await getCompletedMatchRecords(tid);
    const groups = tournament.season_id
      ? await ensurePhaseGroupsFromLeague(tournament.season_id, tournament)
      : await getGroupsByTournament(tid);

    // 5. Generate pairings (group-scoped if groups exist)
    const nextRoundNumber = tournament.current_round + 1;

    if (
      tournament.bracket_type === 'double_elim' &&
      nextRoundNumber === 1 &&
      countUpperBracketStarters(participantIds, startingBrackets) < 2
    ) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Double elimination needs at least 2 upper-bracket starters',
          code: 'rounds_double_elim_starters_too_few',
        },
        { status: 400 }
      );
    }

    let allPairings: Pairing[] = [];
    let roundName: string;
    // Grouped phase: the week's round an interrupted call wrote without its matches is filled, not duplicated.
    let emptyRound: Round | undefined;
    // The week this call writes: the next one after `current_round`, except in a grouped round robin phase, where it
    // is the first planned week still to write (`pendingWeeks`), never derived from `current_round`.
    let roundNumber = nextRoundNumber;

    if (groups.length > 0 && tournament.bracket_type === 'round_robin') {
      // Grouped round robin: the week plan (group-schedule.ts). Each group plays its own round count inside the
      // shared weeks (rest weeks for a smaller group); groups that mirror league groups also get the cross-group
      // weeks, and a placement week is paired here from the group tables after the week before.
      const context = { groups, rounds: existingRounds, matches: await getMatchesByTournament(tid) };
      const plan = planPhaseWeeks(context);
      const next = pendingWeeks(context, plan)[0];
      if (!next) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'All rounds have already been generated', code: 'rounds_all_generated' },
          { status: 400 }
        );
      }
      roundNumber = next.week;
      emptyRound = roundsAwaitingMatches(context, plan).get(roundNumber);
      const { resolved } = await resolveWeekPairings(tournament.season_id, context, [roundNumber]);
      allPairings = resolved[0].pairings;
      roundName = `Round ${roundNumber}`;
    } else if (groups.length > 0) {
      // Generate pairings within each group separately
      roundName = `Round ${nextRoundNumber}`;
      for (const group of groups) {
        const groupPlayerIds = group.members.map((m) => m.player_id);
        const groupNames: Record<string, string> = {};
        for (const m of group.members) {
          groupNames[m.player_id] = m.player_name;
        }
        const groupMatches = matchHistory.filter(
          (m) =>
            groupPlayerIds.includes(m.player_1_id) &&
            groupPlayerIds.includes(m.player_2_id)
        );

        const generated = generateRound(
          tournament.bracket_type,
          groupPlayerIds,
          groupNames,
          groupMatches,
          nextRoundNumber,
          { startingBrackets }
        );
        allPairings.push(...generated.pairings);
      }
    } else {
      // No groups — generate pairings across all participants
      const generated = generateRound(
        tournament.bracket_type,
        participantIds,
        participantNames,
        matchHistory,
        nextRoundNumber,
        { startingBrackets }
      );
      allPairings = generated.pairings;
      roundName = generated.round_name;
    }

    // A round and its matches are two writes, and `current_round` moves only after both. A retry after an interrupted
    // call finds that call's round at this number: without matches it is filled (never a second round with the same
    // number); with matches the week is already written and only the counter lags, so nothing is written twice.
    if (!emptyRound) {
      const written = existingRounds.filter((round) => round.round_number === roundNumber);
      if (written.length > 0) {
        const withMatches = new Set((await getMatchesByTournament(tid)).map((match) => match.round_id));
        const filled = written.find((round) => withMatches.has(round.id));
        if (filled) {
          return NextResponse.json<ApiResult<never>>(
            {
              success: false,
              error: `${filled.name} already exists with its matches. Delete it to generate it again.`,
              code: 'rounds_round_already_written',
              params: { round: filled.name },
            },
            { status: 409 }
          );
        }
        emptyRound = written[0];
      }
    }

    // 6. Create round record (use bo_overrides if round name matches, else default)
    const roundBestOf = tournament.bo_overrides[roundName] ?? tournament.best_of_default;
    const round =
      emptyRound ??
      (await createRound({
        tournament_id: tid,
        name: roundName,
        round_number: roundNumber,
        best_of: roundBestOf,
      }));

    // 7. Create match stubs
    if (allPairings.length > 0) {
      const matchInputs = allPairings.map((pairing) => ({
        round_id: round.id,
        tournament_id: tid,
        player_1_id: pairing.player_1_id,
        player_2_id: pairing.player_2_id,
      }));
      await createMatchBatch(matchInputs);
    }

    // 8. Update tournament to active and increment round (a grouped phase that filled an earlier week never moves
    // current_round back).
    const currentRound = Math.max(tournament.current_round, roundNumber);
    if (tournament.status === 'upcoming') {
      await updateTournament(tid, {
        status: 'active',
        current_round: currentRound,
      });

      // Bubble up: if parent league is still upcoming, transition it to active
      if (tournament.season_id) {
        const season = await getSeasonById(tournament.season_id);
        if (season && season.status === 'upcoming') {
          await updateSeason(season.id, { status: 'active' });
        }
      }
    } else {
      await updateTournament(tid, {
        current_round: currentRound,
      });
    }
    // The new pairings show on the next view of the public pages.
    expireTournamentReads(tid, tournament.season_id);

    // Discord + social notification (fire-and-forget)
    const roundPayload = {
      event_type: 'round_generated' as const,
      tournament_id: tid,
      season_id: tournament.season_id,
      data: {
        kind: 'round_generated' as const,
        tournament_name: tournament.name,
        round_name: roundName,
        pairings: allPairings.map((p) => ({
          player_1_name: participantNames[p.player_1_id] ?? 'Unknown',
          player_2_name: participantNames[p.player_2_id] ?? 'Unknown',
        })),
      },
    };
    void emitDiscordEvent(roundPayload);
    void emitSocialEvent(roundPayload);

    // Emit tournament_started if this was the first round
    if (tournament.status === 'upcoming') {
      const startedPayload = {
        event_type: 'tournament_started' as const,
        tournament_id: tid,
        season_id: tournament.season_id,
        data: {
          kind: 'tournament_status' as const,
          tournament_name: tournament.name,
          new_status: 'active' as const,
        },
      };
      void emitDiscordEvent(startedPayload);
      void emitSocialEvent(startedPayload);
    }

    // Trigger AI round forecast (fire-and-forget) — gated by feature flag
    if (ENABLE_KALE_CABBAGE) {
      triggerTournamentReport(tid, round.id, 'round_forecast');
    }

    return NextResponse.json<ApiResult<Round>>(
      { success: true, data: round },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to generate round');
  }
}
