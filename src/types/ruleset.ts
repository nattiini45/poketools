/**
 * Format ID string following the pattern `gen{1-9}{tier}` (e.g. 'gen3ou', 'gen9vgc')
 * or 'blank' for a custom format with no defaults.
 * Widened to string to support all generation × tier combinations.
 */
export type BaseFormat = string;

/** Tier names recognised by the constraint engine (singles tier hierarchy). */
export type TierKey =
  | 'ZU'
  | 'PU' | 'PUBL'
  | 'NU' | 'NUBL'
  | 'RU' | 'RUBL'
  | 'UU' | 'UUBL'
  | 'OU' | 'Uber' | 'AG';

/**
 * Generic team-composition rules layered on top of a base ruleset.
 * Every field is optional; absent or null constraints behave as if disabled.
 * See `docs/poketools-spec.md` §9.1 for the full schema.
 */
export interface TeamConstraints {
  type_quotas?: {
    source: 'player_core' | 'fixed';
    fixed_types?: string[];
    min_per_type: number;
    allow_multi_count: boolean;
  };
  tera_match?: 'player_core' | 'team_types' | 'none';
  evolution_stage?: {
    mode: 'unrestricted' | 'nfe_only_plus_n_fe';
    fully_evolved_cap?: number;
    fully_evolved_tier_max?: TierKey;
    legendaries_allowed?: boolean;
  };
  eviolite_tier_cap?: TierKey;
}

export interface Ruleset {
  id: string; // Supabase UUID
  name: string;
  base_format: BaseFormat;
  is_doubles: boolean;
  clauses: string[];
  bans: {
    pokemon: string[];
    moves: string[];
    items: string[];
    abilities: string[];
  };
  additions: {
    pokemon: string[]; // unbanned from base format
  };
  custom_rules_string: string;
  min_shared_type_pct: number;
  team_constraints: TeamConstraints | null;
  created_by: string | null; // Player UUID
  created_at: string;
  updated_at: string;
}

export interface RulesetFormData {
  name: string;
  base_format: BaseFormat;
  is_doubles: boolean;
  clauses: string[];
  banned_pokemon: string[];
  banned_moves: string[];
  banned_items: string[];
  banned_abilities: string[];
  added_pokemon: string[];
  custom_rules_string: string;
  min_shared_type_pct: number;
  team_constraints: TeamConstraints | null;
}
