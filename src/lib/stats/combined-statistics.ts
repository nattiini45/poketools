import type { Aggregate, PokemonUsageRow } from '@/types/game';
import type { HistoricalStatisticsCoverage, HistoricalUsageContribution } from '@/lib/pack-extensions/historical-statistics-types';

export type CombinedPokemonUsageRow = Omit<PokemonUsageRow,
  'usage_percent' | 'total_appearances' | 'total_games' | 'koed_rate' | 'kos_dealt'> & {
  usage_percent: number | null;
  total_appearances: number | null;
  total_games: number | null;
  koed_rate: number | null;
  kos_dealt: number | null;
  sourceCounts?: {
    liveAppearances: number;
    historicalAppearances: number | null;
    liveKos: number;
    historicalKos: number | null;
  };
};

export interface HistoricalStatisticsView {
  state: 'absent' | 'excluded' | 'not_ready' | 'ready' | 'failed';
  coverage: readonly HistoricalStatisticsCoverage[];
}

export function combinePokemonUsage(
  live: readonly Aggregate[],
  liveBattleCount: number,
  historical: HistoricalUsageContribution,
): CombinedPokemonUsageRow[] {
  const current = new Map(live.map((row) => [row.pokemon_name, row]));
  const earlier = new Map(historical.pokemon.map((row) => [row.pokemonName, row]));
  const names = new Set([...current.keys(), ...earlier.keys()]);
  const battleCount = liveBattleCount + historical.battleCount;
  return [...names].map((pokemon_name) => {
    const liveRow = current.get(pokemon_name);
    const historicalRow = earlier.get(pokemon_name);
    const historicalAppearances = historicalRow ? historicalRow.appearances : historical.battleCount > 0 ? 0 : null;
    const appearances = historicalRow?.appearances !== null && (liveRow || historicalAppearances !== null)
      ? (liveRow?.total_appearances ?? 0) + (historicalAppearances ?? 0) : null;
    const kos = historicalRow?.kos !== null && (liveRow || historicalRow?.kos !== undefined)
      ? (liveRow?.total_kos_dealt ?? 0) + (historicalRow?.kos ?? 0) : null;
    const winsKnown = historicalAppearances === null || historicalAppearances === 0 || historicalRow?.wins !== null && historicalRow?.wins !== undefined;
    return {
      pokemon_name,
      usage_percent: appearances !== null && battleCount > 0 ? appearances / battleCount * 100 : null,
      total_appearances: appearances,
      total_games: historicalRow?.appearances !== null && (liveRow || historicalAppearances !== null)
        ? (liveRow?.total_games ?? 0) + (historicalAppearances ?? 0) : null,
      kos_dealt: kos,
      koed_rate: liveRow && liveRow.total_appearances > 0 ? liveRow.total_koed / liveRow.total_appearances * 100 : null,
      efficiency: liveRow && liveRow.total_brought > 0 ? liveRow.total_kos_dealt / liveRow.total_brought : null,
      bring_rate: liveRow && liveRow.total_games > 0 ? liveRow.total_brought / liveRow.total_games * 100 : null,
      lead_rate: liveRow && liveRow.total_games > 0 ? liveRow.total_led / liveRow.total_games * 100 : null,
      win_rate: appearances !== null && appearances > 0 && winsKnown
        ? ((liveRow?.total_wins ?? 0) + (historicalRow?.wins ?? 0)) / appearances * 100 : null,
      sourceCounts: {
        liveAppearances: liveRow?.total_appearances ?? 0,
        historicalAppearances,
        liveKos: liveRow?.total_kos_dealt ?? 0,
        historicalKos: historicalRow?.kos ?? null,
      },
    };
  });
}
