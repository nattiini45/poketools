import type { Tournament } from '@/types/tournament';
import type { ParticipantWithSeed } from '@/types/tournament';
import type { Match, MatchWithPlayers } from '@/types/match';
import { bracketStructureOptionsOf, buildBracketStructureForParticipants } from './bracket-structure';
import {
  buildSlotResolutionsFromMatches,
  materializeReadySlots,
} from './bracket-propagation';
import {
  getRoundsByTournament,
  updateRoundStatus,
  writeBracket,
  type BracketMatchInput,
  type BracketRoundInput,
} from '@/lib/supabase/queries/rounds';
import { getMatchById, getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { resetMatch } from '@/lib/pkmn/game-pipeline';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { tournamentMachine } from './tournament-state';

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
}

export interface GenerateBracketOptions {
  /** Also start the first round (best effort). Default false: every round stays pending. */
  startFirstRound?: boolean;
}

interface BracketPlan {
  rounds: BracketRoundInput[];
  matches: BracketMatchInput[];
  firstRoundNumber: number;
}

/**
 * The whole bracket of these participants, planned without a write: the rounds (ids chosen here) and the matches whose
 * players are known now (the materializer runs with a collector instead of the match insert). Refuses a tournament that
 * is not elimination or has too few participants, before anything is written.
 */
async function planBracket(tournament: Tournament, participants: ParticipantWithSeed[]): Promise<BracketPlan> {
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

  const rounds: BracketRoundInput[] = structure.rounds.map((roundDef) => ({
    id: crypto.randomUUID(),
    name: roundDef.name,
    round_number: roundDef.round_number,
    best_of: tournament.bo_overrides[roundDef.name] ?? tournament.best_of_default,
    bracket_side: roundDef.bracket_side ?? null,
  }));
  const roundIdByGlobalNumber = new Map(rounds.map((round) => [round.round_number, round.id]));

  const matches: BracketMatchInput[] = [];
  const now = new Date().toISOString();
  await materializeReadySlots(
    tournament.id,
    tournament,
    participants,
    structure,
    roundIdByGlobalNumber,
    [],
    buildSlotResolutionsFromMatches(structure.slots, [], new Map()),
    async (inputs) =>
      inputs.map((input): Match => {
        const planned: BracketMatchInput = {
          id: crypto.randomUUID(),
          round_id: input.round_id,
          player_1_id: input.player_1_id,
          player_2_id: input.player_2_id,
          bracket_side: input.bracket_side ?? null,
          bracket_pos: input.bracket_pos ?? null,
        };
        matches.push(planned);
        return {
          ...planned,
          tournament_id: tournament.id,
          bracket_side: (input.bracket_side as Match['bracket_side']) ?? null,
          winner_id: null,
          status: 'scheduled',
          submitter_id: null,
          date_played: null,
          scheduled_at: null,
          auto_confirm_at: null,
          confirmed_at: null,
          notes: '',
          social_image_url: null,
          created_at: now,
          updated_at: now,
        };
      })
  );

  return { rounds, matches, firstRoundNumber: structure.rounds[0]?.round_number ?? 1 };
}

/**
 * Writes the planned bracket in one locked transaction (`writeBracket`, the SQL `bracket_write`): the rounds, the matches,
 * the enrollment freeze and the status move (tournamentMachine: `start` from upcoming, `regenerate_bracket` from
 * completed, an active one stays active) only while the status is still the one the caller read. A completion that
 * committed first refuses it with 409 `tournament_status_changed` and nothing is written; one that comes second waits for it.
 * Then the first round is started when asked (best effort: a round that is still pending shows the Start banner).
 */
async function writePlannedBracket(
  tournament: Tournament,
  plan: BracketPlan,
  replace: boolean,
  options: GenerateBracketOptions
): Promise<GenerateBracketResult> {
  if (tournament.status !== 'active') tournamentMachine.assertTransition(tournament.status, 'active', 'system');
  await writeBracket({
    tournament_id: tournament.id,
    expected_status: tournament.status,
    replace,
    rounds: plan.rounds,
    matches: plan.matches,
    current_round: plan.firstRoundNumber,
  });

  const result: GenerateBracketResult = {
    rounds_created: plan.rounds.length,
    matches_materialized: plan.matches.length,
  };
  const firstRoundId = plan.rounds.find((round) => round.round_number === plan.firstRoundNumber)?.id;
  if (options.startFirstRound && firstRoundId) {
    try {
      await updateRoundStatus(firstRoundId, 'active');
      result.started_round_id = firstRoundId;
    } catch (startErr) {
      console.error('[generate-bracket] Failed to start the first round:', startErr);
    }
  }
  return result;
}

/**
 * Generate the full elimination bracket: all round rows + initial match materialization, in one locked write.
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
  const plan = await planBracket(tournament, participants);
  return writePlannedBracket(tournament, plan, false, options);
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
 * Played matches must be cascade-reset first so aggregates/ratings/EPB roll back; the resets run in the app (they cannot
 * be rolled back in SQL) and leave the status alone. The old bracket is then replaced in one locked write that refuses
 * a status moved since the caller's read and a match played since the resets, so a refused regenerate changes neither
 * the status nor the bracket (only the resets it was asked for stand).
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

  const plan = await planBracket(tournament, participants);

  let formatRevertFailed = false;
  for (const match of played) {
    const latest = await getMatchById(match.id);
    if (!latest || latest.status === 'scheduled') continue;
    const reset = await resetMatch(match.id, options.adminId!, true);
    if (reset?.format_revert_failed) formatRevertFailed = true;
  }

  const generated = await writePlannedBracket(tournament, plan, true, options);
  return formatRevertFailed ? { ...generated, format_revert_failed: true } : generated;
}
