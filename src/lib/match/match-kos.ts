import type { BattleStat } from '@/types/game';
import type { MatchStats } from '@/types/streak';

/**
 * One player's KO totals across every game of a match, the input
 * `updateStreaks` takes; null when the player has no battle-stats row in
 * `stats` (their KO figures are unknown, not zero).
 */
export function aggregateMatchKOs(
  stats: ReadonlyArray<Pick<BattleStat, 'player_id' | 'kos_dealt' | 'was_koed'>>,
  playerId: string
): MatchStats | null {
  let totalKosDealt = 0;
  let totalKosLost = 0;
  let rows = 0;

  for (const stat of stats) {
    if (stat.player_id !== playerId) continue;
    rows += 1;
    totalKosDealt += stat.kos_dealt;
    if (stat.was_koed) totalKosLost += 1;
  }

  if (rows === 0) return null;
  return {
    total_kos_dealt: totalKosDealt,
    total_kos_lost: totalKosLost,
  };
}
