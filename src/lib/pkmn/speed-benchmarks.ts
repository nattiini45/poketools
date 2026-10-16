import type { SpeedBenchmark } from '@/types/speed';
import { getUsageByFormat } from '@/lib/supabase/queries/meta-usage';
import { getAggregates } from '@/lib/supabase/queries/aggregates';
import { getBaseStats } from '@/lib/pkmn/dex';
import { calcSpeed } from './speed-calc';

/**
 * Build uninvested / max-invest / scarf benchmarks for a single species.
 * Reused by both the meta-usage tier endpoint and the full-dex search endpoint.
 */
export function buildBenchmarksForSpecies(
  speciesName: string,
  options?: { level?: number; includeScarf?: boolean; gen?: number },
): SpeedBenchmark[] {
  const level = options?.level ?? 100;
  const includeScarf = options?.includeScarf ?? true;
  const info = getBaseStats(speciesName, options?.gen);
  if (!info) return [];

  const baseSpe = info.baseStats.spe;
  const benchmarks: SpeedBenchmark[] = [];

  const uninvested = calcSpeed({ baseSpe, level, ev: 0, iv: 31, nature: 'neutral' });
  benchmarks.push({
    species: speciesName, speed: uninvested.raw,
    label: `${speciesName} (uninvested)`, evs: 0, nature: 'neutral', baseSpe,
  });

  const maxInvest = calcSpeed({ baseSpe, level, ev: 252, iv: 31, nature: 'positive' });
  benchmarks.push({
    species: speciesName, speed: maxInvest.raw,
    label: `${speciesName} (max)`, evs: 252, nature: 'positive', baseSpe,
  });

  if (includeScarf) {
    benchmarks.push({
      species: speciesName, speed: Math.floor(maxInvest.raw * 1.5),
      label: `${speciesName} (Scarf)`, evs: 252, nature: 'positive',
      item: 'Choice Scarf', baseSpe,
    });
  }

  return benchmarks;
}

/**
 * Generate speed benchmarks for the current format.
 * Uses the top N Pokémon by usage from meta_usage_cache.
 */
export async function getSpeedBenchmarks(
  format: string,
  options?: {
    limit?: number;
    includeScarf?: boolean;
    level?: number;
    generation?: number;
    /** Use league-specific data for top Pokémon list. */
    seasonId?: string;
  }
): Promise<SpeedBenchmark[]> {
  const limit = options?.limit ?? 20;
  const includeScarf = options?.includeScarf ?? true;
  const level = options?.level ?? 100;
  const seasonId = options?.seasonId;

  // When a seasonId is provided, use league aggregates instead of global meta usage
  let pokemonNames: string[];
  if (seasonId) {
    const aggregates = await getAggregates('league', seasonId);
    pokemonNames = aggregates
      .slice(0, limit)
      .map((agg) => agg.pokemon_name);
  } else {
    const { data: usageList } = await getUsageByFormat(format, { limit });
    pokemonNames = usageList.map((row) => row.pokemon_name);
  }

  const benchmarks: SpeedBenchmark[] = [];

  for (const name of pokemonNames) {
    benchmarks.push(...buildBenchmarksForSpecies(name, {
      level, includeScarf, gen: options?.generation,
    }));
  }

  // Sort by speed, then deduplicate entries within ±1 of each other
  // (keep the entry with higher usage / invested variant preference)
  benchmarks.sort((a, b) => a.speed - b.speed);

  const deduped: SpeedBenchmark[] = [];
  for (const b of benchmarks) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.speed - b.speed) <= 1 && prev.species !== b.species) {
      // Within ±1 of the previous benchmark — keep the invested one
      if (b.evs > prev.evs) {
        deduped[deduped.length - 1] = b;
      }
      // Otherwise keep prev
    } else {
      deduped.push(b);
    }
  }

  return deduped;
}
