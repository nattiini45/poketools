import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logger } from '@/lib/logger';
import {
  getTournamentById,
  getParticipants,
  updateTournament,
} from '@/lib/supabase/queries/tournaments';
import {
  getRoundsByTournament,
  createRound,
  updateRoundByePlayers,
  updateRoundStatus,
} from '@/lib/supabase/queries/rounds';
import { createMatchBatch, getMatchesByTournament, getPairedMatchRecords } from '@/lib/supabase/queries/matches';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { generateRoundRobinRound, getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
import { parseGenerateOptions } from '@/lib/tournament/generate-options';
import { assertNoScheduleDrift } from '@/lib/tournament/schedule-drift';
import {
  ensurePhaseGroupsFromLeague,
  pendingWeeks,
  planPhaseWeeks,
  resolveWeekPairings,
  roundsAwaitingMatches,
} from '@/lib/tournament/group-rounds';
import { expireTournamentReads } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import { assertSeasonFormatAttached } from '@/lib/format-studio/attach';
import { loadKitPhase } from '@/lib/format-engine/load';
import {
  filteredRoundRobinRound,
  isChallengeLadder,
  kitStageRounds,
  legRoundRange,
  roundRobinLegRound,
  roundRobinOf,
} from '@/lib/format-engine/pairing';
import { loadPairingAids, openForbiddenPairingCheck, type PairingAids } from '@/lib/format-engine/pairing-server';
import { ensureKitPhaseGroups } from '@/lib/format-engine/groups';
import { mirrorsLeagueGroups } from '@/lib/tournament/phase-week-plan';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { GeneratedRound } from '@/lib/tournament/types';
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
 * A phase of a kit league plays its stage's legs (`legs` times the circle schedule, later legs with sides swapped).
 *
 * Optional JSON body `{ "start_round": true }` starts the lowest-numbered round this call wrote (best effort: if
 * the start fails the round stays pending and the admin starts it by hand); the later rounds stay pending.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('tournament', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_TOURNAMENT_ID');
    if (invalidId) return invalidId;
    const options = await parseGenerateOptions(request);
    if (!options.ok) return options.response;

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

    // A custom league without an attached format cannot start (as in generate-round); a kit phase plays its legs.
    let kitPhase = null;
    if (tournament.season_format_type === 'custom' && tournament.season_id) {
      await assertSeasonFormatAttached(tournament.season_id);
      kitPhase = await loadKitPhase(tournament.season_id, id);
    }
    if (kitPhase?.engine === 'kit' && kitPhase.stage.pairing.kind === 'manual') {
      throw new UserFacingError('This phase is paired by hand. Create its rounds in the manual round editor.', {
        code: 'rounds_manual_pairing',
        status: 409,
      });
    }
    if (kitPhase?.engine === 'kit' && isChallengeLadder(kitPhase.stage.pairing)) {
      throw new UserFacingError('This phase is a challenge ladder: its matches come from accepted challenges. Create its rounds in the manual round editor.', {
        code: 'rounds_challenge_ladder',
        status: 409,
      });
    }
    // A round robin, or a filter over one (the filter drops the rejected pairs from every round).
    const kitPairing = kitPhase?.engine === 'kit' ? roundRobinOf(kitPhase.stage.pairing) : null;
    const filtered = kitPhase?.engine === 'kit' && kitPhase.stage.pairing.kind === 'filter';
    // Pairs the filter rejected, per round to write.
    const forbiddenByRound = new Map<number, number>();

    const participants = await getParticipants(id);
    if (participants.length < 2) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Need at least 2 participants', code: 'tournament_participants_too_few' },
        { status: 400 }
      );
    }

    const aids: PairingAids =
      filtered && kitPhase && tournament.season_id
        ? await loadPairingAids({
            seasonId: tournament.season_id,
            stage: kitPhase.stage,
            roundNumber: 1,
            playerIds: participants.map((p) => p.id),
          })
        : {};
    const existingRounds = await getRoundsByTournament(id);
    // A phase of a league with groups mirrors them (rebuilt from the league groups while it has no round yet).
    let groups = tournament.season_id
      ? await ensurePhaseGroupsFromLeague(tournament.season_id, tournament)
      : await getGroupsByTournament(id);
    // A kit stage with groups forms them before its first round (league groups, when the league has any, win).
    if (kitPairing && kitPhase && tournament.season_id && groups.length === 0) {
      groups = await ensureKitPhaseGroups({
        seasonId: tournament.season_id,
        phaseId: id,
        stage: kitPhase.stage,
        seed: kitPhase.seed,
      });
    }
    // A kit round robin plays each of its own groups as a round robin of the stage's legs; groups that mirror league
    // groups keep the league week plan (cross-group weeks, placement weeks).
    const kitGroups = kitPairing && groups.length > 0 && !mirrorsLeagueGroups(groups) ? groups : null;

    // Every week to write with its pairings, computed in full before the first write. `byePlayerIds` lists the
    // trainers the circle method seats out (a phase without groups); a grouped week has none: a trainer without an
    // in-group match is paired across groups or rests, and the week plan records no bye for it.
    const weeksToWrite: { roundNumber: number; pairings: Pairing[]; byePlayerIds: string[] }[] = [];
    // Written rounds an interrupted write left without matches, keyed by round number; they are filled, not skipped.
    let emptyRounds = new Map<number, Round>();

    if (groups.length > 0 && !kitGroups) {
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
      for (const { week, pairings } of resolved) {
        // A filter over a round robin on league groups drops the rejected pairs from the week plan.
        const allow = aids.allowPairFor?.(week.week);
        const kept = allow ? pairings.filter((p) => allow(p.player_1_id, p.player_2_id)) : pairings;
        if (kept.length < pairings.length) forbiddenByRound.set(week.week, pairings.length - kept.length);
        weeksToWrite.push({ roundNumber: week.week, pairings: kept, byePlayerIds: [] });
      }
    } else {
      // Every round of the circle method that has no round yet, or whose round an interrupted call wrote without
      // its matches (a round robin round of two or more trainers always has a pairing): filled, never skipped.
      const participantIds = participants.map((p) => p.id);
      // The players each circle schedule runs over: the whole phase, or each kit group in its seed order.
      const circles = kitGroups
        ? kitGroups.map((group) => [...group.members].sort((a, b) => a.seed - b.seed).map((member) => member.player_id))
        : [participantIds];
      const circleRounds = (ids: readonly string[]) =>
        kitPairing ? (kitStageRounds(kitPairing, ids.length) ?? 0) : getRoundRobinTotalRounds(ids.length);
      const totalRounds = Math.max(0, ...circles.map(circleRounds));
      const withMatches = new Set((await getMatchesByTournament(id)).map((match) => match.round_id));
      // The circle schedule is rebuilt from the current participant order. A rename or a substitute after the first
      // round can make a missing round repeat a pairing that is already scheduled (any status): refuse before the
      // first write, so no round of a drifted schedule is written.
      const scheduled = await getPairedMatchRecords(id);
      for (let r = 1; r <= totalRounds; r++) {
        const written = existingRounds.filter((round) => round.round_number === r);
        if (written.length > 0 && written.some((round) => withMatches.has(round.id))) continue;
        if (written.length > 0) emptyRounds.set(r, written[0]);
        const pairings: Pairing[] = [];
        const byePlayerIds: string[] = [];
        for (const ids of circles) {
          // A smaller group has played all its rounds and rests while a larger one plays on.
          if (r > circleRounds(ids)) continue;
          const allow = aids.allowPairFor?.(r);
          const generated: GeneratedRound = !kitPairing
            ? generateRoundRobinRound(ids, r)
            : allow
              ? filteredRoundRobinRound(ids, kitPairing, r, allow)
              : roundRobinLegRound(ids, kitPairing, r);
          if (generated.forbidden) forbiddenByRound.set(r, (forbiddenByRound.get(r) ?? 0) + generated.forbidden);
          // A later leg repeats the first leg's pairings on purpose: the drift guard looks inside the round's leg only.
          const leg = kitPairing ? legRoundRange(ids.length, r) : null;
          const members = new Set(ids);
          const own = kitGroups ? scheduled.filter((m) => members.has(m.player_1_id) && members.has(m.player_2_id)) : scheduled;
          const sameLeg = leg ? own.filter((m) => m.round_number >= leg.first && m.round_number <= leg.last) : own;
          assertNoScheduleDrift(`Round ${r}`, generated.pairings, sameLeg, { ignoreRoundNumber: r });
          pairings.push(...generated.pairings);
          byePlayerIds.push(...generated.bye_player_ids);
        }
        weeksToWrite.push({ roundNumber: r, pairings, byePlayerIds });
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

    // Start only the first new round, once every round and its matches are written. Best effort: the rounds exist
    // either way, and a round that is still pending shows the Start banner.
    let startedRoundNumber: number | null = null;
    if (options.startRound && createdRounds.length > 0) {
      const first = createdRounds.reduce((lowest, round) => (round.round_number < lowest.round_number ? round : lowest));
      try {
        const started = await updateRoundStatus(first.id, 'active');
        createdRounds[createdRounds.indexOf(first)] = started;
        startedRoundNumber = first.round_number;
      } catch (startErr) {
        logger.error('generate-all-rounds', 'Failed to start the first new round', {
          tournamentId: id,
          roundId: first.id,
          error: startErr,
        });
      }
    }

    expireTournamentReads(id, tournament.season_id);

    if (kitPhase?.engine === 'kit' && tournament.season_id) {
      for (const [round, forbidden] of forbiddenByRound) {
        await openForbiddenPairingCheck({ seasonId: tournament.season_id, stageKey: kitPhase.stage.key, round, forbidden });
      }
    }

    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'round.generate',
      resource_type: 'tournament',
      resource_id: id,
      resource_name: tournament.name,
      metadata: {
        rounds_created: createdRounds.length,
        round_numbers: createdRounds.map((round) => round.round_number),
        started_round_number: startedRoundNumber,
      },
    });

    return NextResponse.json<ApiResult<Round[]>>(
      { success: true, data: createdRounds },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to generate all rounds');
  }
}
