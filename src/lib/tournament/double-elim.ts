import type { Pairing, GeneratedRound, MatchRecord } from './types';
import { generateSingleElimRound1 } from './single-elim';

/**
 * Double Elimination bracket generator.
 *
 * Players must lose twice to be eliminated.
 * - Winners Bracket: standard single-elim among undefeated players
 * - Losers Bracket: losers from the winners bracket get a second chance
 * - Grand Finals: winners bracket champion vs losers bracket champion
 *
 * Round 1 uses proper bracket seeding (same as single-elim) so top seeds
 * are on opposite sides and byes go to the highest seeds.
 *
 * LB starters (`starting_bracket = 'losers'`) are excluded from Winners Round 1
 * and carry one nominal loss in bracket state (see spec §6.4).
 */

export type StartingBracket = 'winners' | 'losers';
export type StartingBrackets = Record<string, StartingBracket>;

interface BracketState {
  /** Players still in the winners bracket (0 losses) */
  winners_bracket: string[];
  /** Players in the losers bracket (1 loss) */
  losers_bracket: string[];
  /** Eliminated players (2 losses) */
  eliminated: string[];
}

/**
 * Build a startingBrackets map from participants that have `starting_bracket`.
 * Returns `undefined` when no LB starters exist (preserves legacy call paths).
 */
export function startingBracketsFromParticipants(
  participants: Array<{ id: string; starting_bracket: StartingBracket }>
): StartingBrackets | undefined {
  const map: StartingBrackets = {};
  let hasLbStarter = false;
  for (const p of participants) {
    if (p.starting_bracket === 'losers') {
      map[p.id] = 'losers';
      hasLbStarter = true;
    }
  }
  return hasLbStarter ? map : undefined;
}

/**
 * Count participants slated for Winners Round 1 (excludes LB starters).
 */
export function countUpperBracketStarters(
  participantIds: string[],
  startingBrackets?: StartingBrackets
): number {
  return participantIds.filter((id) => startingBrackets?.[id] !== 'losers').length;
}

/**
 * Compute the current bracket state from match history.
 *
 * This is stateless: starts from the full participant list and counts losses.
 * Players with 0 effective losses are in winners bracket, 1 in losers bracket,
 * 2+ are eliminated. LB starters receive one nominal loss on top of recorded
 * losses. Bye players (no matches) have 0 recorded losses and remain in the
 * winners bracket unless they are LB starters.
 */
export function computeBracketState(
  participantIds: string[],
  matchHistory: MatchRecord[],
  startingBrackets?: StartingBrackets
): BracketState {
  const lossCount = new Map<string, number>();
  for (const pid of participantIds) {
    lossCount.set(pid, 0);
  }

  for (const match of matchHistory) {
    if (!match.winner_id) continue;
    const loser =
      match.winner_id === match.player_1_id
        ? match.player_2_id
        : match.player_1_id;
    lossCount.set(loser, (lossCount.get(loser) ?? 0) + 1);
  }

  const winners_bracket: string[] = [];
  const losers_bracket: string[] = [];
  const eliminated: string[] = [];

  for (const pid of participantIds) {
    let losses = lossCount.get(pid) ?? 0;
    if (startingBrackets?.[pid] === 'losers') {
      losses += 1;
    }
    if (losses === 0) winners_bracket.push(pid);
    else if (losses === 1) losers_bracket.push(pid);
    else eliminated.push(pid);
  }

  return { winners_bracket, losers_bracket, eliminated };
}

/**
 * Generate the next round for a double elimination bracket.
 *
 * Round 1: Uses proper bracket seeding from single-elim (top seeds on
 * opposite sides, byes for non-power-of-2 counts).
 *
 * Later rounds: Pairs within winners bracket and losers bracket separately.
 * Grand Finals when 1 player remains in each bracket.
 */
export function generateDoubleElimRound(
  participantIds: string[],
  matchHistory: MatchRecord[],
  roundNumber: number,
  startingBrackets?: StartingBrackets
): GeneratedRound {
  // Round 1: UB starters only — LB starters wait for losers-bracket pairing
  if (roundNumber === 1) {
    const ubStarters = participantIds.filter(
      (id) => startingBrackets?.[id] !== 'losers'
    );
    const round1 = generateSingleElimRound1(ubStarters);
    return { ...round1, round_name: 'Winners Round 1' };
  }

  const state = computeBracketState(
    participantIds,
    matchHistory,
    startingBrackets
  );
  const pairings: Pairing[] = [];
  const byePlayerIds: string[] = [];

  // Grand Finals: 1 player in winners, 1 in losers
  if (state.winners_bracket.length === 1 && state.losers_bracket.length === 1) {
    pairings.push({
      player_1_id: state.winners_bracket[0],
      player_2_id: state.losers_bracket[0],
    });
    return {
      round_number: roundNumber,
      round_name: 'Grand Finals',
      pairings,
      bye_player_ids: byePlayerIds,
    };
  }

  // Winners bracket pairings
  for (let i = 0; i < state.winners_bracket.length; i += 2) {
    if (i + 1 < state.winners_bracket.length) {
      pairings.push({
        player_1_id: state.winners_bracket[i],
        player_2_id: state.winners_bracket[i + 1],
      });
    } else {
      byePlayerIds.push(state.winners_bracket[i]);
    }
  }

  // Losers bracket pairings
  for (let i = 0; i < state.losers_bracket.length; i += 2) {
    if (i + 1 < state.losers_bracket.length) {
      pairings.push({
        player_1_id: state.losers_bracket[i],
        player_2_id: state.losers_bracket[i + 1],
      });
    } else {
      byePlayerIds.push(state.losers_bracket[i]);
    }
  }

  // Determine round name
  const totalActive = state.winners_bracket.length + state.losers_bracket.length;
  let roundName = `Round ${roundNumber}`;
  if (totalActive <= 4) roundName = 'Semifinals';
  if (totalActive <= 2) roundName = 'Grand Finals';

  return {
    round_number: roundNumber,
    round_name: roundName,
    pairings,
    bye_player_ids: byePlayerIds,
  };
}
