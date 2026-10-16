import type { TournamentBattleStat } from '@/lib/supabase/queries/games';
import type { KillRankingRow } from '@/types/game';

interface KillAccumulator {
  dealt: number;
  koed: number;
  inTeam: number;
  brought: number;
}

/**
 * Build kill ranking rows from battle_stats rows (tournament or league scope).
 */
export function buildKillRanking(stats: TournamentBattleStat[]): KillRankingRow[] {
  const pokemonMap = new Map<string, KillAccumulator>();

  for (const stat of stats) {
    const existing = pokemonMap.get(stat.pokemon_name) ?? {
      dealt: 0,
      koed: 0,
      inTeam: 0,
      brought: 0,
    };
    existing.dealt += stat.kos_dealt;
    if (stat.was_koed) existing.koed += 1;
    existing.inTeam += 1;
    if (stat.was_brought) existing.brought += 1;
    pokemonMap.set(stat.pokemon_name, existing);
  }

  return Array.from(pokemonMap.entries()).map(([name, row]) => ({
    pokemon_name: name,
    kos_dealt: row.dealt,
    times_koed: row.koed,
    kill_differential: row.dealt - row.koed,
    participations: row.brought,
    times_in_team: row.inTeam,
    efficiency: row.brought > 0 ? row.dealt / row.brought : 0,
  }));
}
