import type { CalcPokemon, ThreatEntry } from '@/types/calc';
import { getUsageByFormat, getPokemonUsageStats } from '@/lib/supabase/queries/meta-usage';
import { getBaseStats } from '@/lib/pkmn/dex';
import { getMostPopularSpread } from './spread-parser';

/**
 * Generate a list of common threats for a format, each with their most
 * popular set pre-loaded for calculator use.
 */
export async function getThreatsForFormat(
  format: string,
  options?: {
    limit?: number;
    excludeSpecies?: string[];
    seasonId?: string;
  }
): Promise<ThreatEntry[]> {
  const limit = options?.limit ?? 12;

  const { data: usageList } = await getUsageByFormat(format, { limit: limit + 10 });

  const excludeSet = new Set(options?.excludeSpecies?.map((s) => s.toLowerCase()) ?? []);
  const threats: ThreatEntry[] = [];

  for (const row of usageList) {
    if (excludeSet.has(row.pokemon_name.toLowerCase())) continue;
    if (threats.length >= limit) break;

    const info = getBaseStats(row.pokemon_name);
    if (!info) continue;

    // Build default set from most popular spread + top moves/item/ability
    const spread = getMostPopularSpread(row.spreads);
    const topMoves = Object.entries(row.moves ?? {})
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4)
      .map(([name]) => name);
    const topAbility = Object.entries(row.abilities ?? {})
      .sort(([, a], [, b]) => b - a)[0]?.[0];
    const topItem = Object.entries(row.items ?? {})
      .sort(([, a], [, b]) => b - a)[0]?.[0];

    const defaultSet: CalcPokemon = {
      species: row.pokemon_name,
      nature: spread?.nature,
      evs: spread?.evs,
      ability: topAbility,
      item: topItem,
      moves: topMoves,
      level: 100,
    };

    threats.push({
      species: row.pokemon_name,
      usage_pct: row.usage_pct,
      default_set: defaultSet,
      types: info.types.map(String),
    });
  }

  return threats;
}

/**
 * Build a calc-ready threat entry for one species — used for opponent
 * scouting where the species list comes from battle history rather than
 * usage rankings. `knownMoves` (observed in replays) take priority over
 * meta-usage moves; usage data fills the remaining slots/spread/item.
 */
export async function buildThreatEntry(
  species: string,
  format: string,
  knownMoves: string[] = []
): Promise<ThreatEntry | null> {
  const info = getBaseStats(species);
  if (!info) return null;

  const row = await getPokemonUsageStats(species, format);

  const usageMoves = Object.entries(row?.moves ?? {})
    .sort(([, a], [, b]) => b - a)
    .map(([name]) => name);
  const knownLower = new Set(knownMoves.map((m) => m.toLowerCase()));
  const moves = [
    ...knownMoves,
    ...usageMoves.filter((m) => !knownLower.has(m.toLowerCase())),
  ].slice(0, 4);

  const spread = row ? getMostPopularSpread(row.spreads) : null;
  const topAbility = Object.entries(row?.abilities ?? {})
    .sort(([, a], [, b]) => b - a)[0]?.[0];
  const topItem = Object.entries(row?.items ?? {})
    .sort(([, a], [, b]) => b - a)[0]?.[0];

  const defaultSet: CalcPokemon = {
    species,
    nature: spread?.nature,
    evs: spread?.evs,
    ability: topAbility,
    item: topItem,
    moves,
    level: 100,
  };

  return {
    species,
    usage_pct: row?.usage_pct ?? 0,
    default_set: defaultSet,
    types: info.types.map(String),
  };
}
