/**
 * Pure helpers for `match_outcomes` (no reads, no writes): the faint tally a played match records and the source of
 * a played result. Standings read the stored tally, never `battle_stats` at read time.
 */
import type { BattleStat } from '@/types/game';
import type { MatchOutcomeSource } from '@/types/match-outcome';

export interface FaintTally {
  /** Pokémon of player 1 that fainted. */
  p1: number;
  /** Pokémon of player 2 that fainted. */
  p2: number;
}

/**
 * Counts every fainted Pokémon (`was_koed`) per side over all games of the match, whatever caused the faint. null
 * when the match has no battle stats at all (unknown, not zero).
 */
export function faintTally(
  statsByGame: Readonly<Record<string, readonly Pick<BattleStat, 'player_id' | 'was_koed'>[]>>,
  player1Id: string,
  player2Id: string,
): FaintTally | null {
  let rows = 0;
  const tally: FaintTally = { p1: 0, p2: 0 };
  for (const stats of Object.values(statsByGame)) {
    for (const stat of stats) {
      rows += 1;
      if (!stat.was_koed) continue;
      if (stat.player_id === player1Id) tally.p1 += 1;
      else if (stat.player_id === player2Id) tally.p2 += 1;
    }
  }
  return rows === 0 ? null : tally;
}

/** 'replay' when any game came from a Showdown replay, 'manual' otherwise. */
export function playedOutcomeSource(games: readonly { source?: string | null }[]): Exclude<MatchOutcomeSource, 'admin'> {
  return games.some((g) => g.source === 'ps_replay') ? 'replay' : 'manual';
}
