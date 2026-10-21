/**
 * Draft contracts (draft-backend §7.1, §10; critique S8). Client-safe: types
 * and constants only. This is the one import point for every draft DTO and
 * union; `src/lib/draft-ui/snapshot-types.ts` re-exports from here and
 * declares nothing.
 *
 * `LineId`, `UtilityKey` and `PriceTabKey` are declared once in the B-LINE
 * modules (they land a stage earlier) and re-exported here.
 */
import { formatPack } from '@/lib/format-pack';
import type { QuietHours } from '@/lib/format-pack/types';
import type { LineId } from '@/lib/draft/line-identity';
import type { ApiError } from '@/types/api';

export type { LineId } from '@/lib/draft/line-identity';
export type { QuietHours } from '@/lib/format-pack/types';
export type { UtilityKey } from '@/lib/draft/utility-categories';
export type { PriceTabKey } from '@/lib/draft/price-tabs';

export type DraftEngine = 'legacy' | 'queue';
export type DraftKind = 'initial' | 'redraft';
export type DraftMode = 'live' | 'slow';
export type DraftPhase = 'setup' | 'submissions' | 'drafting' | 'complete' | 'cancelled';
export type PoolStatus = 'pending' | 'in_progress' | 'complete';
export type SlotKind = 'normal' | 'makeup';
export type SlotStatus = 'pending' | 'active' | 'done' | 'timed_out' | 'blocked' | 'forfeited';
export type ExtensionKind = 'plus120' | 'plus60';
export type PauseReason = 'admin' | 'blocked_slot';
export type ActorRole = 'player' | 'admin' | 'system';

/** = the `draft_action_log.action` CHECK list of M2, same order (`draft-queue.contract.test.ts` parses the migration). */
export const DRAFT_AUDIT_ACTIONS = [
  'draft_configured',
  'seats_changed',
  'draft_started',
  'draft_ended',
  'draft_cancelled',
  'pick_confirmed',
  'pick_admin_override',
  'pick_voided',
  'pick_corrected',
  'slot_blocked',
  'slot_assigned',
  'slot_forfeited',
  'paused',
  'resumed',
  'timeout',
  'extension_used',
  'penalty_changed',
  'submission_changed',
  'submissions_frozen',
  'submissions_published',
  'drop_restored',
  'token_purchased',
  'comeback_spent',
  'comeback_spend_opened',
] as const;
export type DraftAuditAction = (typeof DRAFT_AUDIT_ACTIONS)[number];

/** Line- and viewer-level draftability reasons (rendered via the FE `draft/shared.reasons.<CODE>` map). */
export type ReasonCode =
  | 'LINE_TAKEN'
  | 'INSUFFICIENT_BUDGET'
  | 'BUDGET_INFEASIBLE'
  | 'NOT_ENOUGH_LINES'
  | 'POOL_NOT_COMPLETABLE'
  | 'POOL_CHECK_LIMIT'
  | 'LINE_RESTRICTED'
  | 'OWN_REDRAFT_DROP'
  | 'COSMOG_REDRAFT_LOCKED'
  | 'NOT_IN_LIST'
  | 'NOT_YOUR_TURN'
  | 'DRAFT_PAUSED'
  | 'ROSTER_FULL'
  | 'NOT_PARTICIPANT'
  | 'SIGNED_OUT'
  | 'DRAFT_NOT_STARTED'
  | 'DRAFT_COMPLETE'
  | 'NO_OPEN_REDRAFT_SLOT'
  | 'SUBMISSION_PHASE';

/**
 * Params: LINE_TAKEN {player_id}; INSUFFICIENT_BUDGET {price, remaining};
 * BUDGET_INFEASIBLE {shortfall, slots}; NOT_ENOUGH_LINES {slots, available};
 * ROSTER_FULL {size}; DRAFT_PAUSED {reason: PauseReason}.
 */
export interface ReasonDTO {
  code: ReasonCode;
  params?: Record<string, string | number>;
}

