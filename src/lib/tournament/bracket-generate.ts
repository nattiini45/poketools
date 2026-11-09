import type { Tournament } from '@/types/tournament';
import type { ParticipantWithSeed } from '@/types/tournament';
import type { MatchWithPlayers } from '@/types/match';
import { bracketStructureOptionsOf, buildBracketStructureForParticipants } from './bracket-structure';
import {
  buildSlotResolutionsFromMatches,
  materializeReadySlots,
} from './bracket-propagation';
import { createRound, getRoundsByTournament, updateRoundStatus } from '@/lib/supabase/queries/rounds';
import { getMatchById, getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { freezeEnrollment, updateTournament } from '@/lib/supabase/queries/tournaments';
import { resetMatch } from '@/lib/pkmn/game-pipeline';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { tournamentMachine } from './tournament-state';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase/client';

export interface GenerateBracketResult {
  rounds_created: number;
  matches_materialized: number;
  /** Present only when the first round was started (`startFirstRound`) and the start succeeded. */
  started_round_id?: string;
  /**
   * Present (true) only on a regenerate when taking back the league format's effects of a reset played match
   * failed. The match rows are deleted right after, so the format cron cannot retry it; clients show the catalogue
   * warning `admin_game_format_revert_failed`.
   */
  format_revert_failed?: boolean;
  /**
   * Present (true) only when another writer moved the tournament's status while the bracket was written, so this call
   * did not move it: the caller's status read is stale then, and nothing may be derived from it (a `stage_start` for a
   * phase that was upcoming).
   */
  status_moved_elsewhere?: true;
}

export interface GenerateBracketOptions {
  /** Also start the first round (best effort). Default false: every round stays pending. */
  startFirstRound?: boolean;
  /** The caller (a regenerate) already moved the status to active before its own writes; only the counter is written here. */
  statusClaimed?: boolean;
}

/**
 * The status move of a bracket (tournamentMachine): it starts an upcoming tournament, keeps an active one active and
 * restarts a completed one, as a compare-and-set on the status the caller read (409 `tournament_status_changed` when it
 * moved). A regenerate claims it before its first destructive write, so a move in between refuses the regenerate before
 * anything was reset or deleted.
 */
async function claimBracketStart(tournament: Tournament, currentRound: number): Promise<void> {
  if (tournament.status !== 'active') tournamentMachine.assertTransition(tournament.status, 'active', 'system');
  await updateTournament(tournament.id, { status: 'active', current_round: currentRound }, { from: tournament.status });
}

/** The bracket of these participants, or the refusal of a tournament that is not elimination or has too few of them. */
function bracketStructureOrRefuse(tournament: Tournament, participants: ParticipantWithSeed[]) {
  if (tournament.bracket_type !== 'single_elim' && tournament.bracket_type !== 'double_elim') {
    throw new Error('Full bracket generation only applies to elimination formats');
  }
  const structure = buildBracketStructureForParticipants(
    tournament.bracket_type,
    participants,
    bracketStructureOptionsOf(tournament)
  );
  if (!structure) {
    throw new UserFacingError('Need at least 2 participants', {
      code: 'tournament_participants_too_few',
      status: 400,
    });
  }
  return structure;
}

/**
 * Generate the full elimination bracket: all round rows + initial match materialization.
 */
export async function generateEliminationBracket(
  tournament: Tournament,
  participants: ParticipantWithSeed[],
  options: GenerateBracketOptions = {}
): Promise<GenerateBracketResult> {
  const existingRounds = await getRoundsByTournament(tournament.id);
  if (existingRounds.length > 0) {
    throw new UserFacingError('Bracket already generated', {
      code: 'bracket_already_generated',
      status: 409,
    });
  }

  const structure = bracketStructureOrRefuse(tournament, participants);

  const roundIdByGlobalNumber = new Map<number, string>();

  for (const roundDef of structure.rounds) {
    const roundBestOf =
      tournament.bo_overrides[roundDef.name] ?? tournament.best_of_default;
    const round = await createRound({
      tournament_id: tournament.id,
      name: roundDef.name,
      round_number: roundDef.round_number,
      best_of: roundBestOf,
      bracket_side: roundDef.bracket_side,
    });
    roundIdByGlobalNumber.set(roundDef.round_number, round.id);
  }

  const matches = await getMatchesByTournament(tournament.id);
  const slotResolutions = buildSlotResolutionsFromMatches(
    structure.slots,
    matches,
    new Map()
  );

  const created = await materializeReadySlots(
    tournament.id,
    tournament,
    participants,
    structure,
    roundIdByGlobalNumber,
    matches,
    slotResolutions
  );

  await freezeEnrollment(tournament.id);

  // The bracket is written: the status follows it. A status another writer moved since the caller's read (an admin completed
  // the tournament meanwhile) is kept, not overwritten, and the written bracket is not reported as a failure.
  const firstRoundNumber = structure.rounds[0]?.round_number ?? 1;
  let statusMovedElsewhere = false;
  if (options.statusClaimed) {
    await updateTournament(tournament.id, { current_round: firstRoundNumber });
  } else {
    try {
      await claimBracketStart(tournament, firstRoundNumber);
    } catch (err) {
      if (!(err instanceof UserFacingError) || err.code !== 'tournament_status_changed') throw err;
      statusMovedElsewhere = true;
      logger.warn('tournament/bracket-generate', 'the status moved while the bracket was written; kept it', {
        tournamentId: tournament.id,
        from: tournament.status,
      });
    }
  }

  const result: GenerateBracketResult = {
    rounds_created: structure.rounds.length,
    matches_materialized: created.length,
    ...(statusMovedElsewhere ? { status_moved_elsewhere: true as const } : {}),
  };

  // Start the first round when asked. Best effort: the bracket exists either way, and a round that is still
  // pending shows the Start banner. Later rounds are started by the admin.
  // Not after a status another writer moved meanwhile (an admin completed the tournament): no round is opened under it.
  const firstRoundId = roundIdByGlobalNumber.get(firstRoundNumber);
  if (options.startFirstRound && firstRoundId && !statusMovedElsewhere) {
    try {
      await updateRoundStatus(firstRoundId, 'active');
      result.started_round_id = firstRoundId;
    } catch (startErr) {
      console.error('[generate-bracket] Failed to start the first round:', startErr);
    }
  }

  return result;
}

export function isPlayedBracketMatch(
  match: Pick<MatchWithPlayers, 'status' | 'games'>
): boolean {
  return match.status !== 'scheduled' || match.games.length > 0;
}

export interface RegenerateBracketOptions extends GenerateBracketOptions {
  cascade?: boolean;
  adminId?: string;
}

/**
 * Wipe all rounds/matches and regenerate from current seeds.
 * Played matches must be cascade-reset first so aggregates/ratings/EPB roll back.
 */
export async function regenerateEliminationBracket(
  tournament: Tournament,
  participants: ParticipantWithSeed[],
  options: RegenerateBracketOptions = {}
): Promise<GenerateBracketResult> {
  const rounds = await getRoundsByTournament(tournament.id);
  const matches = rounds.length > 0 ? await getMatchesByTournament(tournament.id) : [];
  const played = matches.filter(isPlayedBracketMatch);
  if (played.length > 0 && (!options.cascade || !options.adminId)) {
    throw new UserFacingError(
      `${played.length} played match(es) will be reset and all results rolled back.`,
      { code: 'REGENERATE_PLAYED', params: { count: played.length }, status: 409 }
    );
  }

  // The structure is checked here as well: a regenerate it would refuse leaves the bracket and the status as they were.
  bracketStructureOrRefuse(tournament, participants);

  // The status is claimed after the refusals and before the first write (a reset, a delete), so a status that moved since
  // the caller's read refuses the regenerate before anything changed. The round counter is kept until the old bracket is
  // gone, so a reset or delete that fails part-way does not leave the existing bracket with a counter of 0.
  await claimBracketStart(tournament, tournament.current_round);

  let formatRevertFailed = false;
  if (rounds.length > 0) {
    for (const match of played) {
      const latest = await getMatchById(match.id);
      if (!latest || latest.status === 'scheduled') continue;
      const reset = await resetMatch(match.id, options.adminId!, true);
      if (reset?.format_revert_failed) formatRevertFailed = true;
    }

    const roundIds = rounds.map((r) => r.id);
    const { error: matchErr } = await supabase
      .from('matches')
      .delete()
      .eq('tournament_id', tournament.id);
    if (matchErr) throw matchErr;

    const { error: roundErr } = await supabase
      .from('rounds')
      .delete()
      .in('id', roundIds);
    if (roundErr) throw roundErr;
  }

  await updateTournament(tournament.id, { current_round: 0 });

  const generated = await generateEliminationBracket({ ...tournament, status: 'active' }, participants, {
    startFirstRound: options.startFirstRound,
    statusClaimed: true,
  });
  return formatRevertFailed ? { ...generated, format_revert_failed: true } : generated;
}
