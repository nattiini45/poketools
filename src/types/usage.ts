// ── Database row types ──────────────────────────────────────────────

export interface MetaUsageRow {
  id: string;
  format: string;
  pokemon_name: string;
  usage_pct: number;
  lead_pct: number | null;
  moves: Record<string, number>;
  items: Record<string, number>;
  abilities: Record<string, number>;
  teammates: Record<string, number>;
  spreads: Record<string, number>;
  tera_types: Record<string, number> | null;
  counters: Record<string, [number, number, number]> | null;
  viability: number[] | null;
  last_imported: string;
}

// ── API types ───────────────────────────────────────────────────────

export interface UsageListItem {
  pokemon_name: string;
  usage_pct: number;
  types: string[];
  sprite_id: string;
  source: 'league' | 'meta' | 'hybrid';
  base_stats?: {
    hp: number;
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  };
  /** Display tier for the active format (OU, UUBL, NFE, LC, …); null = untiered */
  tier?: string | null;
  /** Whether this Pokémon is legal in the active format (joined from the dex list) */
  legal?: boolean;
}

export interface HybridUsageOptions {
  format: string;
  seasonId?: string;
  tournamentId?: string;
  limit?: number;
  offset?: number;
  minUsage?: number;
  search?: string;
}

export interface EnrichedMoveEntry {
  name: string;
  usage_pct: number;
  type: string;
  category: string;
  power: number | null;
  shortDesc?: string;
}

export interface HybridPokemonDetail {
  pokemon_name: string;
  format: string;
  source: 'league' | 'meta' | 'hybrid';
  usage_pct: number;
  lead_pct: number | null;
  moves: Record<string, number>;
  items: Record<string, number>;
  abilities: Record<string, number>;
  teammates: Record<string, number>;
  spreads: Record<string, number>;
  tera_types: Record<string, number> | null;
  counters: Record<string, [number, number, number]> | null;
  viability: number[] | null;
  types: string[];
  base_stats: {
    hp: number;
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  };
  /** Pre-enriched move data with type, category, power from @pkmn/data */
  enriched_moves?: EnrichedMoveEntry[];
  /** When set, data is from this format instead of the requested one */
  fallback_format?: string;
}

export interface UsageStatsListResponse {
  format: string;
  source: 'league' | 'meta' | 'hybrid';
  last_updated: string;
  pokemon: UsageListItem[];
  total: number;
}

export interface ImportResult {
  format: string;
  pokemonCount: number;
  status: 'success' | 'skipped' | 'error';
  error?: string;
}
