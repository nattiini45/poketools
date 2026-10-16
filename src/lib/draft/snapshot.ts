/**
 * Draft snapshot glue (draft-backend §7.9, §10.1; critique B8/B9). Server only.
 *
 * `getDraftSnapshot` is one `draft_snapshot` RPC plus the allowlist mapper
 * `toDraftSnapshotDTO`, which copies the raw RPC output field by field (no
 * spreads, so a future RPC column cannot leak) and builds the per-viewer
 * `viewer` block with the client-safe draftability evaluator.
 *
 * Ticks: a route handler uses the default `tick: true` (the RPC may resolve
 * timeouts or auto-publish a redraft) and calls `expireDraftReads(seasonId)`
 * when `publishedNow`. Server Component seeds MUST pass `{ tick: false }`: a
 * publish deletes trackers shown on cached public pages, and tags cannot be
 * expired during a render.
 */
import 'server-only';

import { LEAGUE_TIME_ZONE } from '@/lib/draft/time';
import { buildDraftabilityEvaluator, type DraftabilityInput } from '@/lib/draft/draftability';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import type {
  ActorRole,
  DraftActiveSlot,
  DraftAdminRedraftSlot,
  DraftAuditAction,
  DraftKind,
  DraftMode,
  DraftPhase,
  DraftRecentEvent,
  DraftSnapshotDTO,
  DraftSnapshotParticipant,
  DraftSnapshotPick,
  DraftSnapshotRedraft,
  DraftUpcomingSlot,
  LineId,
  MyTurnDTO,
  PauseReason,
  PoolStatus,
  ReasonDTO,
  SlotKind,
} from '@/types/draft-queue';
import { DRAFT_AUDIT_ACTIONS } from '@/types/draft-queue';

/** Who is looking. `isPoolAdmin` = site admin or resource admin of the pool's season (live guards). */
export interface ViewerContext {
  playerId: string;
  isPoolAdmin: boolean;
}

/** `draft_snapshot` with `p_since = state_version`. */
export interface DraftSnapshotUnchanged {
  unchanged: true;
  state_version: number;
  server_now: string;
}

export interface DraftSnapshotResult {
  dto: DraftSnapshotDTO | DraftSnapshotUnchanged;
  /** A redraft was published by this request's tick: the caller expires the draft reads. */
  publishedNow: boolean;
  /**
   * Overdue slots this request's tick resolved (0 without a tick): a new slot may be active, so the caller
   * schedules the turn-ping claim. Never part of the DTO.
   */
  timeoutsResolved: number;
  /** The pool's season; null for an `unchanged` answer (the caller already knows the pool). */
  seasonId: string | null;
}

