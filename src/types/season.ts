import type { Enums } from './database';
import type { Locale } from '@/i18n/config';
import type { Player } from './player';
import type { BracketType, TeamVisibility, BoOverrides, TournamentStatus } from './tournament';

/** All 18 standard Pokémon types valid for gym leader assignment */
export const POKEMON_TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice',
  'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug',
  'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
] as const;

export type PokemonType = (typeof POKEMON_TYPES)[number];

/** A 3-type core assigned to a Core Liga participant. */
export type CoreTriple = [string, string, string];

export type SeasonFormatType = Enums<'season_format_type'>;
export type SeasonStatus = Enums<'season_status'>;

/**
 * 3D world theme ids for a league season (`seasons.route_theme`).
 * 'auto' resolves through the format map; explicit ids resolve only when the
 * theme is registered in the client theme registry
 * (`src/components/world/themes`) — anything else falls back to the default
 * world. The CHECK list in the migration may name themes whose packages have
 * not landed yet (C-093+), so this union is wider than the registered set.
 */
export const ROUTE_THEMES = ['auto', 'plaza', 'sakura', 'mountain', 'clouds'] as const;
export type RouteThemeId = (typeof ROUTE_THEMES)[number];

export interface Season {
  id: string;
  name: string;
  description: string;
  format_type: SeasonFormatType;
  ruleset_id: string | null;
  start_date: string | null;
  end_date: string | null;
  status: SeasonStatus;
  archived: boolean;
  legacy: boolean;
  /** True for leagues/seasons used only for testing — excluded from global aggregates & public stats. */
  is_test_season: boolean;
  /** Curated Core Liga pool of allowed 3-type triples. null when feature unused. */
  core_pool: CoreTriple[] | null;
  /** Bound point-buy list version for evolution_point_buy format. null for other formats. */
  point_buy_list_id: string | null;
  /** Picked 3D world theme. Absent/undefined ('auto' semantics) until the
   *  migration-backed column is read; resolves through `resolveWorld`. */
  route_theme?: RouteThemeId;
  /** Content language for viewerless text (Discord, social, stored AI reports,
   *  overlays without `?lang=`); `seasons.language`, default 'de'. Viewers always
   *  see their own UI language. */
  language: Locale;
  created_at: string;
  updated_at: string;
}

export interface SeasonWithDetails extends Season {
  ruleset_name: string | null;
  participant_count: number;
  tournament_count: number;
}

/** A league participant with their optional gym leader type and Core Liga core. */
export interface SeasonParticipant extends Player {
  gym_type: string | null;
  core_types: CoreTriple | null;
  core_assigned_at: string | null;
}

export interface SeasonFormData {
  name: string;
  description?: string;
  format_type: SeasonFormatType;
  ruleset_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  core_pool?: CoreTriple[] | null;
  point_buy_list_id?: string | null;
  route_theme?: RouteThemeId;
  /** Content language for viewerless text; omitted = column default 'de'. */
  language?: Locale;
}

export interface AdvancementRule {
  /** How players are selected to advance */
  type: 'top_n';
  /** Number of players to advance */
  count: number;
  /** If true, take top N from EACH group. If false, top N overall. */
  per_group: boolean;
}

/** Tracks automatic standings enrollment for league phases (tournaments). */
export interface EnrollmentSource {
  type: 'standings' | 'roster';
  source_phase_id: string | null;
  synced_at: string;
  frozen: boolean;
}

export interface TournamentGroup {
  id: string;
  tournament_id: string;
  name: string;
  group_number: number;
  created_at: string;
  updated_at: string;
}

export interface TournamentGroupWithMembers extends TournamentGroup {
  members: { player_id: string; player_name: string; seed: number; gym_type: string | null }[];
}

/** League phase — a season-scoped tournament with progress metadata. */
export interface LeaguePhase {
  id: string;
  season_id: string;
  name: string;
  description: string;
  bracket_type: BracketType;
  ruleset_id: string;
  ruleset_name: string;
  best_of_default: number;
  bo_overrides: BoOverrides;
  is_doubles: boolean;
  team_visibility: TeamVisibility;
  status: TournamentStatus;
  stage_order: number;
  advancement_rule: AdvancementRule | null;
  enrollment_source: EnrollmentSource | null;
  participant_count: number;
  rounds_total: number;
  rounds_completed: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
}