/** Stored, normalised pool config (one name per field everywhere: DB column = TS field = zod key = DTO key). */
export interface DraftConfig {
  mode: DraftMode;
  roster_size: number;
  budget: number;
  pick_seconds: number;
  makeup_seconds: number;
  slow_ladder_seconds: number[];
  extension_seconds: [number, number];
  extensions_enabled: boolean;
  redraft_max_lines: number | null;
  redraft_lock_no_redraft_lines: boolean;
  submission_deadline_at: string | null;
  token_purchase_closes_at: string | null;
}

/** Request body of POST /api/drafts `config` and PATCH /api/drafts/[id]/config (all optional; critique B6). */
export interface DraftConfigInput {
  mode?: DraftMode;
  roster_size?: number;
  budget?: number;
  pick_seconds?: number;
  makeup_seconds?: number;
  slow_ladder_seconds?: number[];
  extensions_enabled?: boolean;
  redraft_max_lines?: number | null;
  redraft_lock_no_redraft_lines?: boolean;
  /** Player ids, seat 1 first (redraft: worst first-half standing first). */
  participant_order?: string[];
  /** Redraft only, ISO UTC, > now. */
  submission_deadline_at?: string | null;
  /** Initial pool only; null = default cutoff (first confirmed result). */
  token_purchase_closes_at?: string | null;
}

/**
 * Defaults of the config fields that do not come from the season.
 * `budget` / `roster_size` default from `format_rules.draft_budget` / `draft_picks`; the redraft
 * line cap comes from the format pack (`epb.defaults.redraftMaxLines`).
 */
export type DraftConfigDefaults = Readonly<
  Omit<
    DraftConfig,
    'budget' | 'roster_size' | 'submission_deadline_at' | 'token_purchase_closes_at' | 'slow_ladder_seconds' | 'extension_seconds'
  > & {
    slow_ladder_seconds: readonly number[];
    extension_seconds: readonly [number, number];
  }
>;
/** Deep-frozen (DC-0): the arrays are shared, so copy them (`[...x]`) before handing one out. */
export const DEFAULT_DRAFT_CONFIG: DraftConfigDefaults = Object.freeze({
  mode: 'live',
  pick_seconds: 300,
  makeup_seconds: 150,
  slow_ladder_seconds: Object.freeze([43_200, 21_600, 10_800, 5_400]),
  extension_seconds: Object.freeze([120, 60] as const),
  extensions_enabled: true,
  redraft_max_lines: formatPack.epb.defaults.redraftMaxLines,
  redraft_lock_no_redraft_lines: true,
});

export interface AdminPoolSummary {
  id: string;
  /**
   * `'legacy'`: a pool from before migration M2 (the old DraftBoard engine);
   * the queue draft room, redraft page and control panel never open it (its
   * snapshot raises POOL_ENGINE_LEGACY).
   */
  engine: DraftEngine;
  kind: DraftKind;
  phase: DraftPhase;
  mode: DraftMode;
  status: PoolStatus;
  /** League groups: the pool's group (absent or null in a league without groups). The admin control page reads it. */
  season_group_id?: string | null;
  /** League groups: the group's name, for labels (absent or null without a group). */
  season_group_name?: string | null;
}

// ── §10.1 snapshot ─────────────────────────────────────────────────────────

export interface DraftSnapshotPool {
  id: string;
  season_id: string;
  kind: DraftKind;
  mode: DraftMode;
  status: PoolStatus;
  paused: boolean;
  paused_at: string | null;
  roster_size: number;
  budget: number;
  started_at: string | null;
  ended_at: string | null;
  phase: DraftPhase;
  pause_reason: PauseReason | null;
  list_version_id: string;
  league_time_zone: string;
}

export interface DraftSnapshotConfig {
  pick_seconds: number;
  makeup_seconds: number;
  slow_ladder_seconds: number[];
  /** null when mode='slow' or extensions are disabled. */
  extension_seconds: [number, number] | null;
  redraft_max_lines: number | null;
  /**
   * The pool's daily quiet window (e.g. 00:00-06:00 Europe/Berlin): pick clocks do not run inside it, picking stays allowed. Frozen at pool
   * creation from the format pack; null = none. `active_slot.deadline_at` already accounts for it (running time).
   */
  quiet_hours: QuietHours | null;
}

