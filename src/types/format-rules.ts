import { formatPack, type TeraEligibility } from '@/lib/format-pack';

// ── Format Rules (per-season configuration) ───────────────────────

/** Tera eligibility per evolution stage. The league's values come from the format pack (`epb.teraByStage`). */
export interface TeraRules {
  stage1: TeraEligibility;
  stage2: TeraEligibility;
  stage3: TeraEligibility;
}

/** Fallback tera rules when a season's `format_rules` row is missing or has no tera_rules (format pack). */
export const DEFAULT_TERA_RULES: TeraRules = { ...formatPack.epb.teraByStage };

export type TiebreakerStep =
  | 'match_points'
  | 'evolution_points'
  | 'kill_difference'
  | 'head_to_head'
  | 'decision_match';

/** The default tiebreaker chain (format pack `epb.tiebreakerChain`). */
export const DEFAULT_TIEBREAKER_ORDER: TiebreakerStep[] = [...formatPack.epb.tiebreakerChain];

export interface FormatRules {
  id: string;
  season_id: string;
  banned_moves: string[];
  banned_items: string[];
  tera_rules: TeraRules;
  tiebreaker_order: TiebreakerStep[];
  draft_budget: number;
  draft_picks: number;
  draft_token_ratio: number;
  draft_token_max: number;
  draft_token_max_per_line: number;
  redraft_phase_open: boolean;
  /** Admin switch: Comeback Tokens may be spent although the season has no completed redraft (migration M4, NQ 34). */
  comeback_spend_open?: boolean;
  created_at: string;
}

export interface FormatRulesFormData {
  banned_moves?: string[];
  banned_items?: string[];
  tera_rules?: TeraRules;
  tiebreaker_order?: TiebreakerStep[];
  draft_budget?: number;
  draft_picks?: number;
  draft_token_ratio?: number;
  draft_token_max?: number;
  draft_token_max_per_line?: number;
  redraft_phase_open?: boolean;
  comeback_spend_open?: boolean;
}

// ── Default format bans for Evolution Point Buy (format pack `epb.defaults`) ──

export const DEFAULT_BANNED_MOVES: string[] = [...formatPack.epb.defaults.bannedMoves];

export const DEFAULT_BANNED_ITEMS: string[] = [...formatPack.epb.defaults.bannedItems];

// ── Progress Source Types ─────────────────────────────────────────

/**
 * `evo_progress_log.source` values (CHECK in migration M4). `transferred` = real kills moved from a redraft
 * slot into the new line's `transferred_evo_progress` (evolution progress, never shown as kills).
 */
export type ProgressSourceType =
  | 'real_kill'
  | 'draft_token'
  | 'kill_token'
  | 'cosmo_point'
  | 'transferred'
  | 'admin_correction';

// ── Team Role Categories ──────────────────────────────────────────

export type TeamRoleCategory =
  | 'hazard_setting'
  | 'hazard_removal'
  | 'healing_cleric'
  | 'momentum'
  | 'item_removal'
  | 'status'
  | 'priority'
  | 'disruption';

export const TEAM_ROLE_CATEGORIES: TeamRoleCategory[] = [
  'hazard_setting',
  'hazard_removal',
  'healing_cleric',
  'momentum',
  'item_removal',
  'status',
  'priority',
  'disruption',
];

export interface TeamRole {
  id: string;
  species_form: string;
  stage: number | null;
  category: TeamRoleCategory;
  move_name: string;
  source: string | null;
  is_active: boolean;
  created_at: string;
}
