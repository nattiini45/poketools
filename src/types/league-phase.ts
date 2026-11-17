import type { Enums, Json } from './database';
import type { Player } from './player';
import type { AdvancementRule, EnrollmentSource, SeasonFormatType } from './season';
import type { BracketSide, RoundStatus } from './round';
import type { BoOverrides, BracketType, TeamVisibility } from './tournament';

export type PhaseStatus = Enums<'phase_status'>;

export interface Phase {
  id: string;
  season_id: string;
  name: string;
  description: string;
  bracket_type: BracketType;
  ruleset_id: string;
  best_of_default: number;
  bo_overrides: BoOverrides;
  is_doubles: boolean;
  team_visibility: TeamVisibility;
  status: PhaseStatus;
  current_round: number;
  stage_order: number;
  advancement_rule: AdvancementRule | null;
  enrollment_source: EnrollmentSource | null;
  archived: boolean;
  legacy: boolean;
  bracket_reset_enabled: boolean;
  third_place_enabled: boolean;
  format_stage_key: string | null;
  format_group: number;
  stage_spec: Json | null;
  season_format_type?: SeasonFormatType | null;
  created_at: string;
  updated_at: string;
}

export interface PhaseWithDetails extends Phase {
  ruleset_name: string;
  season_name: string;
  participant_count: number;
}

export interface PhaseFormData {
  season_id: string;
  name: string;
  description?: string;
  bracket_type: BracketType;
  ruleset_id: string;
  best_of_default: number;
  bo_overrides?: BoOverrides;
  is_doubles: boolean;
  team_visibility: TeamVisibility;
  stage_order?: number;
  advancement_rule?: AdvancementRule | null;
  bracket_reset_enabled?: boolean;
  third_place_enabled?: boolean;
  format_stage_key?: string | null;
  format_group?: number;
  stage_spec?: Json | null;
}

export interface PhaseRound {
  id: string;
  phase_id: string;
  name: string;
  round_number: number;
  best_of: number;
  status: RoundStatus;
  pairings_generated: boolean;
  deadline: string | null;
  bracket_side: BracketSide | null;
  bye_player_ids: string[];
  created_at: string;
  updated_at: string;
}

/** Server-internal player shape; map to a public participant before serialization. */
export interface PhaseParticipant extends Player {
  seed: number | null;
  starting_bracket: 'winners' | 'losers';
}

export interface PhaseGroup {
  id: string;
  phase_id: string;
  season_id: string;
  name: string;
  group_number: number;
  season_group_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PhaseGroupMember {
  player_id: string;
  player_name: string;
  seed: number;
  gym_type: null;
}

export interface PhaseGroupWithMembers extends PhaseGroup {
  members: PhaseGroupMember[];
}
