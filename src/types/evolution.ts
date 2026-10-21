import type { ProgressSourceType } from './format-rules';

// ── Evolution Tier (admin-defined per season) ────────────────────

export type PowerTier = 'S' | 'A' | 'B' | 'C';

export const POWER_TIERS: PowerTier[] = ['S', 'A', 'B', 'C'];

export const POWER_TIER_COLORS: Record<PowerTier, { bg: string; text: string; border: string }> = {
  S: { bg: 'bg-red-900/40', text: 'text-red-400', border: 'border-red-700' },
  A: { bg: 'bg-orange-900/40', text: 'text-orange-400', border: 'border-orange-700' },
  B: { bg: 'bg-blue-900/40', text: 'text-blue-400', border: 'border-blue-700' },
  C: { bg: 'bg-gray-800/40', text: 'text-gray-400', border: 'border-gray-600' },
};

export interface EvolutionTier {
  id: string;
  season_id: string;
  /** NULL = tier list entry; SET = wildcard assigned to this player */
  player_id: string | null;
  base_pokemon: string;
  stage2_pokemon: string;
  stage2_kos: number;
  stage3_pokemon: string | null;
  stage3_kos: number | null;
  /** Power tier ranking: S, A, B, or C */
  power_tier: PowerTier;
  created_at: string;
}

export interface EvolutionTierFormData {
  season_id: string;
  player_id?: string | null;
  base_pokemon: string;
  stage2_pokemon: string;
  stage2_kos: number;
  stage3_pokemon?: string | null;
  stage3_kos?: number | null;
  power_tier?: PowerTier;
}

// ── Draft Tier Limits ────────────────────────────────────────────

export interface DraftTierLimit {
  id: string;
  season_id: string;
  power_tier: PowerTier;
  max_picks: number;
}

export interface DraftTierLimitFormData {
  season_id: string;
  power_tier: PowerTier;
  max_picks: number;
}

// ── Evolution Tracker (per player per drafted line) ──────────────

export interface EvolutionTracker {
  id: string;
  season_id: string;
  player_id: string;
  base_pokemon: string;
  current_form: string;
  total_kos: number;
  /** 1 = base, 2 = stage2, 3 = stage3 */
  current_stage: number;
  evolved_at: string | null;
  created_at: string;
  updated_at: string;
  // ── Progress source breakdown (evolution_point_buy format) ──
  /** KOs from actual match results */
  real_kills: number;
  /** Progress from draft tokens (purchased with leftover points) */
  draft_tokens: number;
  /** Progress from kill tokens (awarded from heavy losses) */
  kill_tokens: number;
  /** Progress from participation tokens (the format pack's participation line) */
  cosmo_points: number;
  /** If set, this line is suspended until this matchday (early stage-3 lock) */
  suspended_until_matchday: number | null;
  /** Total evolution points awarded to this player (computed across all lines) */
  evolution_points_awarded: number;
  /** Fixed final evolution for branched lines (e.g. Kirlia → Gardevoir/Gallade); null when unbranched */
  locked_stage3_pokemon: string | null;
  // ── Draft line identity and redraft transfer (migrations M1/M3, draft-backend §12.2) ──
  /** Draft line id (`point_buy_list_entries.line_id`); one tracker per line per season. Null for legacy evolution-tier leagues. */
  line_id: string | null;
  /** Spec `transferred_evo_progress`: real kills transferred from a redraft slot. Counts toward `total_kos` (evolution), never shown as kills. */
  transferred_evo_progress: number;
  /** Redraft slot (`redraft_slots.id`) this line was drafted into; null for initial-draft lines. */
  redraft_slot_id: string | null;
}

export interface EvolutionTrackerWithTier extends EvolutionTracker {
  tier: EvolutionTier;
}

// ── Evolution Event (returned when evolutions occur) ─────────────

export interface EvolutionEvent {
  player_id: string;
  base_pokemon: string;
  previous_form: string;
  new_form: string;
  new_stage: number;
  total_kos: number;
  /** true if this was a de-evolution (match undo) */
  is_devolution: boolean;
  /** Tracker the event belongs to (for persistence; optional for display-only events) */
  tracker_id?: string | null;
  /** Stage before the transition (for persistence) */
  previous_stage?: number | null;
}

/** A persisted development event (evolution_events row). */
export interface EvolutionEventRecord extends EvolutionEvent {
  id: string;
  season_id: string;
  matchday: number | null;
  is_manual: boolean;
  created_at: string;
}

// ── Progress Log Entry (audit trail) ─────────────────────────────

export interface EvoProgressEntry {
  id: string;
  /** Null if the tracker was later deleted (audit rows outlive trackers) */
  tracker_id: string | null;
  season_id: string;
  matchday: number | null;
  source: ProgressSourceType;
  amount: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

// ── Redraft History Entry ────────────────────────────────────────

export interface RedraftHistoryEntry {
  id: string;
  season_id: string;
  player_id: string;
  from_tracker_id: string | null;
  to_base_pokemon: string;
  to_stage3_pokemon: string | null;
  /** 'secret_drop' = a published redraft drop (migration M3); 'free_swap' and 'trade' are retired but kept for history. */
  transfer_type: 'trade' | 'free_swap' | 'secret_drop';
  trade_partner_id: string | null;
  missing_kills_transferred: number;
  points_spent: number;
  created_at: string;
  // ── Secret-drop columns (migration M3); null on trades and retired free swaps ──
  /** Redraft pool that published this drop; null for trades and free swaps. */
  draft_pool_id: string | null;
  /** Line id of the dropped line (secret drop). */
  dropped_line_id: string | null;
  /** Real kills frozen into the redraft slot (secret drop). */
  transferred_real_kills: number | null;
  /** Points refunded for the dropped line (its list price). */
  points_refunded: number | null;
}

// ── Match Evolution Snapshot (per-match point-in-time record) ─────

/**
 * Point-in-time record of a roster line at a specific match.
 * All *_delta fields are per-matchday deltas from evo_progress_log,
 * NOT cumulative tracker totals. Mirrors Tables<'match_evolution_snapshots'>.
 */
export interface MatchEvolutionSnapshot {
  id: string;
  match_id: string;
  player_id: string;
  tracker_id: string | null;
  base_pokemon: string;
  /** Draft line id of the snapshotted tracker (branch-exact). Null/absent on rows written before
   * migration 20261012025154 whose tracker is gone, and in legacy evolution-tier leagues. */
  line_id?: string | null;
  /** Form actually used in the match (pre-evolution form when evolved this matchday) */
  species_at_match: string;
  stage_at_match: number;
  progress_before: number;
  progress_after: number;
  /** Real KOs this matchday (from progress log real_kill entries) */
  real_kos: number;
  /** Progress gained this matchday from draft tokens */
  draft_tokens_delta: number;
  /** Progress gained this matchday from kill tokens */
  kill_tokens_delta: number;
  /** Progress gained this matchday from participation tokens */
  cosmo_points_delta: number;
  evolution_triggered: boolean;
  /** True when this match triggered the early stage-3 suspension */
  suspension_triggered: boolean;
  /** True when a form of this line appeared in the match battle stats */
  brought: boolean;
  created_at: string;
}
