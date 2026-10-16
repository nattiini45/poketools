/**
 * The `/draft-preview` in-memory draft backend (draft-frontend §11.1, DF3).
 * Implements the pick screen's `DraftDataSource` port, the redraft and token
 * sources of §6.1/§6.2 and the admin panel's `AdminDraftActions` (§7.1) over
 * one mutable snapshot. **No network, no Supabase**: every method answers
 * from memory after a short fake latency; every admin write bumps
 * `state_version` like the server does.
 *
 * Client-safe: plain functions and types, no React, no `@pkmn/*`. The pure
 * helpers (`withViewerVerdicts`, `advanceSlot`) are shared with the server
 * fixture builder (`fixtures.ts`), so a scenario's first paint and the state
 * after a fake pick follow the same rules.
 *
 * The verdicts mirror the server's draftability rules closely enough for a
 * visual preview (taken, budget, feasibility, restricted, roster full); they
 * are not the engine. Dev-only (allowlisted for `check-i18n-strings`).
 */
import {
  DraftDataSourceError,
  type ApiCall,
  type DraftDataSource,
  type ExtensionResult,
  type MyTurnResult,
  type PickRequest,
  type PickResult,
  type SnapshotResult,
} from '@/components/draft-tool/data-source';
import type { AdminDraftActions, AuditPage, AuditQuery, StateVersion } from '@/components/draft-admin/admin-actions';
import type { RedraftSource } from '@/components/draft-redraft/redraft-source';
import type { TokenSource } from '@/components/draft-tokens/token-source';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { DRAFT_AUDIT_ACTIONS, type DraftAuditAction } from '@/types/draft-queue';
import type { DraftSearchIndex } from '@/lib/draft-finder/index-types';
import type {
  AdminSubmissionDTO,
  AuditEntryDTO,
  DraftActiveSlot,
  DraftRecentEvent,
  DraftSnapshotDTO,
  DraftSnapshotParticipant,
  DraftSnapshotPick,
  DraftUpcomingSlot,
  ExtensionKind,
  LineId,
  MyTurnDTO,
  ReasonDTO,
  RedraftSubmissionDTO,
  TokenOverviewDTO,
} from '@/lib/draft-ui/snapshot-types';

/** The price facts of one list line the fake needs (from `fixture-lines.example.json`). */
export interface FakeLine {
  lineId: LineId;
  entryId: string;
  price: number;
}

/** Everything a scenario hands the fake (all JSON-serialisable: it crosses the server → client boundary). */
export interface FakeSourceInit {
  snapshot: DraftSnapshotDTO | null;
  lines: FakeLine[];
  /** The full remaining slot order after `active_slot`; the snapshot shows the first `UPCOMING_SHOWN`. */
  queue: DraftUpcomingSlot[];
  index?: DraftSearchIndex;
  favorites?: LineId[];
  /** `fetchSnapshot` answers 401 (spectator fallback) instead of a snapshot. */
  authFails?: boolean;
  redraftSubmission?: RedraftSubmissionDTO | null;
  tokens?: TokenOverviewDTO | null;
  /** Every player's redraft submission as an admin reads it (BE #20). */
  adminSubmissions?: AdminSubmissionDTO[];
  /** The pool's audit trail, newest first (BE #15). */
  audit?: AuditEntryDTO[];
  /** Fake round trip, default 150 ms. */
  latencyMs?: number;
}

/** Pick screen + redraft (§6.1) + tokens (§6.2) + admin writes (§7.1): one fake per pool. */
export type FakeDataSource = DraftDataSource<DraftSearchIndex> & RedraftSource & TokenSource & AdminDraftActions;

export const UPCOMING_SHOWN = 10;
const FAVORITES_MAX = 30;

// ── pure rules (shared with fixtures.ts) ───────────────────────────────────

function participantOf(dto: DraftSnapshotDTO, playerId: string | null): DraftSnapshotParticipant | undefined {
  return playerId === null ? undefined : dto.participants.find((p) => p.player_id === playerId);
}

/** The line-level verdicts for one player: only non-draftable lines are listed (as the server does). */
export function lineVerdictsFor(
  dto: DraftSnapshotDTO,
  lines: readonly FakeLine[],
  playerId: string | null,
  restricted: readonly LineId[] = [],
): Record<LineId, ReasonDTO> {
  const out: Record<LineId, ReasonDTO> = {};
  const me = participantOf(dto, playerId);
  const free = lines.filter((l) => dto.taken[l.lineId] === undefined);
  const restrictedSet = new Set(restricted);
  for (const line of lines) {
    const owner = dto.taken[line.lineId];
    if (owner !== undefined) {
      out[line.lineId] = { code: 'LINE_TAKEN', params: { player_id: owner } };
      continue;
    }
    if (restrictedSet.has(line.lineId)) {
      out[line.lineId] = { code: dto.pool.kind === 'redraft' ? 'OWN_REDRAFT_DROP' : 'LINE_RESTRICTED' };
      continue;
    }
    if (!me || me.done) continue;
    if (line.price > me.budget_remaining) {
      out[line.lineId] = { code: 'INSUFFICIENT_BUDGET', params: { price: line.price, remaining: me.budget_remaining } };
      continue;
    }
    const slotsAfter = me.open_slots - 1;
    if (slotsAfter <= 0) continue;
    const others = free.filter((l) => l.lineId !== line.lineId).map((l) => l.price).sort((a, b) => a - b);
    if (others.length < slotsAfter) {
      out[line.lineId] = { code: 'NOT_ENOUGH_LINES', params: { slots: slotsAfter, available: others.length } };
      continue;
    }
    const cheapest = others.slice(0, slotsAfter).reduce((sum, p) => sum + p, 0);
    const left = me.budget_remaining - line.price;
    if (left < cheapest) {
      out[line.lineId] = { code: 'BUDGET_INFEASIBLE', params: { shortfall: cheapest - left, slots: slotsAfter } };
    }
  }
  return out;
}

