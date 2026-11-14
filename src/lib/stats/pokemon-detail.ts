import type { Aggregate, PokemonDetailStats } from '@/types/game';
import type { HistoricalUsageContribution } from '@/lib/pack-extensions/historical-statistics-types';
import { combinePokemonUsage, type HistoricalStatisticsView } from './combined-statistics';

export function pokemonDetailStats(
  pokemonName: string,
  aggregate: Aggregate | null,
  liveBattleCount: number,
  historical: HistoricalUsageContribution | null,
  history: HistoricalStatisticsView,
): PokemonDetailStats {
  const combined = historical
    ? combinePokemonUsage(aggregate ? [aggregate] : [], liveBattleCount, historical)
      .find((row) => row.pokemon_name === pokemonName)
    : undefined;
  const result: PokemonDetailStats = {
    pokemon_name: pokemonName,
    total_appearances: aggregate?.total_appearances ?? 0,
    total_games_in_scope: liveBattleCount + (historical?.battleCount ?? 0),
    usage_percent: aggregate && liveBattleCount > 0 ? aggregate.total_appearances / liveBattleCount * 100 : 0,
    kos_dealt: aggregate?.total_kos_dealt ?? 0,
    koed_rate: aggregate && aggregate.total_appearances > 0 ? aggregate.total_koed / aggregate.total_appearances * 100 : 0,
    bring_rate: aggregate && aggregate.total_games > 0 ? aggregate.total_brought / aggregate.total_games * 100 : null,
    lead_rate: aggregate && aggregate.total_games > 0 ? aggregate.total_led / aggregate.total_games * 100 : null,
    win_rate: aggregate && aggregate.total_appearances > 0 ? aggregate.total_wins / aggregate.total_appearances * 100 : null,
    moves: Object.entries(aggregate?.move_counts ?? {}).map(([name, count]) => ({
      name, count, usage_percent: aggregate && aggregate.total_appearances > 0 ? count / aggregate.total_appearances * 100 : 0,
    })).sort((a, b) => b.count - a.count),
    items: [],
    players: [],
    ...(history.state === 'absent' ? {} : { history }),
  };
  if (!combined) return result;
  return {
    ...result,
    total_appearances: combined.total_appearances,
    usage_percent: combined.usage_percent,
    kos_dealt: combined.kos_dealt,
    koed_rate: combined.koed_rate,
    bring_rate: combined.bring_rate,
    lead_rate: combined.lead_rate,
    win_rate: combined.win_rate,
    sourceCounts: combined.sourceCounts,
  };
}
