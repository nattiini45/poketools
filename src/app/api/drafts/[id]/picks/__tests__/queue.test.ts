/**
 * POST /api/drafts/[id]/picks on a queue-engine pool (draft-backend §8.1 #9,
 * §8.3; B-SNAP). The RPC layer is mocked at `callDraftRpc` (the real
 * `toDraftRuleError`, `drafts-queue` and `snapshot` modules run); `after()`
 * collects its callbacks so the test can run the notifications explicitly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ afterCallbacks: [] as (() => unknown)[] }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (cb: () => unknown) => void hoisted.afterCallbacks.push(cb) };
});

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireDraftAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolById: vi.fn(),
  getPicksByPool: vi.fn(),
  createDraftPick: vi.fn(),
  updateDraftPoolStatus: vi.fn(),
}));
vi.mock('@/lib/draft/rpc-errors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/draft/rpc-errors')>('@/lib/draft/rpc-errors');
  return { ...actual, callDraftRpc: vi.fn() };
});
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getListEntryByLineId: vi.fn(),
  getListEntryByBaseAndStage3: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonParticipants: vi.fn(), getSeasonById: vi.fn() }));
vi.mock('@/lib/supabase/queries/players', () => ({ getPlayerById: vi.fn() }));
vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getTierByBasePokemon: vi.fn(),
  createTracker: vi.fn(),
  getSeasonTrackers: vi.fn(),
}));
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/social/notify', () => ({ emitSocialEvent: vi.fn() }));
vi.mock('@/lib/draft/notify', () => ({ dispatchDraftNotifications: vi.fn() }));

import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/drafts/[id]/picks/route';
import { requireDraftAdmin, requirePlayer, AuthError } from '@/lib/auth/helpers';
import { getDraftPoolById, createDraftPick } from '@/lib/supabase/queries/drafts';
import { callDraftRpc, toDraftRuleError } from '@/lib/draft/rpc-errors';
import { getListEntryByLineId } from '@/lib/supabase/queries/point-buy-lists';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { createTracker } from '@/lib/supabase/queries/evolutions';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { dispatchDraftNotifications } from '@/lib/draft/notify';
import { revalidateTag } from 'next/cache';
import { expectNoPrivatePlayerData, PRIVATE_SENTINELS } from '@/lib/players/__tests__/private-player-fields';

const POOL = '11111111-1111-4111-8111-111111111111';
const SLOT = '22222222-2222-4222-8222-222222222222';
const REQ = '33333333-3333-4333-8333-333333333333';
const P1 = '44444444-4444-4444-8444-444444444444';
const P2 = '55555555-5555-4555-8555-555555555555';
const SEASON = 'season-1';

type Raw = Record<string, unknown>;

const queuePool = (kind: 'initial' | 'redraft' = 'initial') => ({
  id: POOL, season_id: SEASON, draft_type: 'snake', status: 'in_progress', engine: 'queue', kind,
  phase: 'drafting', list_version_id: 'list-1',
});

function rawSnapshot(activePlayer: string | null, publishedNow = false): Raw {
  return {
    state_version: 8,
    server_now: '2026-10-11T12:00:00Z',
    pool: {
      id: POOL, season_id: SEASON, kind: 'initial', mode: 'live', status: 'in_progress', paused: false, paused_at: null,
      roster_size: 9, budget: 180, started_at: null, ended_at: null, phase: 'drafting', pause_reason: null,
      list_version_id: 'list-1',
    },
    config: { pick_seconds: 300, makeup_seconds: 150, slow_ladder_seconds: [43200], extension_seconds: [120, 60], redraft_max_lines: 3 },
    participants: [P1, P2].map((id, i) => ({
      player_id: id, name: i === 0 ? 'Ash' : 'Misty', avatar_url: null, seat: i + 1, standing_rank: null, slots_total: 9,
      picks_made: i === 0 ? 1 : 0, open_slots: 8, budget_start: 180, budget_remaining: 160, penalty_stage: 0, timeout_count: 0,
      extensions: { plus120_used: false, plus60_used: false }, done: false, discord_id: PRIVATE_SENTINELS.discord_id,
    })),
    active_slot: activePlayer
      ? {
          slot_id: 'slot-next', player_id: activePlayer, round: 1, pick_number: 2, kind: 'normal', status: 'active',
          duration_ms: 300000, extensions_applied_ms: 0, started_at: '2026-10-11T12:00:00Z',
          deadline_at: '2026-10-11T12:05:00Z', remaining_ms_at_pause: null,
        }
      : null,
    upcoming: [],
    picks: [
      {
        pick_id: 'pick-1', slot_id: SLOT, pick_number: 1, round: 1, player_id: P1, line_id: 'oshawott--samurotthisui',
        entry_id: 'e1', price: 20, made_at: '2026-10-11T12:00:00Z', admin_override: false, redraft_slot_id: null,
      },
    ],
    taken: { 'oshawott--samurotthisui': P1 },
    prices: { 'oshawott--samurotthisui': 20, 'eevee--sylveon': 10 },
    restrictions: [],
    no_redraft_line_ids: [],
    redraft: null,
    recent_events: [],
    published_now: publishedNow,
  };
}

const confirmResult = (overrides: Raw = {}): Raw => ({
  pick_id: 'pick-1', tracker_id: 't1', line_id: 'oshawott--samurotthisui', pick_number: 1, player_id: P1, price: 20,
  stage: 1, replay: false, next_slot_id: 'slot-next', completed: false, state_version: 8, ...overrides,
});

const body = (overrides: Raw = {}): Raw => ({ slot_id: SLOT, line_id: 'oshawott--samurotthisui', client_request_id: REQ, ...overrides });
const makeRequest = (b: unknown) => ({ json: () => Promise.resolve(b) }) as unknown as NextRequest;
const routeParams = { params: Promise.resolve({ id: POOL }) };

/** Routes the mocked RPC by name. */
function rpcAnswers(answers: { confirm?: () => unknown; snapshot?: () => unknown; claims?: () => unknown }) {
  vi.mocked(callDraftRpc).mockImplementation(async (fn) => {
    if (fn === 'draft_confirm_pick') return answers.confirm ? answers.confirm() : confirmResult();
    if (fn === 'draft_snapshot') return answers.snapshot ? answers.snapshot() : rawSnapshot(P2);
    if (fn === 'draft_claim_notifications') return answers.claims ? answers.claims() : [];
    throw new Error(`unexpected rpc ${fn}`);
  });
}

