import type { Pairing, GeneratedRound, MatchRecord } from './types';

/**
 * Single Elimination bracket generator.
 *
 * Round 1: Seed players into proper bracket positions with byes for non-power-of-2.
 * Subsequent rounds: Winners from previous round + bye recipients advance.
 *
 * Bracket seeding ensures top seeds are placed on opposite sides so they meet
 * as late as possible (e.g. seeds 1 and 2 can only meet in the Finals).
 */

/**
 * Compute the next power of 2 >= n.
 */
function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Generate standard bracket ordering for a given bracket size.
 *
 * For size 8 this produces [1, 8, 4, 5, 2, 7, 3, 6], which gives:
 *   Top half:    Seed 1 vs 8, Seed 4 vs 5
 *   Bottom half: Seed 2 vs 7, Seed 3 vs 6
 *
 * This guarantees:
 *   - Seeds 1 and 2 are on opposite halves (meet only in Finals)
 *   - Seeds 1-4 are in separate quarters (meet no earlier than Semis)
 *   - Higher seeds face lower seeds in early rounds
 */
export function bracketOrder(size: number): number[] {
  if (size === 1) return [1];

  const prev = bracketOrder(size / 2);
  const result: number[] = [];

  for (const seed of prev) {
    result.push(seed);
    result.push(size + 1 - seed);
  }

  return result;
}

/**
 * Generate seeded bracket positions for round 1.
 * Uses standard bracket ordering so top seeds are on opposite sides.
 * A null entry means a bye (player count is not a power of 2).
 */
export function seedBracket(participantIds: string[]): (string | null)[] {
  const bracketSize = nextPowerOf2(participantIds.length);
  const order = bracketOrder(bracketSize);

  // Map bracket positions to participant IDs (1-indexed seed → 0-indexed array)
  return order.map((seed) => {
    const index = seed - 1;
    return index < participantIds.length ? participantIds[index] : null;
  });
}

/**
 * Generate Round 1 of a single elimination bracket.
 * Participants are assumed to be in seed order (index 0 = seed 1).
 */
export function generateSingleElimRound1(
  participantIds: string[]
): GeneratedRound {
  const seeds = seedBracket(participantIds);
  const pairings: Pairing[] = [];
  const byePlayerIds: string[] = [];

  // Pair adjacent positions: (0,1), (2,3), (4,5), ...
  for (let i = 0; i < seeds.length; i += 2) {
    const p1 = seeds[i];
    const p2 = seeds[i + 1] ?? null;

    if (p1 && p2) {
      pairings.push({ player_1_id: p1, player_2_id: p2 });
    } else if (p1 && !p2) {
      byePlayerIds.push(p1);
    } else if (!p1 && p2) {
      byePlayerIds.push(p2);
    }
  }

  return {
    round_number: 1,
    round_name: getRoundName(participantIds.length, 1),
    pairings,
    bye_player_ids: byePlayerIds,
  };
}

/**
 * Generate a subsequent single elimination round.
 * Advancing players = winners from previous round + bye recipients.
 *
 * Bye recipients are identified as participants who:
 *   1. Were not in any match in the previous round, AND
 *   2. Have never lost a match (still active in the bracket)
 */
export function generateSingleElimNextRound(
  participantIds: string[],
  matchHistory: MatchRecord[],
  roundNumber: number
): GeneratedRound {
  // Find all players who have lost any match (they're eliminated)
  const eliminatedIds = new Set<string>();
  for (const match of matchHistory) {
    if (match.winner_id) {
      const loser =
        match.winner_id === match.player_1_id
          ? match.player_2_id
          : match.player_1_id;
      eliminatedIds.add(loser);
    }
  }

  // Find who played in the previous round
  const prevRoundMatches = matchHistory.filter(
    (m) => m.round_number === roundNumber - 1
  );
  const playedInPrevRound = new Set<string>();
  for (const match of prevRoundMatches) {
    playedInPrevRound.add(match.player_1_id);
    playedInPrevRound.add(match.player_2_id);
  }

  // Winners from previous round
  const advancingPlayers: string[] = [];
  for (const match of prevRoundMatches) {
    if (match.winner_id) {
      advancingPlayers.push(match.winner_id);
    }
  }

  // Bye recipients: active players who weren't in any previous round match
  for (const pid of participantIds) {
    if (!playedInPrevRound.has(pid) && !eliminatedIds.has(pid)) {
      advancingPlayers.push(pid);
    }
  }

  const pairings: Pairing[] = [];
  const byePlayerIds: string[] = [];

  // Sequential pairing of advancing players
  for (let i = 0; i < advancingPlayers.length; i += 2) {
    if (i + 1 < advancingPlayers.length) {
      pairings.push({
        player_1_id: advancingPlayers[i],
        player_2_id: advancingPlayers[i + 1],
      });
    } else {
      byePlayerIds.push(advancingPlayers[i]);
    }
  }

  return {
    round_number: roundNumber,
    round_name: getRoundName(participantIds.length, roundNumber),
    pairings,
    bye_player_ids: byePlayerIds,
  };
}

/**
 * Get a human-readable round name for single elimination.
 */
function getRoundName(totalParticipants: number, roundNumber: number): string {
  const bracketSize = nextPowerOf2(totalParticipants);
  const totalRounds = Math.log2(bracketSize);
  const remainingRounds = totalRounds - roundNumber + 1;

  if (remainingRounds === 1) return 'Finals';
  if (remainingRounds === 2) return 'Semifinals';
  if (remainingRounds === 3) return 'Quarterfinals';
  return `Round ${roundNumber}`;
}

/**
 * Get total number of rounds for a single elimination bracket.
 */
export function getSingleElimTotalRounds(participantCount: number): number {
  return Math.ceil(Math.log2(participantCount));
}
