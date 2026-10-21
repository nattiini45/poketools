/**
 * Head-to-head resolution for Evolution Point Buy tiebreaker.
 */

import type { MatchRecord } from './types';

/**
 * Resolve head-to-head between two players based on their direct matches.
 * Returns: 1 if playerA wins, -1 if playerB wins, 0 if tied.
 */
export function resolveHeadToHead(
  playerA: string,
  playerB: string,
  matches: MatchRecord[]
): -1 | 0 | 1 {
  const directMatches = matches.filter(
    (m) =>
      (m.player_1_id === playerA && m.player_2_id === playerB) ||
      (m.player_1_id === playerB && m.player_2_id === playerA)
  );

  if (directMatches.length === 0) return 0;

  let winsA = 0;
  let winsB = 0;

  for (const match of directMatches) {
    if (match.winner_id === playerA) winsA++;
    else if (match.winner_id === playerB) winsB++;
  }

  if (winsA > winsB) return 1;
  if (winsB > winsA) return -1;
  return 0;
}
