import type { Aggregate, PokemonUsageRow } from '@/types/game';
import type { MetaUsageRow } from '@/types/usage';

/** Default Smogon meta format when global aggregates are empty. */
export const DEFAULT_GLOBAL_META_FORMAT = 'gen9ou';

/**
 * Map pre-computed aggregate rows to usage table rows.
 */
export function aggregatesToUsageRows(
  aggregates: Aggregate[],
  totalGames: number,
): PokemonUsageRow[] {
  return aggregates.map((agg) => ({
    pokemon_name: agg.pokemon_name,
    usage_percent: totalGames > 0 ? (agg.total_appearances / totalGames) * 100 : 0,
    total_appearances: agg.total_appearances,
    total_games: agg.total_games,
    kos_dealt: agg.total_kos_dealt,
    koed_rate:
      agg.total_appearances > 0
        ? (agg.total_koed / agg.total_appearances) * 100
        : 0,
    efficiency:
      agg.total_brought > 0 ? agg.total_kos_dealt / agg.total_brought : null,
    bring_rate:
      agg.total_games > 0 ? (agg.total_brought / agg.total_games) * 100 : null,
    lead_rate:
      agg.total_games > 0 ? (agg.total_led / agg.total_games) * 100 : null,
    win_rate:
      agg.total_appearances > 0
        ? (agg.total_wins / agg.total_appearances) * 100
        : null,
  }));
}

/**
 * Map meta usage rows to usage table rows (global insights fallback).
 * Expects MetaUsageRow fractions already normalized at read (0–1); emits 0–100 display values.
 */
export function metaUsageToUsageRows(rows: MetaUsageRow[]): PokemonUsageRow[] {
  return rows.map((row) => ({
    pokemon_name: row.pokemon_name,
    usage_percent: row.usage_pct * 100,
    total_appearances: 0,
    total_games: 0,
    kos_dealt: 0,
    koed_rate: 0,
    efficiency: null,
    bring_rate: null,
    lead_rate: row.lead_pct != null ? row.lead_pct * 100 : null,
    win_rate: null,
  }));
}
