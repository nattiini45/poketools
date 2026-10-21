import type { Enums } from './database';
import type { ActorRole, DraftEngine, DraftKind, DraftMode, DraftPhase, PauseReason } from './draft-queue';

// ── Enum aliases ────────────────────────────────────────────────────
/**
 * The pricing of a legacy pool (`draft_pools.draft_type`); the turn order is `DraftPickOrder`.
 * - `'snake'`: no points, tier limits only (the value keeps its pre-split name).
 * - `'budget'`: fixed costs (the entry's `point_cost`, else the pool's `default_point_cost`).
 * - `'auction'`: bids from the point budget; always `pick_order` `'free'` (CHECK constraint).
 * Queue-engine pools store `'snake'` and price from their point-buy list.
 */
export type DraftType = Enums<'draft_type'>;
/**
 * Turn order of a legacy pool (`draft_pools.pick_order`, migration 20261013124630).
 * - `'snake'`: seat order, reversed every round.
 * - `'linear'`: the same seat order every round.
 * - `'free'`: no turns enforced; players pick any time and admins enter picks for them.
 * The queue engine ignores it (its pools keep the `'snake'` default).
 */
export type DraftPickOrder = 'snake' | 'linear' | 'free';
/** How a pool prices picks, for labels: the legacy `draft_type`, or a queue pool's point-buy list. */
export type DraftPricing = 'none' | 'fixed' | 'auction' | 'pointBuy';
export const DRAFT_PICK_ORDERS: readonly DraftPickOrder[] = ['snake', 'linear', 'free'];
export type DraftPoolStatus = Enums<'draft_pool_status'>;

// ── Draft Pool ──────────────────────────────────────────────────────
export interface DraftPool {
  id: string;
  season_id: string;
  draft_type: DraftType;
  /** Legacy engine turn order; see `DraftPickOrder`. */
  pick_order: DraftPickOrder;
  point_budget: number | null;
  /** 'tier' | 'point_buy' | 'combined' */
  pool_mode: string;
  /** Fallback cost for Pokemon without explicit point_cost */
  default_point_cost: number | null;
  /** 'exact' | 'range' | null (null = use default rounds) */
  team_size_mode: string | null;
  team_size_exact: number | null;
  team_size_min: number | null;
  team_size_max: number | null;
  status: DraftPoolStatus;
  created_at: string;
  updated_at: string;
  // ── Queue engine (migration M2, draft-backend §4.2) ──
  // Legacy pools carry the column defaults (engine 'legacy', kind 'initial', mode 'live', phase 'setup').
  /** 'legacy' = pre-queue pools (client-ordered picks); 'queue' = persisted queue engine. */
  engine: DraftEngine;
  kind: DraftKind;
  mode: DraftMode;
  phase: DraftPhase;
  /** Point-buy list version frozen at pool creation. */
  list_version_id: string | null;
  /** Redraft pools: the season's initial pool. */
  parent_pool_id: string | null;
  roster_size: number | null;
  pick_seconds: number | null;
  makeup_seconds: number | null;
  slow_ladder_seconds: number[];
  /** [plus120, plus60] extension lengths in seconds. */
  extension_seconds: number[];
  extensions_enabled: boolean;
  redraft_max_lines: number | null;
  redraft_lock_no_redraft_lines: boolean;
  submission_deadline_at: string | null;
  submissions_published_at: string | null;
  token_purchase_closes_at: string | null;
  paused_at: string | null;
  paused_by: string | null;
  pause_reason: PauseReason | null;
  state_version: number;
  publish_notified_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_by: string | null;
  /**
   * League groups: the group whose pool this is (`draft_pools.season_group_id`); null in a league without groups.
   * Optional for hand-built fixtures; every mapped row carries it.
   */
  season_group_id?: string | null;
}

export interface DraftPoolWithDetails extends DraftPool {
  season_name: string;
  participant_count: number;
  pick_count: number;
}

/**
 * Insert input of `createDraftPool` (DB column names). `POST /api/drafts` takes two request bodies:
 * the legacy `PoolCreateBody` (`src/components/draft/DraftPoolManager.tsx`; `budget`, not
 * `point_budget`) and, for EPB seasons, the queue body `{ season_id, kind, config?, force? }`
 * (`createQueueDraftSchema`, sent by the admin page's `EpbDraftRoomCreate`).
 */
export interface DraftPoolFormData {
  season_id: string;
  draft_type: DraftType;
  /** Omitted = the column default (`'snake'`). */
  pick_order?: DraftPickOrder;
  point_budget?: number | null;
  pool_mode?: string;
  default_point_cost?: number | null;
  team_size_mode?: string | null;
  team_size_exact?: number | null;
  team_size_min?: number | null;
  team_size_max?: number | null;
}

// ── Draft Pick ──────────────────────────────────────────────────────
export interface DraftPick {
  id: string;
  draft_pool_id: string;
  player_id: string;
  pokemon_name: string;
  pick_number: number;
  round: number;
  points_spent: number | null;
  timestamp: string;
  // ── Line identity (migration M1) and queue engine (migration M2) ──
  /** Draft line id of an EPB pick (branch-exact); null for non-EPB drafts. */
  line_id: string | null;
  line_entry_id: string | null;
  /** Queue slot this pick filled (`draft_slots.id`). */
  slot_id: string | null;
  /** Redraft slot (`redraft_slots.id`) this pick filled. */
  redraft_slot_id: string | null;
  /** Idempotency key of the confirming request. */
  client_request_id: string | null;
  made_by: string | null;
  made_by_role: ActorRole | null;
  override_reason: string | null;
  /** A voided pick no longer counts for budget, roster or availability. */
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
}

export interface DraftPickWithPlayer extends DraftPick {
  player_name: string;
}

export interface MakePickInput {
  draft_pool_id: string;
  player_id: string;
  pokemon_name: string;
  /** Stage-3 branch for EPB branched lines (disambiguates same-base entries) */
  stage3_pokemon?: string | null;
  /** Required for auction/budget drafts; set server-side for EPB */
  points_spent?: number | null;
}

// ── Draft State (computed at runtime, not stored) ───────────────────
export interface DraftState {
  pool: DraftPool;
  picks: DraftPickWithPlayer[];
  /** Map of player_id → list of picked Pokémon names */
  rosters: Record<string, string[]>;
  /** Map of player_id → remaining budget (auction/budget only) */
  budgets: Record<string, number> | null;
  /** Ordered list of player_ids for the current round's pick order */
  pick_order: string[];
  /**
   * player_id of the player who picks next (null if draft complete). With `turn_enforced` false
   * (`pick_order` `'free'`) it is only a display suggestion: anyone may pick.
   */
  current_picker: string | null;
  /** False for `pick_order` `'free'`: the board shows no "your turn" and the picks route checks no turn. */
  turn_enforced: boolean;
  /** Next pick number */
  next_pick_number: number;
  /** Current round number */
  current_round: number;
  /** Set of Pokémon names already drafted (unavailable) */
  taken_pokemon: Set<string>;
}

// ── Snake draft utilities ───────────────────────────────────────────
/** Configuration for snake draft order generation */
export interface SnakeDraftConfig {
  /** Ordered player IDs (seed order for round 1) */
  player_ids: string[];
  /** Total number of rounds */
  total_rounds: number;
}