// ── Raw readers (the RPC returns jsonb; nothing is trusted by shape) ───────────

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const rec = (v: unknown): Raw => (isRecord(v) ? v : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean => v === true;

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
function oneOfOrNull<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

const KINDS: readonly DraftKind[] = ['initial', 'redraft'];
const MODES: readonly DraftMode[] = ['live', 'slow'];
const PHASES: readonly DraftPhase[] = ['setup', 'submissions', 'drafting', 'complete', 'cancelled'];
const STATUSES: readonly PoolStatus[] = ['pending', 'in_progress', 'complete'];
const PAUSE_REASONS: readonly PauseReason[] = ['admin', 'blocked_slot'];
const SLOT_KINDS: readonly SlotKind[] = ['normal', 'makeup'];
const ACTOR_ROLES: readonly ActorRole[] = ['player', 'admin', 'system'];
const REDRAFT_PHASES: readonly DraftSnapshotRedraft['phase'][] = ['submissions', 'locked', 'drafting', 'complete'];
const RESTRICTION_REASONS = ['own_redraft_drop', 'admin'] as const;

function stringRecord(v: unknown): Record<LineId, string> {
  const out: Record<LineId, string> = {};
  for (const [key, value] of Object.entries(rec(v))) if (typeof value === 'string') out[key] = value;
  return out;
}
function numberRecord(v: unknown): Record<LineId, number> {
  const out: Record<LineId, number> = {};
  for (const [key, value] of Object.entries(rec(v))) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

function toParticipant(v: unknown): DraftSnapshotParticipant {
  const p = rec(v);
  const ext = rec(p.extensions);
  return {
    player_id: str(p.player_id),
    name: str(p.name),
    avatar_url: strOrNull(p.avatar_url),
    seat: num(p.seat),
    standing_rank: numOrNull(p.standing_rank),
    slots_total: num(p.slots_total),
    picks_made: num(p.picks_made),
    open_slots: num(p.open_slots),
    budget_start: num(p.budget_start),
    budget_remaining: num(p.budget_remaining),
    penalty_stage: num(p.penalty_stage),
    timeout_count: num(p.timeout_count),
    extensions: { plus120_used: bool(ext.plus120_used), plus60_used: bool(ext.plus60_used) },
    done: bool(p.done),
  };
}

function toActiveSlot(v: unknown): DraftActiveSlot | null {
  if (!isRecord(v)) return null;
  return {
    slot_id: str(v.slot_id),
    player_id: str(v.player_id),
    round: num(v.round),
    pick_number: num(v.pick_number),
    kind: oneOf(v.kind, SLOT_KINDS, 'normal'),
    status: v.status === 'blocked' ? 'blocked' : 'active',
    duration_ms: num(v.duration_ms),
    extensions_applied_ms: num(v.extensions_applied_ms),
    started_at: str(v.started_at),
    deadline_at: strOrNull(v.deadline_at),
    remaining_ms_at_pause: numOrNull(v.remaining_ms_at_pause),
  };
}

function toUpcoming(v: unknown): DraftUpcomingSlot {
  const u = rec(v);
  return {
    slot_id: str(u.slot_id),
    player_id: str(u.player_id),
    pick_number: num(u.pick_number),
    round: num(u.round),
    kind: oneOf(u.kind, SLOT_KINDS, 'normal'),
    duration_ms: num(u.duration_ms),
  };
}

function toPick(v: unknown): DraftSnapshotPick {
  const k = rec(v);
  return {
    pick_id: str(k.pick_id),
    slot_id: str(k.slot_id),
    pick_number: num(k.pick_number),
    round: num(k.round),
    player_id: str(k.player_id),
    line_id: str(k.line_id),
    entry_id: str(k.entry_id),
    price: num(k.price),
    made_at: str(k.made_at),
    admin_override: bool(k.admin_override),
    redraft_slot_id: strOrNull(k.redraft_slot_id),
  };
}

function toRecentEvent(v: unknown): DraftRecentEvent | null {
  const e = rec(v);
  const action = oneOfOrNull<DraftAuditAction>(e.action, DRAFT_AUDIT_ACTIONS);
  // Defence in depth: the RPC already filters these out of the public feed.
  if (action === null || action === 'submission_changed' || action === 'submissions_frozen') return null;
  return {
    at: str(e.at),
    action,
    actor_role: oneOf(e.actor_role, ACTOR_ROLES, 'system'),
    player_id: strOrNull(e.player_id),
    line_id: strOrNull(e.line_id),
    slot_id: strOrNull(e.slot_id),
  };
}

type RawRedraftSlot = DraftAdminRedraftSlot;

function toRawRedraftSlot(v: unknown): RawRedraftSlot {
  const s = rec(v);
  return {
    redraft_slot_id: str(s.redraft_slot_id),
    player_id: str(s.player_id),
    label: str(s.label),
    dropped_line_id: str(s.dropped_line_id),
    transferred_real_kills: num(s.transferred_real_kills),
    filled_by_pick_id: strOrNull(s.filled_by_pick_id),
  };
}

/**
 * Secrecy: before publish there are no drops and no slots, whatever the raw
 * payload says; afterwards only the viewer's own slots are listed, plus
 * `admin_slots` (every slot, with ids) for a pool admin viewer only.
 */
function toRedraft(
  v: unknown,
  allSlots: readonly RawRedraftSlot[],
  viewerId: string | null,
  isPoolAdmin: boolean,
): DraftSnapshotRedraft | null {
  if (!isRecord(v)) return null;
  const publishedAt = strOrNull(v.published_at);
  const published = publishedAt !== null;
  const redraft: DraftSnapshotRedraft = {
    phase: oneOf(v.phase, REDRAFT_PHASES, 'submissions'),
    deadline_at: strOrNull(v.deadline_at),
    published_at: publishedAt,
    drops: published
      ? list(v.drops).map((d) => {
          const drop = rec(d);
          return {
            player_id: str(drop.player_id),
            line_id: str(drop.line_id),
            transferred_real_kills: num(drop.transferred_real_kills),
          };
        })
      : null,
    viewer_slots:
      published && viewerId !== null
        ? allSlots
            .filter((s) => s.player_id === viewerId)
            .map((s) => ({
              redraft_slot_id: s.redraft_slot_id,
              label: s.label,
              dropped_line_id: s.dropped_line_id,
              transferred_real_kills: s.transferred_real_kills,
              filled_by_pick_id: s.filled_by_pick_id,
            }))
        : [],
  };
  if (published && isPoolAdmin) {
    redraft.admin_slots = allSlots.map((s) => ({
      redraft_slot_id: s.redraft_slot_id,
      player_id: s.player_id,
      label: s.label,
      dropped_line_id: s.dropped_line_id,
      transferred_real_kills: s.transferred_real_kills,
      filled_by_pick_id: s.filled_by_pick_id,
    }));
  }
  return redraft;
}

/** Raw `draft_snapshot` output → `DraftSnapshotDTO` (allowlist) + the viewer block. */
export function toDraftSnapshotDTO(raw: unknown, viewer: ViewerContext | null): DraftSnapshotDTO {
  if (!isRecord(raw) || !isRecord(raw.pool) || typeof raw.state_version !== 'number') {
    throw new Error('draft_snapshot returned an unexpected payload');
  }
  const pool = raw.pool;
  const config = rec(raw.config);
  const viewerId = viewer?.playerId ?? null;

  const participants = list(raw.participants).map(toParticipant);
  const activeSlot = toActiveSlot(raw.active_slot);
  const prices = numberRecord(raw.prices);
  const taken = stringRecord(raw.taken);
  const restrictions = list(raw.restrictions).flatMap((r) => {
    const row = rec(r);
    const reason = oneOfOrNull(row.reason, RESTRICTION_REASONS);
    return reason ? [{ player_id: str(row.player_id), line_id: str(row.line_id), reason }] : [];
  });
  const noRedraftLineIds = new Set(list(raw.no_redraft_line_ids).filter((x): x is string => typeof x === 'string'));
  const rawRedraft = rec(raw.redraft);
  const published = strOrNull(rawRedraft.published_at) !== null;
  const allSlots = published ? list(rawRedraft.all_slots).map(toRawRedraftSlot) : [];

  const kind = oneOf(pool.kind, KINDS, 'initial');
  const phase = oneOf(pool.phase, PHASES, 'setup');
  const paused = bool(pool.paused);
  const pauseReason = oneOfOrNull(pool.pause_reason, PAUSE_REASONS);
  const current = activeSlot
    ? { slot_id: activeSlot.slot_id, player_id: activeSlot.player_id, status: activeSlot.status }
    : null;

  const evaluatorFor = (playerId: string | null): ReturnType<typeof buildDraftabilityEvaluator> => {
    const me = playerId === null ? undefined : participants.find((p) => p.player_id === playerId);
    const input: DraftabilityInput = {
      kind,
      phase,
      paused,
      pauseReason,
      lockNoRedraftLines: bool(config.redraft_lock_no_redraft_lines),
      playerId,
      isParticipant: me !== undefined,
      current,
      me: me
        ? {
            budget_remaining: me.budget_remaining,
            open_slots: me.open_slots,
            slots_total: me.slots_total,
            open_redraft_slots: allSlots.filter((s) => s.player_id === me.player_id && s.filled_by_pick_id === null).length,
          }
        : null,
      prices,
      taken,
      restrictions,
      noRedraftLineIds,
    };
    return buildDraftabilityEvaluator(input);
  };

  const own = evaluatorFor(viewerId);
  let activePlayerLineStatus: Record<LineId, ReasonDTO> | undefined;
  if (viewer?.isPoolAdmin && current) {
    activePlayerLineStatus = current.player_id === viewerId ? own.allLineStatus() : evaluatorFor(current.player_id).allLineStatus();
  }

  const extensionSeconds = list(config.extension_seconds);
  const dto: DraftSnapshotDTO = {
    state_version: raw.state_version,
    server_now: str(raw.server_now),
    pool: {
      id: str(pool.id),
      season_id: str(pool.season_id),
      kind,
      mode: oneOf(pool.mode, MODES, 'live'),
      status: oneOf(pool.status, STATUSES, 'pending'),
      paused,
      paused_at: strOrNull(pool.paused_at),
      roster_size: num(pool.roster_size),
      budget: num(pool.budget),
      started_at: strOrNull(pool.started_at),
      ended_at: strOrNull(pool.ended_at),
      phase,
      pause_reason: pauseReason,
      list_version_id: str(pool.list_version_id),
      league_time_zone: LEAGUE_TIME_ZONE,
    },
    config: {
      pick_seconds: num(config.pick_seconds),
      makeup_seconds: num(config.makeup_seconds),
      slow_ladder_seconds: list(config.slow_ladder_seconds).filter((x): x is number => typeof x === 'number'),
      extension_seconds:
        extensionSeconds.length === 2 && typeof extensionSeconds[0] === 'number' && typeof extensionSeconds[1] === 'number'
          ? [extensionSeconds[0], extensionSeconds[1]]
          : null,
      redraft_max_lines: numOrNull(config.redraft_max_lines),
    },
    participants,
    active_slot: activeSlot,
    upcoming: list(raw.upcoming).map(toUpcoming),
    picks: list(raw.picks).map(toPick),
    taken,
    redraft: toRedraft(raw.redraft, allSlots, viewerId, viewer?.isPoolAdmin === true),
    recent_events: list(raw.recent_events).flatMap((e) => {
      const event = toRecentEvent(e);
      return event ? [event] : [];
    }),
    viewer: {
      player_id: viewerId,
      is_participant: viewerId !== null && participants.some((p) => p.player_id === viewerId),
      is_pool_admin: viewer?.isPoolAdmin ?? false,
      pick_block: own.pickBlock,
      line_status: own.allLineStatus(),
      restricted_line_ids:
        viewerId === null ? [] : restrictions.filter((r) => r.player_id === viewerId).map((r) => r.line_id),
    },
  };
  if (activePlayerLineStatus) dto.viewer.active_player_line_status = activePlayerLineStatus;
  return dto;
}

/**
 * The draft snapshot for one viewer: one `draft_snapshot` RPC. Route handlers keep the
 * default `tick: true` and expire the draft reads when `publishedNow`; page seeds pass
 * `{ tick: false }` (critique B9). With `since` equal to the current `state_version` the
 * RPC answers `unchanged`.
 */
export async function getDraftSnapshot(
  poolId: string,
  viewer: ViewerContext | null,
  opts: { since?: number; tick?: boolean } = {},
): Promise<DraftSnapshotResult> {
  const tick = opts.tick ?? true;
  const raw = await callDraftRpc<unknown>('draft_snapshot', {
    p_pool_id: poolId,
    p_since: opts.since ?? null,
    p_tick: tick,
  });
  const body = rec(raw);
  const publishedNow = tick && bool(body.published_now);
  const timeoutsResolved = tick ? nonNegativeCount(body.timeouts_resolved) : 0;

  if (body.unchanged === true) {
    return {
      dto: { unchanged: true, state_version: num(body.state_version), server_now: str(body.server_now) },
      publishedNow,
      timeoutsResolved,
      seasonId: null,
    };
  }
  const dto = toDraftSnapshotDTO(raw, viewer);
  return { dto, publishedNow, timeoutsResolved, seasonId: dto.pool.season_id };
}

/** A tick count from the RPC; anything but a finite positive number is 0. */
function nonNegativeCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * Raw `draft_my_turn` output → `MyTurnDTO` (allowlist; `published_now` and `timeouts_resolved` are returned
 * beside it, never inside).
 */
export function toMyTurnDTO(raw: unknown): { dto: MyTurnDTO; publishedNow: boolean; timeoutsResolved: number } {
  const r = rec(raw);
  return {
    dto: {
      state_version: num(r.state_version),
      server_now: str(r.server_now),
      status: oneOf(r.status, STATUSES, 'pending'),
      mode: oneOf(r.mode, MODES, 'live'),
      paused: bool(r.paused),
      on_clock: bool(r.on_clock),
      up_next: bool(r.up_next),
      slot_id: strOrNull(r.slot_id),
      deadline_at: strOrNull(r.deadline_at),
      remaining_ms_at_pause: numOrNull(r.remaining_ms_at_pause),
      league_name: str(r.league_name),
    },
    publishedNow: bool(r.published_now),
    timeoutsResolved: nonNegativeCount(r.timeouts_resolved),
  };
}
