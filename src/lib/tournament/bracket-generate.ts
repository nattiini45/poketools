import type { Tournament } from '@/types/tournament';
import type { ParticipantWithSeed } from '@/types/tournament';
import type { MatchWithPlayers } from '@/types/match';
import { buildBracketStructureForParticipants } from './bracket-structure';
import {
  buildSlotResolutionsFromMatches,
  materializeReadySlots,
} from './bracket-propagation';
import { createRound, getRoundsByTournament, updateRoundStatus } from '@/lib/supabase/queries/rounds';
import { getMatchById, getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { freezeEnrollment, updateTournament } from '@/lib/supabase/queries/tournaments';
import { resetMatch } from '@/lib/pkmn/game-pipeline';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { supabase } from '@/lib/supabase/client';

export interface GenerateBracketResult {
  rounds_created: number;
  matches_materialized: number;
  /** Present only when the first round was started (`startFirstRound`) and the start succeeded. */
  started_round_id?: string;
}

export interface GenerateBracketOptions {
  /** Also start the first round (best effort). Default false: every round stays pending. */
  startFirstRound?: boolean;
}

/**
 * Generate the full elimination bracket: all round rows + initial match materialization.
 */
export async function generateEliminationBracket(
  tournament: Tournament,
  participants: ParticipantWithSeed[],
  options: GenerateBracketOptions = {}
): Promise<GenerateBracketResult> {
  if (tournament.bracket_type !== 'single_elim' && tournament.bracket_type !== 'double_elim') {
    throw new Error('Full bracket generation only applies to elimination formats');
  }

  const existingRounds = await getRoundsByTournament(tournament.id);
  if (existingRounds.length > 0) {
    throw new UserFacingError('Bracket already generated', {
      code: 'bracket_already_generated',
      status: 409,
    });
  }

  const structure = buildBracketStructureForParticipants(
    tournament.bracket_type,
    participants,
    { bracketResetEnabled: tournament.bracket_reset_enabled ?? true }
  );
  if (!structure) {
    throw new UserFacingError('Need at least 2 participants', {
      code: 'tournament_participants_too_few',
      status: 400,
    });
  }

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

  const firstRoundNumber = structure.rounds[0]?.round_number ?? 1;
  await updateTournament(tournament.id, {
    status: 'active',
    current_round: firstRoundNumber,
  });

  const result: GenerateBracketResult = {
    rounds_created: structure.rounds.length,
    matches_materialized: created.length,
  };

  // Start the first round when asked. Best effort: the bracket exists either way, and a round that is still
  // pending shows the Start banner. Later rounds are started by the admin.
  const firstRoundId = roundIdByGlobalNumber.get(firstRoundNumber);
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

  if (rounds.length > 0) {
    const matches = await getMatchesByTournament(tournament.id);
    const played = matches.filter(isPlayedBracketMatch);
    if (played.length > 0) {
      if (!options.cascade) {
        throw new UserFacingError(
          `${played.length} played match(es) will be reset and all results rolled back.`,
          { code: 'REGENERATE_PLAYED', params: { count: played.length }, status: 409 }
        );
      }
      const adminId = options.adminId;
      if (!adminId) {
        throw new UserFacingError(
          `${played.length} played match(es) will be reset and all results rolled back.`,
          { code: 'REGENERATE_PLAYED', params: { count: played.length }, status: 409 }
        );
      }
      for (const match of played) {
        const latest = await getMatchById(match.id);
        if (!latest || latest.status === 'scheduled') continue;
        await resetMatch(match.id, adminId, true);
      }
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

  return generateEliminationBracket(tournament, participants, {
    startFirstRound: options.startFirstRound,
  });
}