export interface DraftSnapshotParticipant {
  player_id: string;
  name: string;
  avatar_url: string | null;
  seat: number;
  standing_rank: number | null;
  slots_total: number;
  picks_made: number;
  open_slots: number;
  budget_start: number;
  budget_remaining: number;
  /** 0..len(ladder)-1 */
  penalty_stage: number;
  timeout_count: number;
  extensions: { plus120_used: boolean; plus60_used: boolean };
  done: boolean;
}

export interface DraftActiveSlot {
  slot_id: string;
  player_id: string;
  round: number;
  /** Nominal pick number. */
  pick_number: number;
  kind: SlotKind;
  /** Always 'active': the retired blocked-slot state is never produced. */
  status: 'active';
  duration_ms: number;
  extensions_applied_ms: number;
  started_at: string;
  deadline_at: string | null;
  remaining_ms_at_pause: number | null;
}

export interface DraftUpcomingSlot {
  slot_id: string;
  player_id: string;
  pick_number: number;
  round: number;
  kind: SlotKind;
  duration_ms: number;
}

export interface DraftSnapshotPick {
  pick_id: string;
  slot_id: string;
  pick_number: number;
  round: number;
  player_id: string;
  line_id: LineId;
  entry_id: string;
  price: number;
  made_at: string;
  admin_override: boolean;
  redraft_slot_id: string | null;
}

export interface DraftSnapshotRedraft {
  phase: 'submissions' | 'locked' | 'drafting' | 'complete';
  deadline_at: string | null;
  published_at: string | null;
  /** null before publish; no other player's submission is ever in the payload. */
  drops: { player_id: string; line_id: LineId; transferred_real_kills: number }[] | null;
  viewer_slots: {
    redraft_slot_id: string;
    label: string;
    dropped_line_id: LineId;
    transferred_real_kills: number;
    filled_by_pick_id: string | null;
  }[];
  /**
   * Every published redraft slot, with ids. Present only for a pool admin viewer
   * after publish (BE #23 restore-drop); absent otherwise.
   */
  admin_slots?: DraftAdminRedraftSlot[];
}

/** One published redraft slot as a pool admin sees it (`DraftSnapshotRedraft.admin_slots`). */
export interface DraftAdminRedraftSlot {
  redraft_slot_id: string;
  player_id: string;
  label: string;
  dropped_line_id: LineId;
  transferred_real_kills: number;
  filled_by_pick_id: string | null;
}

export interface DraftRecentEvent {
  at: string;
  action: DraftAuditAction;
  actor_role: ActorRole;
  player_id: string | null;
  line_id: LineId | null;
  slot_id: string | null;
}

export interface DraftSnapshotViewer {
  player_id: string | null;
  is_participant: boolean;
  is_pool_admin: boolean;
  pick_block: ReasonDTO | null;
  /** Only non-draftable lines. */
  line_status: Record<LineId, ReasonDTO>;
  restricted_line_ids: LineId[];
  /** Admins only. */
  active_player_line_status?: Record<LineId, ReasonDTO>;
}

export interface DraftSnapshotDTO {
  state_version: number;
  server_now: string;
  pool: DraftSnapshotPool;
  config: DraftSnapshotConfig;
  /** Seat order. */
  participants: DraftSnapshotParticipant[];
  active_slot: DraftActiveSlot | null;
  /** Next 10. */
  upcoming: DraftUpcomingSlot[];
  /** Non-voided, ascending. */
  picks: DraftSnapshotPick[];
  /** Line → owner player id (season-wide). */
  taken: Record<LineId, string>;
  redraft: DraftSnapshotRedraft | null;
  /** Last 12 public rows. */
  recent_events: DraftRecentEvent[];
  viewer: DraftSnapshotViewer;
}

/** Error body of every draft route: CORE ApiError (error, code, params) + machine detail + optional fresh snapshot. */
export interface DraftApiErrorBody extends ApiError {
  /** e.g. STALE_SLOT {current_slot_id, current_player_id}; never rendered. */
  detail?: Record<string, string | number>;
  snapshot?: DraftSnapshotDTO;
}

