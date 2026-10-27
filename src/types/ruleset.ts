import type { ResolvedRules } from '@/lib/ruleset-kit/types';

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

/**
 * A published ruleset as the readers see it. `id` is the id of a stored VERSION (an immutable published ruleset),
 * which is what `seasons.ruleset_id` and `tournaments.ruleset_id` pin: reading a ruleset by a pinned id always
 * returns the rules the league was created with, however the ruleset was edited since.
 *
 * `rules` is the single enforcement source (`validateTeam` reads nothing else). The name-based members (`bans`,
 * `additions`, `allow`, `clauses`) are DERIVED views of it for display and for the consumers that predate the
 * studio: English display names hydrated from the dex on the server (an id the dex does not know keeps the id).
 * A category in allowlist mode has an empty `bans` list and its listed entries in `allow`.
 */
export interface Ruleset {
  id: string; // Supabase UUID of the version
  name: string;
  /** The format key (usage stats, tier columns, AI context): `rules.format_key`. */
  base_format: BaseFormat;
  is_doubles: boolean;
  /** Showdown clause names, e.g. 'Species Clause'. */
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
  /** Allowlist entries (display names) per category; `null` when the category is not in allowlist mode. */
  allow: {
    pokemon: string[] | null;
    moves: string[] | null;
    items: string[] | null;
    abilities: string[] | null;
  };
  custom_rules_string: string;
  min_shared_type_pct: number;
  team_constraints: TeamConstraints | null;
  /** The generation the rules are for (1 to 9). */
  gen: number;
  universe: 'standard' | 'national';
  /** The frozen effective rules: the one thing the validator enforces. */
  rules: ResolvedRules;
  /** Which stored definition and version this is; `null` for a ruleset built in code (EPB draft room, AI fallback). */
  version: { definition_id: string; version_no: number } | null;
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
