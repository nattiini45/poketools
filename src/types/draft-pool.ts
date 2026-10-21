// ── Pool Mode ────────────────────────────────────────────────────────

export type PoolMode = 'tier' | 'point_buy' | 'combined';
export type TeamSizeMode = 'exact' | 'range';

// ── Draft Pool Entry ─────────────────────────────────────────────────

export interface DraftPoolEntry {
  id: string;
  season_id: string;
  pokemon_name: string;
  /** Stage-3 branch for EPB branched lines (null for single-path lines) */
  stage3_pokemon?: string | null;
  /** S/A/B/C tier classification (null if point-buy only) */
  power_tier: string | null;
  /** Point buy cost (null if tier-only) */
  point_cost: number | null;
  created_at: string;
}

export interface DraftPoolEntryFormData {
  season_id: string;
  pokemon_name: string;
  power_tier?: string | null;
  point_cost?: number | null;
}

// ── Draft Pool Template ──────────────────────────────────────────────

export interface DraftPoolTemplateEntry {
  pokemon_name: string;
  power_tier?: string | null;
  point_cost?: number | null;
}

export interface DraftPoolTemplate {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  pool_mode: PoolMode;
  entries: DraftPoolTemplateEntry[];
  created_at: string;
}

export interface DraftPoolTemplateFormData {
  name: string;
  description?: string | null;
  pool_mode: PoolMode;
  entries: DraftPoolTemplateEntry[];
}