/** The viewer-level block (null = the viewer may pick now). */
export function viewerPickBlock(dto: DraftSnapshotDTO): ReasonDTO | null {
  const viewerId = dto.viewer.player_id;
  if (viewerId === null) return { code: 'SIGNED_OUT' };
  const me = participantOf(dto, viewerId);
  if (!me) return { code: 'NOT_PARTICIPANT' };
  if (dto.pool.phase === 'submissions') return { code: 'SUBMISSION_PHASE' };
  if (dto.pool.status === 'pending') return { code: 'DRAFT_NOT_STARTED' };
  if (dto.pool.status === 'complete') return { code: 'DRAFT_COMPLETE' };
  if (me.done) return { code: 'ROSTER_FULL', params: { size: me.slots_total } };
  if (dto.pool.paused) return { code: 'DRAFT_PAUSED', params: { reason: dto.pool.pause_reason ?? 'admin' } };
  const slot = dto.active_slot;
  if (!slot || slot.player_id !== viewerId) return { code: 'NOT_YOUR_TURN' };
  if (slot.status === 'blocked') return { code: 'SLOT_BLOCKED' };
  if (dto.redraft && dto.redraft.viewer_slots.every((s) => s.filled_by_pick_id !== null)) return { code: 'NO_OPEN_REDRAFT_SLOT' };
  return null;
}

/** Recomputes `viewer.pick_block`, `line_status` and (admins) `active_player_line_status`. */
export function withViewerVerdicts(dto: DraftSnapshotDTO, lines: readonly FakeLine[]): DraftSnapshotDTO {
  const restricted = dto.viewer.restricted_line_ids;
  const viewer = {
    ...dto.viewer,
    pick_block: viewerPickBlock(dto),
    line_status: lineVerdictsFor(dto, lines, dto.viewer.player_id, restricted),
  };
  if (dto.viewer.is_pool_admin && dto.active_slot) {
    viewer.active_player_line_status = lineVerdictsFor(dto, lines, dto.active_slot.player_id);
  } else {
    delete viewer.active_player_line_status;
  }
  return { ...dto, viewer };
}

/** Moves the clock to the next queued slot (or completes the pool when the queue is empty). */
export function advanceSlot(dto: DraftSnapshotDTO, queue: DraftUpcomingSlot[], nowMs: number): { dto: DraftSnapshotDTO; queue: DraftUpcomingSlot[] } {
  const open = queue.filter((s) => !participantOf(dto, s.player_id)?.done);
  const [next, ...rest] = open;
  if (!next) {
    const iso = new Date(nowMs).toISOString();
    return {
      dto: { ...dto, active_slot: null, upcoming: [], pool: { ...dto.pool, status: 'complete', phase: 'complete', ended_at: iso } },
      queue: [],
    };
  }
  const active: DraftActiveSlot = {
    slot_id: next.slot_id,
    player_id: next.player_id,
    round: next.round,
    pick_number: next.pick_number,
    kind: next.kind,
    status: 'active',
    duration_ms: next.duration_ms,
    extensions_applied_ms: 0,
    started_at: new Date(nowMs).toISOString(),
    deadline_at: new Date(nowMs + next.duration_ms).toISOString(),
    remaining_ms_at_pause: null,
  };
  return { dto: { ...dto, active_slot: active, upcoming: rest.slice(0, UPCOMING_SHOWN) }, queue: rest };
}

