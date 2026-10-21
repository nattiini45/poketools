import type { Enums } from './database';

// ── Stat spread ──────────────────────────────────────────────────────
export interface StatSpread {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

// ── Individual Pokémon set (stored in the `pokemon` JSONB column) ────
export interface PokemonSet {
  name: string;       // nickname (empty string if none)
  species: string;    // canonical species name from @pkmn/data
  gender: string;     // 'M' | 'F' | '' (genderless / not specified)
  item: string;
  ability: string;
  evs: StatSpread;
  ivs: StatSpread;
  nature: string;
  level: number;      // defaults to 100
  moves: string[];    // 1–4 moves
  shiny?: boolean;
  happiness?: number;
  tera_type?: string; // Gen 9 tera type
}

// ── Domain types ─────────────────────────────────────────────────────
export type TeamImportSource = Enums<'team_import_source'>;

export interface Team {
  id: string;
  player_id: string;
  /** User-chosen team name (empty string if unnamed) */
  name: string;
  tournament_id: string | null;
  season_id: string | null;
  match_id: string | null;
  pokemon: PokemonSet[];
  import_source: TeamImportSource;
  locked: boolean;
  is_draft_team: boolean;
  draft_pool_id: string | null;
  // `share_token` / `share_enabled_at` are deliberately absent: the token is
  // the authorization for the public share link, so it reaches only the owner
  // (as `TeamShareLink`, from `setTeamShareToken`). Team reads never select it.
  library_published_at: string | null;
  library_title: string | null;
  library_description: string | null;
  library_tags: string[] | null;
  forked_from_team_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamWithContext extends Team {
  tournament_name: string | null;
}

export interface TeamFormData {
  tournament_id: string | null;
  season_id?: string | null;
  pokemon: PokemonSet[];
  import_source: TeamImportSource;
  name?: string;
}

// ── Import request / response ────────────────────────────────────────
export interface ImportTeamRequest {
  /** Raw Pokémon Showdown paste text */
  text?: string;
  /** pokepast.es URL (e.g. https://pokepast.es/abc123) */
  url?: string;
  /** Ruleset ID to validate against (optional) */
  ruleset_id?: string;
}

export interface ImportTeamResponse {
  pokemon: PokemonSet[];
  validation: TeamValidationResult | null;
}

// ── Validation ───────────────────────────────────────────────────────
/**
 * Machine code of a validation issue: a key of `teambuilder.validation.issue`
 * (sweep S5). The English `issue` text stays for the AI agent tools and logs;
 * the UI renders by code and falls back to `issue` when a code is missing.
 */
export type ValidationIssueCode =
  // Per-set (`SetIssue`)
  | 'unknown_species'
  | 'species_banned'
  | 'min_moves'
  | 'max_moves'
  | 'unknown_move'
  | 'move_banned'
  | 'unknown_item'
  | 'item_banned'
  | 'unknown_ability'
  | 'ability_banned'
  | 'ev_total'
  | 'ev_stat_cap'
  | 'tera_core_mismatch'
  | 'tera_type_mismatch'
  | 'legendary_phase'
  | 'legendary'
  | 'fe_tier_above_cap'
  | 'fe_no_tier'
  | 'eviolite_tier_cap'
  | 'epb_stage2_tera'
  | 'epb_stage_tera'
  // Team-wide (`TeamIssue`)
  | 'team_empty'
  | 'team_too_large'
  | 'species_clause'
  | 'item_clause'
  | 'shared_type'
  | 'type_quota_no_core'
  | 'type_quota'
  | 'tera_match_no_core'
  | 'evolution_stage_cap'
  | 'not_in_roster';

/**
 * Params of a validation issue. Names follow the pkmn seam
 * (`species`/`move`/`item`/`ability`/`type` carry English @pkmn names,
 * `types` a `/`-joined type list, `stat` a stat key); the rest are numbers or
 * tier labels.
 */
export type ValidationIssueParams = Record<string, string | number>;

export interface SetIssue {
  /** Deterministic ID for jump-to-slot UX (format: "slot-{index}-{hash}") */
  issue_id?: string;
  pokemon_index: number;
  species: string;
  /** English text (AI agent tools, logs, fallback when `code` is missing). */
  issue: string;
  severity: 'error' | 'warning';
  code?: ValidationIssueCode;
  params?: ValidationIssueParams;
}

/** A team-wide issue with its code; `issue` equals the matching `team_issues` entry. */
export interface TeamIssue {
  issue: string;
  code?: ValidationIssueCode;
  params?: ValidationIssueParams;
}

export interface TeamValidationResult {
  valid: boolean;
  issues: SetIssue[];
  team_issues: string[];  // team-wide problems (e.g. Species Clause), English
  /** The same team-wide issues with codes, aligned to `team_issues` (absent from older producers). */
  team_issue_details?: TeamIssue[];
}

export interface ValidateTeamRequest {
  pokemon: PokemonSet[];
  ruleset_id: string;
}

// ── Editor mode ──────────────────────────────────────────────────────
/** Which surface is rendering the team editor */
export type TeamMode = 'teambuilder' | 'plan' | 'library';

// ── Shared team view (public API response) ──────────────────────────
export interface SharedTeamView {
  id: string;
  pokemon: PokemonSet[];
  library_title: string | null;
  library_description: string | null;
  tournament_id: string | null;
  created_at: string;
}

// ── Share link ───────────────────────────────────────────────────────
export interface TeamShareLink {
  team_id: string;
  share_token: string;
  share_enabled_at: string;
}

// ── Library entry ────────────────────────────────────────────────────
export interface TeamLibraryEntry {
  id: string;
  player_id: string;
  pokemon: PokemonSet[];
  library_title: string | null;
  library_description: string | null;
  library_tags: string[] | null;
  library_published_at: string;
  forked_from_team_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamLibraryListParams {
  limit?: number;
  offset?: number;
  tags?: string[];
  search?: string;
}

