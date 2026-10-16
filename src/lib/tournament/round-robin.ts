import type { Pairing, GeneratedRound } from './types';
import { BYE_PLAYER_ID } from './types';

/**
 * Round Robin schedule using the Circle Method.
 *
 * Fix player at index 0, rotate the rest clockwise.
 * For N players: N-1 rounds (N if odd, with byes).
 *
 * This generates the FULL schedule upfront, then returns
 * just the requested round.
 */
export function generateRoundRobinRound(
  participantIds: string[],
  roundNumber: number
): GeneratedRound {
  const players = [...participantIds];
  const byePlayerIds: string[] = [];

  // Add a BYE slot for odd player count
  if (players.length % 2 !== 0) {
    players.push(BYE_PLAYER_ID);
  }

  const totalRounds = players.length - 1;

  if (roundNumber < 1 || roundNumber > totalRounds) {
    throw new Error(
      `Invalid round number ${roundNumber}. Round robin with ${participantIds.length} players has ${totalRounds} rounds.`
    );
  }

  // Generate the schedule for the requested round using circle method.
  // Rotate all players except the first one.
  const rotatable = players.slice(1);

  // Rotate (roundNumber - 1) positions to the right
  const rotations = roundNumber - 1;
  const rotated = [
    ...rotatable.slice(rotatable.length - rotations),
    ...rotatable.slice(0, rotatable.length - rotations),
  ];

  const roundPlayers = [players[0], ...rotated];
  const pairings: Pairing[] = [];
  const half = roundPlayers.length / 2;

  for (let i = 0; i < half; i++) {
    const p1 = roundPlayers[i];
    const p2 = roundPlayers[roundPlayers.length - 1 - i];

    if (p1 === BYE_PLAYER_ID) {
      byePlayerIds.push(p2);
    } else if (p2 === BYE_PLAYER_ID) {
      byePlayerIds.push(p1);
    } else {
      pairings.push({ player_1_id: p1, player_2_id: p2 });
    }
  }

  return {
    round_number: roundNumber,
    round_name: `Round ${roundNumber}`,
    pairings,
    bye_player_ids: byePlayerIds,
  };
}

/**
 * Get the total number of rounds for a round robin tournament.
 */
export function getRoundRobinTotalRounds(participantCount: number): number {
  return participantCount % 2 === 0
    ? participantCount - 1
    : participantCount;
}