/** The snapshot after `picker` takes `line` on `slot` (before the clock advances). Shared by picks and admin "assign". */
export function recordPick(
  dto: DraftSnapshotDTO,
  slot: DraftActiveSlot,
  picker: DraftSnapshotParticipant,
  line: FakeLine,
  o: { admin: boolean; redraftSlotId: string | null; pickId: string; madeAt: string },
): DraftSnapshotDTO {
  const event: DraftRecentEvent = {
    at: o.madeAt,
    action: o.admin ? 'pick_admin_override' : 'pick_confirmed',
    actor_role: o.admin ? 'admin' : 'player',
    player_id: picker.player_id,
    line_id: line.lineId,
    slot_id: slot.slot_id,
  };
  const participants = dto.participants.map((p) => {
    if (p.player_id !== picker.player_id) return p;
    const openSlots = Math.max(0, p.open_slots - 1);
    return { ...p, picks_made: p.picks_made + 1, open_slots: openSlots, budget_remaining: p.budget_remaining - line.price, done: openSlots === 0 };
  });
  const fill = <T extends { redraft_slot_id: string; filled_by_pick_id: string | null }>(s: T): T =>
    s.redraft_slot_id === o.redraftSlotId ? { ...s, filled_by_pick_id: o.pickId } : s;
  const redraft = dto.redraft
    ? {
        ...dto.redraft,
        viewer_slots: dto.redraft.viewer_slots.map(fill),
        ...(dto.redraft.admin_slots ? { admin_slots: dto.redraft.admin_slots.map(fill) } : {}),
      }
    : null;
  const pick: DraftSnapshotPick = {
    pick_id: o.pickId,
    slot_id: slot.slot_id,
    pick_number: slot.pick_number,
    round: slot.round,
    player_id: picker.player_id,
    line_id: line.lineId,
    entry_id: line.entryId,
    price: line.price,
    made_at: o.madeAt,
    admin_override: o.admin,
    redraft_slot_id: o.redraftSlotId,
  };
  return {
    ...dto,
    participants,
    redraft,
    picks: [...dto.picks, pick],
    taken: { ...dto.taken, [line.lineId]: picker.player_id },
    recent_events: [event, ...dto.recent_events].slice(0, 12),
  };
}

// ── the source ─────────────────────────────────────────────────────────────

function fail(code: string, params?: Record<string, string | number>): ApiErrorLike {
  return params ? { code, params } : { code };
}

/**
 * One fake per mounted preview. State lives in this closure: a reload restarts the scenario.
 */
