import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { manualRoundSchema, formatZodErrors } from '@/lib/validation';
import {
  getTournamentById,
  getParticipants,
} from '@/lib/supabase/queries/tournaments';
import { kitWriteFence } from '@/lib/format-engine/write-fence';
import { getRoundsByTournament, createRoundWithMatches } from '@/lib/supabase/queries/rounds';
import { seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import { ensurePhaseGroupsFromLeague } from '@/lib/tournament/group-rounds';
import { assertLegacyEliminationRoundSettled } from '@/lib/tournament/previous-round-guard';
import { expireTournamentReads } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import {
  announceKitRound,
  assertNoOpenRoundBeforeNext,
  assertPhaseOpenForRounds,
  assertPhaseReadyForFirstRound,
  fillKitRoundDeadline,
  loadKitPhaseOfTournament,
  wantsForcedStart,
} from '@/lib/format-engine/route-guards';
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
 * Bypasses the pairing algorithm entirely. The round of a kit league's phase is written like a generated one: a stage
 * that reached its end is refused (409 `rounds_stage_ended`), the stage calendar gives the round its deadline and the
 * format reacts (`stage_start` for the first round, `round_start`).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('tournament', id);
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

    // A custom league without an attached format cannot start; a kit phase whose stage reached its end takes no round.
    const kitPhase = await loadKitPhaseOfTournament(tournament);
    // A stage that ends on a condition is evaluated when a round finishes: no round is written ahead of one still in play,
    // or the phase would complete with that round's matches stranded. A round robin skips the current-round check below
    // and a challenge ladder has no generator, so both rely on this. It reads before the end check on purpose: a match
    // that completes in between is then seen by the end check, which refuses the round when the condition holds.
    const existingRounds = await getRoundsByTournament(id);
    await assertNoOpenRoundBeforeNext(id, kitPhase, existingRounds);
    await assertPhaseOpenForRounds(tournament, kitPhase);
    // The first round waits for the format's own set-up (a draw, the actions players owe); an admin may force it. The
    // forced start is audited once the round is written (`announceKitRound`), not before the request can still be refused.
    const forcedStart = await assertPhaseReadyForFirstRound(tournament, kitPhase, {
      force: wantsForcedStart(request),
      actor: { id: admin.playerId, name: admin.name },
    });

    // 3. Validate current round is completed (if any)
    //    Round Robin pairings are deterministic, so skip this check for RR.
    //    (`existingRounds` was read above, before the stage-end checks.)
    // A new elimination bracket is built whole by the bracket engine. A manual first round would be an unstructured
    // one, after which the legacy per-round generator could carry on and build a bracket without its slot graph.
    if (
      (tournament.bracket_type === 'single_elim' || tournament.bracket_type === 'double_elim') &&
      existingRounds.length === 0
    ) {
      throw new UserFacingError('Elimination brackets are built by the bracket engine. Use Generate Bracket instead.', {
        code: 'BRACKET_V2_REQUIRED',
      });
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
      if (tournament.bracket_type === 'single_elim' || tournament.bracket_type === 'double_elim') {
        await assertLegacyEliminationRoundSettled(id, currentRound);
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

    // The single unpaired participant sits out: a Swiss / round robin bye,
    // stored on the round exactly as the generators store theirs. Elimination
    // byes are structural and are not recorded here.
    const byePlayerIds =
      tournament.bracket_type === 'swiss' || tournament.bracket_type === 'round_robin'
        ? participants.filter((p) => !usedPlayerIds.has(p.id)).map((p) => p.id)
        : [];

    // 6. Create round (a table phase of a grouped league mirrors the league groups first, see above)
    const nextRoundNumber = tournament.current_round + 1;
    const roundName = body.name?.trim() || `Round ${nextRoundNumber}`;
    const roundBestOf =
      body.best_of ?? tournament.bo_overrides[roundName] ?? tournament.best_of_default;

    // The mirrored groups and the round are separate commits, and a deadline write can fail after the round committed, so
    // the public reads expire in a finally once something committed (a write the database refused expires nothing).
    let round: Round;
    let committed = false;
    try {
      if (tournament.season_id) {
        await ensurePhaseGroupsFromLeague(tournament.season_id, tournament);
        committed = true;
      }

      // 7. The round and its match stubs are one transaction under the phase row lock (`round_write`): a stage end that
      // completed the phase after the guards above read it refuses the write (409 `rounds_phase_completed`) and leaves no
      // empty round behind.
      round = await createRoundWithMatches({
        tournament_id: id,
        name: roundName,
        round_number: nextRoundNumber,
        best_of: roundBestOf,
        bye_player_ids: byePlayerIds,
        matches: body.pairings.map((pairing) => ({
          player_1_id: pairing.player_1_id,
          player_2_id: pairing.player_2_id,
        })),
        ...kitWriteFence(kitPhase),
      });

      committed = true;

      // 8. The phase status and round counter moved in the round's own transaction (`round_write`).
      round = await fillKitRoundDeadline(tournament, kitPhase, round);
    } finally {
      if (committed) expireTournamentReads(id, tournament.season_id);
    }
    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'round.generate',
      resource_type: 'round',
      resource_id: round.id,
      resource_name: round.name,
      metadata: {
        tournament_id: id,
        round_number: nextRoundNumber,
        matches: body.pairings.length,
        byes: byePlayerIds.length,
        manual: true,
        ...(kitPhase ? { engine: 'kit' } : {}),
      },
    });
    await announceKitRound(tournament, kitPhase, { roundNumber: nextRoundNumber }, tournament.status === 'upcoming', forcedStart);

    return NextResponse.json<ApiResult<Round>>(
      { success: true, data: round },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create manual round');
  }
}
