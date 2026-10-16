import type { Enums, Json } from './database';
import type { AdvancementRule, EnrollmentSource, SeasonFormatType } from './season';
import type { Player } from './player';
import type { PublicTournamentParticipant } from '@/lib/players/public-player';

/** Player with optional seed for tournament ordering. */
export interface ParticipantWithSeed extends Player {
  seed: number | null;
  starting_bracket: 'winners' | 'losers';
}

/**
 * Participant row for public/API list endpoints: `{ id, name, avatar_url,
 * seed, starting_bracket }` only. Map with `toPublicTournamentParticipant`
 * (`src/lib/players/public-player.ts`), never a spread of the player row.
 */
export type PublicParticipantWithSeed = PublicTournamentParticipant;

export type BracketType = Enums<'bracket_type'>;
export type TournamentStatus = Enums<'tournament_status'>;
export type TeamVisibility = Enums<'team_visibility'>;

/** Map of round name → best-of value, e.g. { "Semifinals": 3, "Finals": 5 } */
export type BoOverrides = Record<string, number>;

export interface Tournament {
  id: string;
  name: string;
  description: string;
  season_id: string | null;
  bracket_type: BracketType;
  ruleset_id: string;
  best_of_default: number;
  bo_overrides: BoOverrides;
  is_doubles: boolean;
  team_visibility: TeamVisibility;
  status: TournamentStatus;
  current_round: number;
  stage_order: number;
  advancement_rule: AdvancementRule | null;
  enrollment_source: EnrollmentSource | null;
  archived: boolean;
  legacy: boolean;
  /**
   * Double elimination only: when true (default), the bracket graph includes
   * the conditional "if necessary" Grand Finals reset slot. Optional in the
   * type so test fixtures and older call sites read as the default (true).
   */
  bracket_reset_enabled?: boolean;
  created_at: string;
  updated_at: string;
  /**
   * Format of the bound season (joined by getTournamentById); null for
   * standalone tournaments. Optional: list queries do not populate it.
   */
  season_format_type?: SeasonFormatType | null;
}

export interface TournamentWithDetails extends Tournament {
  ruleset_name: string;
  season_name: string | null;
  participant_count: number;
}

export interface TournamentFormData {
  name: string;
  description?: string;
  season_id?: string | null;
  bracket_type: BracketType;
  ruleset_id: string;
  best_of_default: number;
  bo_overrides?: BoOverrides;
  is_doubles: boolean;
  team_visibility: TeamVisibility;
  stage_order?: number;
  advancement_rule?: AdvancementRule | null;
  bracket_reset_enabled?: boolean;
}

/**
 * Helper to safely parse advancement_rule from JSON.
 */
/**
 * Helper to safely parse bo_overrides from JSON.
 */
export function parseBoOverrides(raw: Json | null): BoOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: BoOverrides = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === 'number' && val > 0) {
      result[key] = val;
    }
  }
  return result;
}

export function parseEnrollmentSource(raw: Json | null): EnrollmentSource | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (
    (obj.type === 'standings' || obj.type === 'roster') &&
    typeof obj.synced_at === 'string' &&
    typeof obj.frozen === 'boolean'
  ) {
    return {
      type: obj.type,
      source_phase_id: typeof obj.source_phase_id === 'string' ? obj.source_phase_id : null,
      synced_at: obj.synced_at,
      frozen: obj.frozen,
    };
  }
  return null;
}

export function parseAdvancementRule(raw: Json | null): AdvancementRule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.type === 'top_n' && typeof obj.count === 'number' && typeof obj.per_group === 'boolean') {
    return { type: 'top_n', count: obj.count, per_group: obj.per_group };
  }
  return null;
}

/** Lightweight standing projection passed to client components. */
export interface PlayerStanding {
  rank: number;   // 1-based ordinal position
  wins: number;
  losses: number;
  draws: number;
}