// ── §10.2 my-turn ──────────────────────────────────────────────────────────

export interface MyTurnDTO {
  state_version: number;
  server_now: string;
  status: PoolStatus;
  mode: DraftMode;
  paused: boolean;
  on_clock: boolean;
  up_next: boolean;
  slot_id: string | null;
  deadline_at: string | null;
  remaining_ms_at_pause: number | null;
  league_name: string;
  /** The pool's quiet window (see `DraftSnapshotConfig.quiet_hours`); the remaining time counts running time only. */
  quiet_hours: QuietHours | null;
}

// ── §10.3 tokens ───────────────────────────────────────────────────────────

/** Refusal reasons of a Draft Kill Token purchase; each is an `errors/draft` code (critique B7). */
export type TokenRefusalCode =
  | 'TOKEN_WINDOW_CLOSED'
  | 'TOKEN_PLAYER_LIMIT'
  | 'TOKEN_LINE_LIMIT'
  | 'TOKEN_POINTS_SHORT'
  | 'LINE_FULLY_EVOLVED'
  | 'TOKEN_WOULD_EVOLVE';

export interface TokenOverviewDTO {
  season_id: string;
  player_id: string;
  initial_draft_complete: boolean;
  redraft_complete: boolean;
  draft_kill: {
    window: 'before' | 'open' | 'closed';
    cutoff_at: string | null;
    /** 3 */
    cost: number;
    /** 2 */
    max: number;
    owned: number;
    unspent_points: number;
    lines: {
      line_id: LineId;
      has_token: boolean;
      progress: number;
      next_threshold: number | null;
      eligible: boolean;
      reason: TokenRefusalCode | null;
    }[];
  };
  comeback: {
    earned: number;
    spent: number;
    unspent: number;
    /** score "0:4" → 1 token */
    history: { matchday: number; score: string; tokens: number }[];
    spend_open: boolean;
    /** Which matches earn (format pack `epb.comeback.earnWindow`): the whole season or the first half only. */
    earn_window: 'season' | 'first_half';
  };
  cosmo: null | { line_id: LineId; tokens: number; matchdays_brought: number[] };
  lines: {
    line_id: LineId;
    stage: 1 | 2 | 3;
    self_earned_kills: number;
    transferred_evo_progress: number;
    draft_token_progress: number;
    comeback_token_progress: number;
    cosmo_token_progress: number;
    total_progress: number;
    next_threshold: number | null;
    /** Comeback Tokens per 1 progress point on this line (1 = 1:1; a participation line may need more). */
    comeback_tokens_per_progress: number;
  }[];
}

// ── §10.4 redraft submissions and audit ────────────────────────────────────

export interface RedraftSubmissionDTO {
  line_ids: LineId[];
  updated_at: string | null;
  locked: boolean;
  deadline_at: string;
  max: number;
  /** droppable=false for no_redraft lines. */
  own_lines: { line_id: LineId; real_kills: number; price: number; droppable: boolean }[];
  leftover_budget: number;
}

export interface AdminSubmissionDTO {
  player_id: string;
  player_name: string;
  line_ids: LineId[];
  updated_at: string;
}

/**
 * `GET /api/drafts/[id]/redraft/submissions` (pool admins only): every player's secret drop list plus
 * `draft_pools.publish_refused_at`, the last time the deadline tick refused to publish this Redraft
 * (REDRAFT_NOT_COMPLETABLE / POOL_CHECK_LIMIT); null = never refused.
 */
export interface AdminRedraftSubmissionsDTO {
  submissions: AdminSubmissionDTO[];
  publish_refused_at: string | null;
}

export interface AuditEntryDTO {
  id: string;
  occurred_at: string;
  /** `name` is 'System' for system rows; translated client-side. */
  actor: { player_id: string | null; name: string; role: ActorRole };
  action: DraftAuditAction;
  player_name: string | null;
  line_id: LineId | null;
  slot_label: string | null;
  pick_number: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** `draft_action_log.reason` */
  note: string | null;
  is_public: boolean;
}