export function createFakeDataSource(init: FakeSourceInit): FakeDataSource {
  const latency = init.latencyMs ?? 150;
  const priceOf = new Map(init.lines.map((l) => [l.lineId, l]));
  let dto = init.snapshot ? withViewerVerdicts(init.snapshot, init.lines) : null;
  let queue = [...init.queue];
  let favorites = [...(init.favorites ?? [])];
  let submission = init.redraftSubmission ?? null;
  let tokens = init.tokens ?? null;
  const replays = new Map<string, PickResult>();
  let adminSubmissions = [...(init.adminSubmissions ?? [])];
  const audit = [...(init.audit ?? [])];

  const wait = <T>(value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), latency));
  const now = (): number => Date.now();
  const stamp = (next: DraftSnapshotDTO): DraftSnapshotDTO =>
    withViewerVerdicts({ ...next, state_version: next.state_version + 1, server_now: new Date(now()).toISOString() }, init.lines);

  function refusal<T>(error: ApiErrorLike): Promise<ApiCall<T>> {
    return wait<ApiCall<T>>(dto ? { ok: false, error, snapshot: dto } : { ok: false, error });
  }

  /** An admin write: applies `change` (or refuses with its error) and bumps `state_version`. */
  function write(change: (current: DraftSnapshotDTO) => DraftSnapshotDTO | ApiErrorLike): Promise<ApiCall<StateVersion>> {
    if (!dto) return refusal(fail('POOL_NOT_FOUND'));
    const next = change(dto);
    if (!('pool' in next)) return refusal(next);
    dto = stamp(next);
    return wait<ApiCall<StateVersion>>({ ok: true, data: { state_version: dto.state_version } });
  }

  /** Corrections need a paused pool (the panel enables them only then). */
  function pickOf(current: DraftSnapshotDTO, pickId: string): DraftSnapshotPick | ApiErrorLike {
    if (!current.pool.paused) return fail('CORRECTION_REQUIRES_PAUSE');
    return current.picks.find((p) => p.pick_id === pickId) ?? fail('PICK_NOT_FOUND');
  }

  /** `picks` = picks added (negative: removed); open slots and `done` follow. */
  function withBudget(current: DraftSnapshotDTO, playerId: string, delta: number, picks: number): DraftSnapshotParticipant[] {
    return current.participants.map((p) => {
      if (p.player_id !== playerId) return p;
      const openSlots = Math.max(0, p.open_slots - picks);
      return {
        ...p,
        budget_remaining: p.budget_remaining + delta,
        picks_made: p.picks_made + picks,
        open_slots: openSlots,
        done: openSlots === 0,
      };
    });
  }

  return {
    // ── pick screen ────────────────────────────────────────────────────
    fetchSnapshot(since, signal): Promise<SnapshotResult> {
      void signal;
      if (init.authFails) return wait<SnapshotResult>({ kind: 'auth' });
      if (!dto) return wait<SnapshotResult>({ kind: 'error', error: fail('POOL_NOT_FOUND') });
      const serverNow = new Date(now()).toISOString();
      if (since !== null && since === dto.state_version) {
        return wait<SnapshotResult>({ kind: 'unchanged', version: dto.state_version, serverNow });
      }
      return wait<SnapshotResult>({ kind: 'full', dto: { ...dto, server_now: serverNow } });
    },

    fetchMyTurn(signal): Promise<MyTurnResult> {
      void signal;
      // Mirrors the HTTP source: 401/403 and an unknown pool (404) end the watch.
      if (init.authFails || !dto) return wait<MyTurnResult>({ kind: 'stop' });
      const slot = dto.active_slot;
      const viewerId = dto.viewer.player_id;
      const turn: MyTurnDTO = {
        state_version: dto.state_version,
        server_now: new Date(now()).toISOString(),
        status: dto.pool.status,
        mode: dto.pool.mode,
        paused: dto.pool.paused,
        on_clock: slot !== null && slot.player_id === viewerId,
        up_next: dto.upcoming[0]?.player_id === viewerId,
        slot_id: slot?.slot_id ?? null,
        deadline_at: slot?.deadline_at ?? null,
        remaining_ms_at_pause: slot?.remaining_ms_at_pause ?? null,
        // i18n-ignore: fixture league name (data, not UI copy)
        league_name: 'EvoLiga Preview',
      };
      return wait<MyTurnResult>({ kind: 'ok', dto: turn });
    },

    fetchIndex(url): Promise<DraftSearchIndex> {
      void url;
      if (init.index) return wait(init.index);
      return Promise.reject(new DraftDataSourceError(fail('network_error'), null));
    },

    getFavorites(): Promise<LineId[]> {
      return wait([...favorites]);
    },

    setFavorite(lineId, on): Promise<ApiCall<LineId[]>> {
      if (on && !favorites.includes(lineId)) {
        if (favorites.length >= FAVORITES_MAX) return refusal(fail('FAVORITES_LIMIT', { max: FAVORITES_MAX }));
        favorites = [...favorites, lineId];
      } else if (!on) {
        favorites = favorites.filter((id) => id !== lineId);
      }
      return wait<ApiCall<LineId[]>>({ ok: true, data: [...favorites] });
    },

    postPick(body: PickRequest): Promise<ApiCall<PickResult>> {
      const replay = replays.get(body.client_request_id);
      if (replay) return wait<ApiCall<PickResult>>({ ok: true, data: { ...replay, replay: true } });
      if (!dto) return refusal(fail('POOL_NOT_FOUND'));
      const slot = dto.active_slot;
      if (dto.pool.status === 'complete') return refusal(fail('DRAFT_COMPLETE'));
      if (dto.pool.paused) return refusal(fail('DRAFT_PAUSED'));
      if (!slot || slot.slot_id !== body.slot_id) return refusal(fail('STALE_SLOT'));
      if (slot.status === 'blocked') return refusal(fail('SLOT_BLOCKED'));
      const actorIsAdmin = dto.viewer.is_pool_admin && body.on_behalf_of !== undefined;
      if (!actorIsAdmin && slot.player_id !== dto.viewer.player_id) return refusal(fail('NOT_YOUR_TURN'));
      if (actorIsAdmin && (body.override_reason ?? '').trim().length < 3) return refusal(fail('OVERRIDE_REASON_REQUIRED'));
      const line = priceOf.get(body.line_id);
      if (!line) return refusal(fail('NOT_IN_LIST'));
      if (dto.taken[body.line_id] !== undefined) return refusal(fail('LINE_TAKEN'));
      const picker = participantOf(dto, slot.player_id);
      if (!picker) return refusal(fail('NOT_PARTICIPANT'));
      if (line.price > picker.budget_remaining) {
        return refusal(fail('INSUFFICIENT_BUDGET', { price: line.price, remaining: picker.budget_remaining }));
      }
      let redraftSlotId: string | null = null;
      if (dto.redraft && !actorIsAdmin) {
        const openSlots = dto.redraft.viewer_slots.filter((s) => s.filled_by_pick_id === null);
        const chosen = body.redraft_slot_id ?? (openSlots.length === 1 ? openSlots[0].redraft_slot_id : undefined);
        if (!chosen) return refusal(fail('REDRAFT_SLOT_REQUIRED'));
        if (!openSlots.some((s) => s.redraft_slot_id === chosen)) return refusal(fail('REDRAFT_SLOT_FILLED'));
        redraftSlotId = chosen;
      }

      const picked = recordPick(dto, slot, picker, line, {
        admin: actorIsAdmin,
        redraftSlotId,
        pickId: `preview-pick-${slot.pick_number}-${body.client_request_id.slice(0, 8)}`,
        madeAt: new Date(now()).toISOString(),
      });
      const advanced = advanceSlot(picked, queue, now());
      queue = advanced.queue;
      dto = stamp(advanced.dto);
      const result: PickResult = { state_version: dto.state_version, replay: false, snapshot: dto };
      replays.set(body.client_request_id, result);
      return wait<ApiCall<PickResult>>({ ok: true, data: result });
    },

    postExtension(kind: ExtensionKind, slotId: string): Promise<ApiCall<ExtensionResult>> {
      if (!dto) return refusal(fail('POOL_NOT_FOUND'));
      const slot = dto.active_slot;
      if (!slot || slot.slot_id !== slotId || slot.deadline_at === null) return refusal(fail('STALE_SLOT'));
      const extensionSeconds = dto.config.extension_seconds;
      if (dto.pool.mode !== 'live' || extensionSeconds === null) return refusal(fail('EXTENSION_NOT_ALLOWED'));
      const me = participantOf(dto, slot.player_id);
      if (!me || slot.player_id !== dto.viewer.player_id) return refusal(fail('NOT_YOUR_TURN'));
      const used = kind === 'plus120' ? me.extensions.plus120_used : me.extensions.plus60_used;
      if (used) return refusal(fail('EXTENSION_USED'));
      const addMs = (kind === 'plus120' ? extensionSeconds[0] : extensionSeconds[1]) * 1000;
      const deadline = new Date(Date.parse(slot.deadline_at) + addMs).toISOString();
      dto = stamp({
        ...dto,
        active_slot: { ...slot, deadline_at: deadline, extensions_applied_ms: slot.extensions_applied_ms + addMs },
        participants: dto.participants.map((p) =>
          p.player_id === me.player_id
            ? { ...p, extensions: { ...p.extensions, [kind === 'plus120' ? 'plus120_used' : 'plus60_used']: true } }
            : p,
        ),
      });
      return wait<ApiCall<ExtensionResult>>({ ok: true, data: { deadline_at: deadline, state_version: dto.state_version } });
    },

    // ── redraft submission (§6.1) ──────────────────────────────────────
    getSubmission(): Promise<ApiCall<RedraftSubmissionDTO>> {
      if (!submission) return wait<ApiCall<RedraftSubmissionDTO>>({ ok: false, error: fail('NOT_PARTICIPANT') });
      return wait<ApiCall<RedraftSubmissionDTO>>({ ok: true, data: submission });
    },

    putSubmission(lineIds: LineId[]): Promise<ApiCall<RedraftSubmissionDTO>> {
      const current = submission;
      if (!current) return wait<ApiCall<RedraftSubmissionDTO>>({ ok: false, error: fail('NOT_PARTICIPANT') });
      if (current.locked || Date.parse(current.deadline_at) <= now()) {
        return wait<ApiCall<RedraftSubmissionDTO>>({ ok: false, error: fail('SUBMISSION_LOCKED') });
      }
      const unique = [...new Set(lineIds)];
      if (unique.length > current.max) {
        return wait<ApiCall<RedraftSubmissionDTO>>({ ok: false, error: fail('REDRAFT_MAX_EXCEEDED', { max: current.max }) });
      }
      const own = new Map(current.own_lines.map((l) => [l.line_id, l]));
      if (unique.some((id) => !own.get(id)?.droppable)) {
        return wait<ApiCall<RedraftSubmissionDTO>>({ ok: false, error: fail('LINE_NOT_DROPPABLE') });
      }
      submission = { ...current, line_ids: unique, updated_at: new Date(now()).toISOString() };
      return wait<ApiCall<RedraftSubmissionDTO>>({ ok: true, data: submission });
    },

    // ── tokens (§6.2) ──────────────────────────────────────────────────
    overview(playerId?: string): Promise<ApiCall<TokenOverviewDTO>> {
      void playerId;
      if (!tokens) return wait<ApiCall<TokenOverviewDTO>>({ ok: false, error: fail('NOT_PARTICIPANT') });
      return wait<ApiCall<TokenOverviewDTO>>({ ok: true, data: tokens });
    },

    /**
     * The batched admin read (BE #25b): one call for every participant, so the
     * preview exercises `TokenAdminSummary`'s batched path. Every participant
     * gets the fixture overview under their own id; no fixture → no rows.
     */
    overviewAll(): Promise<ApiCall<TokenOverviewDTO[]>> {
      const current = tokens;
      if (!current) return wait<ApiCall<TokenOverviewDTO[]>>({ ok: true, data: [] });
      const ids = dto ? dto.participants.map((p) => p.player_id) : [current.player_id];
      return wait<ApiCall<TokenOverviewDTO[]>>({ ok: true, data: ids.map((player_id) => ({ ...current, player_id })) });
    },

    buyDraftKill(lineId: LineId, requestId: string): Promise<ApiCall<TokenOverviewDTO>> {
      void requestId;
      const current = tokens;
      if (!current) return wait<ApiCall<TokenOverviewDTO>>({ ok: false, error: fail('NOT_PARTICIPANT') });
      const dk = current.draft_kill;
      const row = dk.lines.find((l) => l.line_id === lineId);
      if (dk.window !== 'open') return wait<ApiCall<TokenOverviewDTO>>({ ok: false, error: fail('TOKEN_WINDOW_CLOSED') });
      if (dk.owned >= dk.max) return wait<ApiCall<TokenOverviewDTO>>({ ok: false, error: fail('TOKEN_PLAYER_LIMIT', { max: dk.max }) });
      if (!row || !row.eligible) {
        return wait<ApiCall<TokenOverviewDTO>>({ ok: false, error: fail(row?.reason ?? 'TOKEN_LINE_LIMIT') });
      }
      if (dk.unspent_points < dk.cost) {
        return wait<ApiCall<TokenOverviewDTO>>({
          ok: false,
          error: fail('TOKEN_POINTS_SHORT', { needed: dk.cost, remaining: dk.unspent_points }),
        });
      }
      tokens = {
        ...current,
        draft_kill: {
          ...dk,
          owned: dk.owned + 1,
          unspent_points: dk.unspent_points - dk.cost,
          lines: dk.lines.map((l) =>
            l.line_id === lineId ? { ...l, has_token: true, progress: l.progress + 1, eligible: false, reason: 'TOKEN_LINE_LIMIT' } : l,
          ),
        },
        lines: current.lines.map((l) =>
          l.line_id === lineId
            ? { ...l, draft_token_progress: l.draft_token_progress + 1, total_progress: l.total_progress + 1 }
            : l,
        ),
      };
      return wait<ApiCall<TokenOverviewDTO>>({ ok: true, data: tokens });
    },

    spendComeback(allocs, requestId): Promise<ApiCall<TokenOverviewDTO>> {
      void requestId;
      const current = tokens;
      if (!current) return wait<ApiCall<TokenOverviewDTO>>({ ok: false, error: fail('NOT_PARTICIPANT') });
      if (!current.comeback.spend_open) return wait<ApiCall<TokenOverviewDTO>>({ ok: false, error: fail('COMEBACK_NOT_YET') });
      const total = allocs.reduce((sum, a) => sum + Math.max(0, a.tokens), 0);
      if (total > current.comeback.unspent) {
        return wait<ApiCall<TokenOverviewDTO>>({
          ok: false,
          error: fail('COMEBACK_BALANCE_SHORT', { balance: current.comeback.unspent }),
        });
      }
      const add = new Map(allocs.map((a) => [a.line_id, Math.max(0, a.tokens)]));
      tokens = {
        ...current,
        comeback: { ...current.comeback, spent: current.comeback.spent + total, unspent: current.comeback.unspent - total },
        lines: current.lines.map((l) => {
          const n = add.get(l.line_id) ?? 0;
          return n === 0
            ? l
            : { ...l, comeback_token_progress: l.comeback_token_progress + n, total_progress: l.total_progress + n };
        }),
      };
      return wait<ApiCall<TokenOverviewDTO>>({ ok: true, data: tokens });
    },
    // ── admin panel (§7.1, `AdminDraftActions`) ────────────────────────
    createRedraft(force): Promise<ApiCall<{ pool_id: string }>> {
      void force;
      if (!dto) return refusal(fail('POOL_NOT_FOUND'));
      // The preview season already has its Redraft (the admin-panel scenario shows it in its own tab).
      return refusal(fail(dto.pool.status === 'complete' ? 'POOL_EXISTS' : 'INITIAL_DRAFT_NOT_COMPLETE'));
    },

    saveConfig(input) {
      return write((d) => ({
        ...d,
        pool: {
          ...d.pool,
          mode: input.mode ?? d.pool.mode,
          roster_size: input.roster_size ?? d.pool.roster_size,
          budget: input.budget ?? d.pool.budget,
        },
        config: {
          ...d.config,
          pick_seconds: input.pick_seconds ?? d.config.pick_seconds,
          makeup_seconds: input.makeup_seconds ?? d.config.makeup_seconds,
          slow_ladder_seconds: input.slow_ladder_seconds ?? d.config.slow_ladder_seconds,
          redraft_max_lines: input.redraft_max_lines !== undefined ? input.redraft_max_lines : d.config.redraft_max_lines,
        },
      }));
    },

    patchRedraft(body) {
      return write((d) => {
        if (!d.redraft) return fail('POOL_NOT_FOUND');
        if (d.redraft.phase !== 'submissions') return fail('SUBMISSION_LOCKED');
        return {
          ...d,
          redraft: { ...d.redraft, deadline_at: body.deadline_at ?? d.redraft.deadline_at },
          config: { ...d.config, redraft_max_lines: body.redraft_max_lines ?? d.config.redraft_max_lines },
        };
      });
    },

    start() {
      return write((d) => {
        if (d.pool.status !== 'pending' || d.pool.phase === 'submissions') return fail('DRAFT_ALREADY_STARTED');
        const started: DraftSnapshotDTO = {
          ...d,
          pool: { ...d.pool, status: 'in_progress', phase: 'drafting', started_at: new Date(now()).toISOString() },
        };
        const advanced = advanceSlot(started, queue, now());
        queue = advanced.queue;
        return advanced.dto;
      });
    },

    end(reason) {
      void reason;
      return write((d) => {
        if (d.pool.status === 'complete') return fail('DRAFT_COMPLETE');
        queue = [];
        return {
          ...d,
          active_slot: null,
          upcoming: [],
          pool: {
            ...d.pool,
            status: 'complete',
            phase: 'complete',
            paused: false,
            paused_at: null,
            pause_reason: null,
            ended_at: new Date(now()).toISOString(),
          },
        };
      });
    },

    pause(paused, reason) {
      void reason;
      return write((d) => {
        if (d.pool.status !== 'in_progress') return fail('DRAFT_NOT_ACTIVE');
        if (paused === d.pool.paused) return fail(paused ? 'ALREADY_PAUSED' : 'NOT_PAUSED');
        const slot = d.active_slot;
        const t = now();
        if (paused) {
          const left = slot?.deadline_at ? Math.max(0, Date.parse(slot.deadline_at) - t) : (slot?.remaining_ms_at_pause ?? null);
          return {
            ...d,
            pool: { ...d.pool, paused: true, paused_at: new Date(t).toISOString(), pause_reason: 'admin' },
            active_slot: slot ? { ...slot, deadline_at: null, remaining_ms_at_pause: left } : null,
          };
        }
        if (slot?.status === 'blocked') return fail('BLOCKED_SLOT_UNRESOLVED');
        const left = slot?.remaining_ms_at_pause ?? slot?.duration_ms ?? 0;
        return {
          ...d,
          pool: { ...d.pool, paused: false, paused_at: null, pause_reason: null },
          active_slot: slot ? { ...slot, deadline_at: new Date(t + left).toISOString(), remaining_ms_at_pause: null } : null,
        };
      });
    },

    voidPick(pickId, reason, requeue) {
      void reason;
      return write((d) => {
        const pick = pickOf(d, pickId);
        if (!('pick_id' in pick)) return pick;
        const taken = { ...d.taken };
        delete taken[pick.line_id];
        if (requeue) {
          const again: DraftUpcomingSlot = {
            slot_id: `${pick.slot_id}-requeue`,
            player_id: pick.player_id,
            pick_number: pick.pick_number,
            round: pick.round,
            kind: 'makeup',
            duration_ms: d.config.makeup_seconds * 1000,
          };
          queue = [again, ...queue];
        }
        const unfill = <T extends { filled_by_pick_id: string | null }>(s: T): T =>
          s.filled_by_pick_id === pickId ? { ...s, filled_by_pick_id: null } : s;
        return {
          ...d,
          picks: d.picks.filter((p) => p.pick_id !== pickId),
          taken,
          participants: withBudget(d, pick.player_id, pick.price, -1),
          upcoming: queue.slice(0, UPCOMING_SHOWN),
          redraft: d.redraft
            ? {
                ...d.redraft,
                viewer_slots: d.redraft.viewer_slots.map(unfill),
                ...(d.redraft.admin_slots ? { admin_slots: d.redraft.admin_slots.map(unfill) } : {}),
              }
            : null,
        };
      });
    },

    correctPick(pickId, lineId, reason, requestId, redraftSlotId) {
      void reason;
      void requestId;
      void redraftSlotId;
      return write((d) => {
        const pick = pickOf(d, pickId);
        if (!('pick_id' in pick)) return pick;
        const next = priceOf.get(lineId);
        if (!next) return fail('NOT_IN_LIST');
        if (d.taken[lineId] !== undefined) return fail('LINE_TAKEN');
        const delta = pick.price - next.price;
        const owner = participantOf(d, pick.player_id);
        if (!owner || owner.budget_remaining + delta < 0) {
          return fail('INSUFFICIENT_BUDGET', { price: next.price, remaining: (owner?.budget_remaining ?? 0) + pick.price });
        }
        const taken = { ...d.taken, [lineId]: pick.player_id };
        delete taken[pick.line_id];
        return {
          ...d,
          taken,
          participants: withBudget(d, pick.player_id, delta, 0),
          picks: d.picks.map((p) =>
            p.pick_id === pickId ? { ...p, line_id: next.lineId, entry_id: next.entryId, price: next.price } : p,
          ),
        };
      });
    },

    resolveSlot(slotId, input) {
      return write((d) => {
        const slot = d.active_slot;
        if (!slot || slot.slot_id !== slotId || slot.status !== 'blocked') return fail('SLOT_NOT_BLOCKED');
        let next = d;
        if (input.action === 'assign') {
          const line = priceOf.get(input.line_id);
          const picker = participantOf(d, slot.player_id);
          if (!line) return fail('NOT_IN_LIST');
          if (!picker) return fail('NOT_PARTICIPANT');
          if (d.taken[line.lineId] !== undefined) return fail('LINE_TAKEN');
          if (line.price > picker.budget_remaining) {
            return fail('INSUFFICIENT_BUDGET', { price: line.price, remaining: picker.budget_remaining });
          }
          next = recordPick(d, slot, picker, line, {
            admin: true,
            redraftSlotId: input.redraft_slot_id ?? null,
            pickId: `preview-pick-${slot.pick_number}-${input.client_request_id.slice(0, 8)}`,
            madeAt: new Date(now()).toISOString(),
          });
        }
        const pool: DraftSnapshotDTO['pool'] = input.resume
          ? { ...next.pool, paused: false, paused_at: null, pause_reason: null }
          : { ...next.pool, pause_reason: 'admin' };
        const advanced = advanceSlot({ ...next, pool }, queue, now());
        queue = advanced.queue;
        const active = advanced.dto.active_slot;
        // Still paused: the next slot's clock waits for "Resume".
        return input.resume || !active
          ? advanced.dto
          : { ...advanced.dto, active_slot: { ...active, deadline_at: null, remaining_ms_at_pause: active.duration_ms } };
      });
    },

    setPenalty(playerId, stage, reason) {
      void reason;
      return write((d) => {
        if (!participantOf(d, playerId)) return fail('NOT_PARTICIPANT');
        return {
          ...d,
          participants: d.participants.map((p) => (p.player_id === playerId ? { ...p, penalty_stage: stage } : p)),
        };
      });
    },

    submissions(): Promise<ApiCall<AdminSubmissionDTO[]>> {
      return wait<ApiCall<AdminSubmissionDTO[]>>({ ok: true, data: [...adminSubmissions] });
    },

    publishRedraft(input): Promise<ApiCall<StateVersion & { drops: number }>> {
      const current = dto;
      if (!current?.redraft) return refusal(fail('POOL_NOT_FOUND'));
      if (current.redraft.published_at !== null) return refusal(fail('SUBMISSIONS_ALREADY_PUBLISHED'));
      const deadline = current.redraft.deadline_at ? Date.parse(current.redraft.deadline_at) : 0;
      if (!input.force && deadline > now()) return refusal(fail('SUBMISSIONS_NOT_DUE'));
      const drops = adminSubmissions.flatMap((s) =>
        s.line_ids.map((lineId) => ({ player_id: s.player_id, line_id: lineId, transferred_real_kills: 0 })),
      );
      adminSubmissions = [];
      // The publish starts the picking at once (`redraft__publish_locked`).
      const at = new Date(now()).toISOString();
      const advanced = advanceSlot(
        {
          ...current,
          pool: { ...current.pool, phase: 'drafting', status: 'in_progress', started_at: at },
          redraft: { ...current.redraft, phase: 'drafting', published_at: at, drops },
        },
        queue,
        now(),
      );
      queue = advanced.queue;
      dto = stamp(advanced.dto);
      return wait<ApiCall<StateVersion & { drops: number }>>({
        ok: true,
        data: { state_version: dto.state_version, drops: drops.length },
      });
    },

    restoreDrop(redraftSlotId, reason) {
      void reason;
      return write((d) => {
        const slot = d.redraft?.admin_slots?.find((s) => s.redraft_slot_id === redraftSlotId);
        if (!d.redraft || !slot) return fail('REDRAFT_SLOT_INVALID');
        if (slot.filled_by_pick_id !== null) return fail('REDRAFT_SLOT_FILLED');
        return {
          ...d,
          redraft: {
            ...d.redraft,
            drops: (d.redraft.drops ?? []).filter(
              (x) => !(x.player_id === slot.player_id && x.line_id === slot.dropped_line_id),
            ),
            viewer_slots: d.redraft.viewer_slots.filter((s) => s.redraft_slot_id !== redraftSlotId),
            admin_slots: (d.redraft.admin_slots ?? []).filter((s) => s.redraft_slot_id !== redraftSlotId),
          },
          taken: { ...d.taken, [slot.dropped_line_id]: slot.player_id },
        };
      });
    },

    setComebackOpen(open): Promise<ApiCall<{ open: boolean }>> {
      if (tokens) tokens = { ...tokens, comeback: { ...tokens.comeback, spend_open: open } };
      return wait<ApiCall<{ open: boolean }>>({ ok: true, data: { open } });
    },

    audit(query: AuditQuery): Promise<ApiCall<AuditPage>> {
      return wait<ApiCall<AuditPage>>({ ok: true, data: { entries: filterAudit(audit, query), next_cursor: null } });
    },
  };
}

/** The audit rows a query selects (action and player filters; one page, no cursor). */
export function filterAudit(entries: readonly AuditEntryDTO[], query: AuditQuery): AuditEntryDTO[] {
  const actions = query.actions && query.actions.length > 0 ? new Set(query.actions) : null;
  const player = query.player ?? null;
  return entries
    .filter((e) => actions === null || actions.has(e.action))
    .filter((e) => player === null || e.actor.player_id === player)
    .slice(0, query.limit ?? entries.length);
}

/** Parses `auditQueryString` back (the preview's `DraftAuditViewer.loadPage` answers from memory). */
export function auditQueryFrom(query: string): AuditQuery {
  const params = new URLSearchParams(query);
  const known = new Set<string>(DRAFT_AUDIT_ACTIONS);
  const actions = params.getAll('action').filter((a): a is DraftAuditAction => known.has(a));
  const limit = Number(params.get('limit'));
  return {
    actions,
    player: params.get('player'),
    cursor: params.get('cursor'),
    limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
  };
}
