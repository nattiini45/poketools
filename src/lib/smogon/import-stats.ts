/**
 * Import pipeline: fetches usage statistics from data.pkmn.cc and upserts
 * into the meta_usage_cache table. Each format's JSON contains all Pokémon
 * for that format.
 *
 * Uses the @pkmn/stats output format served at data.pkmn.cc/stats/FORMAT.json.
 */

import type { DisplayUsageStatistics, LegacyDisplayUsageStatistics } from '@pkmn/smogon';
import type { ImportResult } from '@/types/usage';
import { upsertUsageBatch } from '@/lib/supabase/queries/meta-usage';
import { getImportableFormats } from './format-registry';

const STATS_BASE = 'https://pkmn.github.io/smogon/data/stats';

interface StatsFile {
  battles: number;
  pokemon: Record<string, DisplayUsageStatistics | LegacyDisplayUsageStatistics>;
  metagame?: unknown;
}

function isDisplayUsageStatistics(
  stats: DisplayUsageStatistics | LegacyDisplayUsageStatistics
): stats is DisplayUsageStatistics {
  return 'unique' in stats;
}

export async function importFormatStats(format: string): Promise<ImportResult> {
  try {
    const res = await fetch(`${STATS_BASE}/${format}.json`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      if (res.status === 404) {
        return { format, pokemonCount: 0, status: 'skipped', error: 'Not found on data.pkmn.cc' };
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data: StatsFile = await res.json();
    const pokemonEntries = Object.entries(data.pokemon);

    if (pokemonEntries.length === 0) {
      return { format, pokemonCount: 0, status: 'skipped', error: 'No Pokémon data' };
    }

    // Transform to our schema and batch upsert
    const rows = pokemonEntries.map(([name, stats]) => ({
      format,
      pokemon_name: name,
      usage_pct: stats.usage?.weighted ?? stats.usage?.real ?? 0,
      lead_pct: stats.lead?.weighted ?? stats.lead?.real ?? null,
      moves: stats.moves ?? {},
      items: stats.items ?? {},
      abilities: stats.abilities ?? {},
      teammates: stats.teammates ?? {},
      spreads: ('stats' in stats ? stats.stats : {}) as Record<string, number>,
      tera_types: 'teraTypes' in stats ? (stats.teraTypes as Record<string, number>) : null,
      counters: stats.counters as Record<string, [number, number, number]> | null ?? null,
      viability: isDisplayUsageStatistics(stats) ? stats.viability : null,
    }));

    // Batch upsert in chunks of 500 to avoid payload limits
    const CHUNK_SIZE = 500;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await upsertUsageBatch(rows.slice(i, i + CHUNK_SIZE));
    }

    return { format, pokemonCount: rows.length, status: 'success' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { format, pokemonCount: 0, status: 'error', error: message };
  }
}

export async function importAllStats(
  formats?: string[]
): Promise<ImportResult[]> {
  const targetFormats = formats ?? await getImportableFormats();
  const results: ImportResult[] = [];

  // Import sequentially to avoid hammering data.pkmn.cc
  for (const format of targetFormats) {
    const result = await importFormatStats(format);
    results.push(result);

    // Small delay between requests to be a good API citizen
    if (result.status === 'success') {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return results;
}
