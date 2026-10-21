import type { AppliedOverride } from '@/lib/draft/league-overrides';
import { epbPack } from '@/lib/format-pack';

export type { AppliedOverride };

// ── Point-Buy List Version (immutable snapshot container) ─────────

export interface PointBuyListVersion {
  id: string;
  name: string;
  version: number;
  source: string | null;
  is_active: boolean;
  created_at: string;
}

export interface PointBuyListVersionFormData {
  name: string;
  version?: number;
  source?: string | null;
}

// ── Price Groups ──────────────────────────────────────────────────

export type PriceGroup = 'premium' | 'hoch' | 'mittel' | 'guenstig' | 'budget';

/**
 * The five stored keys in the active format pack's display order (`epb.priceGroupOrder`, highest first).
 * Labels come from `enums.priceGroup`; the ranges are `PRICE_GROUP_RANGES` (`src/lib/evolution/point-buy-display.ts`).
 */
export const PRICE_GROUPS: PriceGroup[] = [...epbPack.priceGroupOrder];

// ── Special Rules (per evolution line) ────────────────────────────

/**
 * Stored per-line flags (`point_buy_list_entries.special_rules` jsonb). The key names are DB data;
 * which lines carry them comes from the format pack's `epb.lineRules` (`STORED_FLAG`, `@/lib/format-pack`).
 */
export interface SpecialRules {
  /** Instant-final-stage line: crossing stage 2 also reaches the final stage at once. */
  scatterbug?: boolean;
  /** No-cocoon line (catalog filter only). */
  no_cocoon_rule?: boolean;
  /** Participation line: earns participation tokens. */
  cosmog?: boolean;
  /** Excluded from the redraft (SQL reads this flag). */
  no_redraft?: boolean;
}

// ── Point-Buy List Entry (one evolution line) ─────────────────────

/** pkmn IDs for sprite/species resolution across the line's forms. */
export interface SpeciesIds {
  base: string;
  stage2: string;
  stage3: string | null;
}

export interface PointBuyListEntry {
  id: string;
  list_version_id: string;
  line_number: number;
  /**
   * Stable line id `toID(base)--toID(final stage)` (src/lib/draft/line-identity.ts), stored by migration M1
   * (NOT NULL; a trigger checks it against the stage names). Set by the point-buy-lists read layer and the importer.
   */
  line_id: string;
  base_pokemon: string;
  stage2_pokemon: string;
  stage3_pokemon: string | null;
  price: number;
  /** League overrides already applied (src/lib/draft/league-overrides.ts); the sheet value is in `overrides`. */
  kills_to_stage2: number;
  /** Additional kills needed AFTER stage 2 evolution (not cumulative); league overrides already applied */
  additional_kills_to_stage3: number | null;
  price_group: PriceGroup;
  early_rating: number | null;
  mid_rating: number | null;
  late_rating: number | null;
  rationale: string | null;
  historical_data: string | null;
  special_rules: SpecialRules | null;
  /** Free-text special rules prose from the Point-Buy sheet */
  special_rules_text: string | null;
  sources: string | null;
  legacy_tier: string | null;
  /** Sprite/species IDs for the line's forms (populated by the importer) */
  species_ids: SpeciesIds | null;
  /** League overrides applied on read (`[]` when none); absent on rows that did not pass the read layer. */
  overrides?: AppliedOverride[];
}

export interface PointBuyListEntryFormData {
  line_number: number;
  /**
   * Computed by the importer (`toLineId`); the M1 trigger checks it. Optional: the admin entries route
   * (`api/point-buy-lists/[id]/entries`) does not set it, and the write path derives it from the stage names.
   */
  line_id?: string;
  base_pokemon: string;
  stage2_pokemon: string;
  stage3_pokemon?: string | null;
  price: number;
  kills_to_stage2: number;
  additional_kills_to_stage3?: number | null;
  price_group: PriceGroup;
  early_rating?: number | null;
  mid_rating?: number | null;
  late_rating?: number | null;
  rationale?: string | null;
  historical_data?: string | null;
  special_rules?: SpecialRules | null;
  special_rules_text?: string | null;
  sources?: string | null;
  legacy_tier?: string | null;
  species_ids?: SpeciesIds | null;
}

// ── Import Report ─────────────────────────────────────────────────

export interface PointBuyImportReport {
  total_lines: number;
  imported: number;
  skipped: number;
  warnings: string[];
  errors: string[];
  version_id: string | null;
  version_name: string | null;
}