/** What the real `callDraftRpc` throws for a PostgREST P0001 error (the internal codes stay raw). */
const pgRule = (message: string, details: Raw | null = null): unknown => {
  const raw = { code: 'P0001', message, details: details ? JSON.stringify(details) : null };
  return toDraftRuleError(raw) ?? raw;
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.afterCallbacks = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requirePlayer).mockResolvedValue({ playerId: P1, name: 'Ash', isAdmin: false, isResourceAdmin: false } as never);
  vi.mocked(getDraftPoolById).mockResolvedValue(queuePool() as never);
  vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON, name: 'EvoLiga S1' } as never);
  vi.mocked(getListEntryByLineId).mockResolvedValue({
    id: 'e1', line_id: 'oshawott--samurotthisui', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott',
    stage3_pokemon: 'Samurott-Hisui', kills_to_stage2: 3, additional_kills_to_stage3: 4, price: 20,
  } as never);
  vi.mocked(getPlayerById).mockResolvedValue({ id: P2, name: 'Misty', discord_id: 'discord-misty' } as never);
  rpcAnswers({});
});

describe('POST /api/drafts/[id]/picks — queue engine', () => {
  it('confirms the pick through draft_confirm_pick and answers 201 with the fresh snapshot', async () => {
    const res = await POST(makeRequest(body()), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(vi.mocked(callDraftRpc).mock.calls.map(([fn]) => fn)).toEqual(['draft_confirm_pick', 'draft_snapshot']);
    expect(callDraftRpc).toHaveBeenCalledWith('draft_confirm_pick', {
      p_pool_id: POOL, p_slot_id: SLOT, p_player_id: P1, p_actor_id: P1, p_actor_role: 'player',
      p_line_id: 'oshawott--samurotthisui', p_client_request_id: REQ, p_redraft_slot_id: null,
      p_line_thresholds: null, p_override_reason: null,
    });
    expect(json.data.pick).toEqual({ pick_id: 'pick-1', line_id: 'oshawott--samurotthisui', pick_number: 1, player_id: P1, price: 20 });
    expect(json.data.replay).toBe(false);
    expect(json.data.state_version).toBe(8);
    expect(json.data.snapshot.viewer.player_id).toBe(P1);
    // Initial pools need no list read; the legacy writes never run.
    expect(getListEntryByLineId).not.toHaveBeenCalled();
    expect(createDraftPick).not.toHaveBeenCalled();
    expect(createTracker).not.toHaveBeenCalled();
    expect(vi.mocked(revalidateTag).mock.calls).toEqual([[`season:${SEASON}`, { expire: 0 }]]);
    expectNoPrivatePlayerData(json, { allowKeys: ['status'] });
  });

  it('sends the Discord pick (next picker @mention) only from after()', async () => {
    await POST(makeRequest(body()), routeParams);
    expect(emitDiscordEvent).not.toHaveBeenCalled();
    expect(hoisted.afterCallbacks).toHaveLength(1);

    await hoisted.afterCallbacks[0]();

    expect(emitDiscordEvent).toHaveBeenCalledTimes(1);
    expect(emitDiscordEvent).toHaveBeenCalledWith({
      event_type: 'draft_pick_made',
      tournament_id: '',
      season_id: SEASON,
      data: {
        kind: 'draft_pick', player_name: 'Ash', pokemon_name: 'Oshawott', pick_number: 1, round: 1,
        season_name: 'EvoLiga S1', next_picker_name: 'Misty', next_picker_discord_id: 'discord-misty',
        line: { base: 'Oshawott', stage3: 'Samurott-Hisui' },
      },
    });
    expect(emitSocialEvent).toHaveBeenCalledTimes(1);
  });

  it('claims the pool due notifications in after() and dispatches them (B-CRON, §8.3)', async () => {
    const claims = [{ type: 'turn_started', pool_id: POOL, season_id: SEASON, slot_id: 'slot-next', player_id: P2 }];
    rpcAnswers({ claims: () => claims });
    await POST(makeRequest(body()), routeParams);
    expect(dispatchDraftNotifications).not.toHaveBeenCalled();

    await hoisted.afterCallbacks[0]();

    expect(callDraftRpc).toHaveBeenCalledWith('draft_claim_notifications', { p_pool_id: POOL });
    expect(dispatchDraftNotifications).toHaveBeenCalledWith(claims);
  });

  it('a failed notification claim is logged and never reaches the response', async () => {
    rpcAnswers({ claims: () => Promise.reject(new Error('claim down')) });
    const res = await POST(makeRequest(body()), routeParams);
    expect(res.status).toBe(201);
    await expect(Promise.resolve(hoisted.afterCallbacks[0]())).resolves.toBeUndefined();
    expect(dispatchDraftNotifications).not.toHaveBeenCalled();
    // The pick announcement still went out.
    expect(emitDiscordEvent).toHaveBeenCalledTimes(1);
  });

  it('announces draft_completed when the pick completes the draft', async () => {
    rpcAnswers({ confirm: () => confirmResult({ completed: true }), snapshot: () => rawSnapshot(null) });
    await POST(makeRequest(body()), routeParams);
    await hoisted.afterCallbacks[0]();

    const events = vi.mocked(emitDiscordEvent).mock.calls.map(([p]) => p.event_type);
    expect(events).toEqual(['draft_pick_made', 'draft_completed']);
    expect(getPlayerById).not.toHaveBeenCalled();
  });

  it('a notification failure never reaches the response', async () => {
    vi.mocked(getSeasonById).mockRejectedValue(new Error('down'));
    const res = await POST(makeRequest(body()), routeParams);
    expect(res.status).toBe(201);
    await expect(Promise.resolve(hoisted.afterCallbacks[0]())).resolves.toBeUndefined();
  });

  it('a replayed client_request_id answers 200 with replay:true and sends nothing again', async () => {
    rpcAnswers({ confirm: () => ({ pick_id: 'pick-1', line_id: 'oshawott--samurotthisui', pick_number: 1, player_id: P1, price: 20, replay: true, voided: false, completed: false, state_version: 8 }) });

    const res = await POST(makeRequest(body()), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.replay).toBe(true);
    expect(hoisted.afterCallbacks).toHaveLength(0);
  });

  it('a stale slot answers 409 STALE_SLOT with detail and the current snapshot', async () => {
    rpcAnswers({ confirm: () => Promise.reject(pgRule('STALE_SLOT', { current_slot_id: 'slot-next', current_player_id: P2 })) });

    const res = await POST(makeRequest(body()), routeParams);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('STALE_SLOT');
    expect(json.error).toBe('This pick is no longer on the clock.');
    expect(json.params).toBeUndefined();
    expect(json.detail).toEqual({ current_slot_id: 'slot-next', current_player_id: P2 });
    expect(json.snapshot.active_slot.slot_id).toBe('slot-next');
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(hoisted.afterCallbacks).toHaveLength(0);
    expectNoPrivatePlayerData(json, { allowKeys: ['status'] });
  });

  it('a refused pick whose snapshot tick published a redraft still expires the draft reads', async () => {
    rpcAnswers({
      confirm: () => Promise.reject(pgRule('BUDGET_INFEASIBLE', { shortfall: 2, slots: 1, remaining_after: 8, min_cost: 10 })),
      snapshot: () => rawSnapshot(P1, true),
    });

    const res = await POST(makeRequest(body()), routeParams);
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.params).toEqual({ shortfall: 2, slots: 1 });
    expect(json.detail).toEqual({ remaining_after: 8, min_cost: 10 });
    expect(vi.mocked(revalidateTag).mock.calls).toEqual([[`season:${SEASON}`, { expire: 0 }]]);
  });

  it('a rule error still answers when the follow-up snapshot fails', async () => {
    rpcAnswers({
      confirm: () => Promise.reject(pgRule('NOT_YOUR_TURN')),
      snapshot: () => Promise.reject(new Error('snapshot down')),
    });
    const res = await POST(makeRequest(body()), routeParams);
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.code).toBe('NOT_YOUR_TURN');
    expect(json).not.toHaveProperty('snapshot');
  });

  it('expires the draft reads and schedules the notifications before the snapshot read (§8.3 step 5)', async () => {
    await POST(makeRequest(body()), routeParams);
    const rpcCalls = vi.mocked(callDraftRpc).mock;
    const snapshotOrder = rpcCalls.invocationCallOrder[rpcCalls.calls.findIndex(([fn]) => fn === 'draft_snapshot')];
    expect(vi.mocked(revalidateTag).mock.invocationCallOrder[0]).toBeLessThan(snapshotOrder);
    expect(hoisted.afterCallbacks).toHaveLength(1);
  });

  it('a snapshot failure after a committed pick still answers 201 with the pick (no snapshot), expired and notified', async () => {
    rpcAnswers({ snapshot: () => Promise.reject(new Error('snapshot down')) });
    const res = await POST(makeRequest(body()), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.pick).toEqual({ pick_id: 'pick-1', line_id: 'oshawott--samurotthisui', pick_number: 1, player_id: P1, price: 20 });
    expect(json.data.state_version).toBe(8);
    expect(json.data).not.toHaveProperty('snapshot');
    expect(vi.mocked(revalidateTag).mock.calls).toEqual([[`season:${SEASON}`, { expire: 0 }]]);

    // The after() job retries the snapshot for the embed; when that fails too, the turn ping still goes out.
    expect(hoisted.afterCallbacks).toHaveLength(1);
    await hoisted.afterCallbacks[0]();
    expect(emitDiscordEvent).not.toHaveBeenCalled();
    expect(dispatchDraftNotifications).toHaveBeenCalledTimes(1);
  });

  it('a malformed pool id is 404 POOL_NOT_FOUND without a pool read', async () => {
    const res = await POST(makeRequest(body()), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('POOL_NOT_FOUND');
    expect(getDraftPoolById).not.toHaveBeenCalled();
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('an internal SQL invariant is a 500 with the static fallback', async () => {
    rpcAnswers({ confirm: () => Promise.reject(pgRule('THRESHOLDS_REQUIRED')) });
    const res = await POST(makeRequest(body()), routeParams);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to make pick' });
  });

  it('rejects a legacy-shaped or extended body with 400 validation_failed', async () => {
    for (const b of [{ pokemon_name: 'Eevee' }, body({ player_id: P2 }), body({ line_id: 'Eevee' })]) {
      const res = await POST(makeRequest(b), routeParams);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('validation_failed');
    }
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('picking for another player needs the draft admin guard and a reason', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue({ playerId: P1, isAdmin: false } as never);

    const noReason = await POST(makeRequest(body({ on_behalf_of: P2 })), routeParams);
    expect(noReason.status).toBe(422);
    expect((await noReason.json()).code).toBe('OVERRIDE_REASON_REQUIRED');
    expect(requireDraftAdmin).toHaveBeenCalledWith(POOL);

    const res = await POST(makeRequest(body({ on_behalf_of: P2, override_reason: 'Discord outage' })), routeParams);
    expect(res.status).toBe(201);
    expect(callDraftRpc).toHaveBeenCalledWith('draft_confirm_pick', expect.objectContaining({
      p_player_id: P2, p_actor_id: P1, p_actor_role: 'admin', p_override_reason: 'Discord outage',
    }));
    expect((await res.json()).data.snapshot.viewer.is_pool_admin).toBe(true);
  });

  it('a non-admin picking for another player is refused by the guard', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required for this draft', 403),
    );
    const res = await POST(makeRequest(body({ on_behalf_of: P2, override_reason: 'because' })), routeParams);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('ACTOR_NOT_ALLOWED');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('naming yourself in on_behalf_of is a normal player pick', async () => {
    await POST(makeRequest(body({ on_behalf_of: P1 })), routeParams);
    expect(requireDraftAdmin).not.toHaveBeenCalled();
    expect(callDraftRpc).toHaveBeenCalledWith('draft_confirm_pick', expect.objectContaining({ p_actor_role: 'player' }));
  });

  it('a redraft pick passes the override-aware thresholds of the picked line', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(queuePool('redraft') as never);
    const RS = '66666666-6666-4666-8666-666666666666';

    const res = await POST(makeRequest(body({ redraft_slot_id: RS })), routeParams);

    expect(res.status).toBe(201);
    expect(getListEntryByLineId).toHaveBeenCalledWith('list-1', 'oshawott--samurotthisui');
    expect(callDraftRpc).toHaveBeenCalledWith('draft_confirm_pick', expect.objectContaining({
      p_redraft_slot_id: RS,
      p_line_thresholds: { line_id: 'oshawott--samurotthisui', stage2_kos: 3, stage3_kos: 7 },
    }));
  });

  it('a redraft pick of a line outside the list answers NOT_IN_LIST before the RPC', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(queuePool('redraft') as never);
    vi.mocked(getListEntryByLineId).mockResolvedValue(null);

    const res = await POST(makeRequest(body({ line_id: 'eevee--sylveon' })), routeParams);
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.code).toBe('NOT_IN_LIST');
    expect(json.snapshot).toBeDefined();
    expect(vi.mocked(callDraftRpc).mock.calls.map(([fn]) => fn)).toEqual(['draft_snapshot']);
  });
});
