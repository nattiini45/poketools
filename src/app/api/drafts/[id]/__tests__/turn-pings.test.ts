/**
 * Discord turn pings for live and slow drafts (product decision 2026-10-12).
 *
 * The polled reads (state, my-turn) schedule the notification claim ONLY when their tick resolved a timeout or
 * published a redraft — never on a plain poll (Supabase quota). Every admin write that can change the active slot
 * (start, resume, void, correct, redraft restore-drop) schedules it; a pause does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  callDraftRpc: vi.fn(),
  getDraftSnapshot: vi.fn(),
  getQueuePool: vi.fn(),
  getDraftPoolById: vi.fn(),
  expireDraftReads: vi.fn(),
}));

vi.mock('@/lib/draft/notify', () => ({ scheduleDraftNotifications: mocks.schedule }));
vi.mock('@/lib/draft/rpc-errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/draft/rpc-errors')>()),
  callDraftRpc: mocks.callDraftRpc,
}));
vi.mock('@/lib/draft/snapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/draft/snapshot')>()),
  getDraftSnapshot: mocks.getDraftSnapshot,
}));
vi.mock('@/lib/supabase/queries/drafts-queue', () => ({ getQueuePool: mocks.getQueuePool }));
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById: mocks.getDraftPoolById, getPicksByPool: vi.fn() }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn().mockResolvedValue(false) }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getListEntryByLineId: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expireDraftReads: mocks.expireDraftReads }));
vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireDraftAdmin: vi.fn(),
  AuthError: class AuthError extends Error {},
}));

import { GET as getState } from '@/app/api/drafts/[id]/state/route';
import { GET as getMyTurn } from '@/app/api/drafts/[id]/my-turn/route';
import { POST as postStart } from '@/app/api/drafts/[id]/start/route';
import { POST as postPause } from '@/app/api/drafts/[id]/pause/route';
import { POST as postVoid } from '@/app/api/drafts/[id]/picks/[pickId]/void/route';
import { POST as postCorrect } from '@/app/api/drafts/[id]/picks/[pickId]/correct/route';
import { POST as postRestore } from '@/app/api/drafts/[id]/redraft/slots/[redraftSlotId]/restore/route';
import { requireDraftAdmin, requirePlayer } from '@/lib/auth/helpers';

const POOL = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SEASON = 'season-1';
const pool = { id: POOL, season_id: SEASON, engine: 'queue', kind: 'initial', mode: 'live', list_version_id: 'lv-1' };

const unchanged = { unchanged: true as const, state_version: 4, server_now: '2026-10-12T12:00:00Z' };

function myTurnRaw(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    state_version: 5, server_now: '2026-10-12T12:00:00Z', status: 'in_progress', mode: 'live', paused: false,
    on_clock: true, up_next: false, slot_id: OTHER, deadline_at: '2026-10-12T12:02:00Z', remaining_ms_at_pause: null,
    league_name: 'EvoLiga', published_now: false, timeouts_resolved: 0, ...extra,
  };
}

const json = (body: unknown) =>
  new Request(`http://localhost/api/drafts/${POOL}/x`, { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'p1', isAdmin: false, isResourceAdmin: false } as never);
  vi.mocked(requireDraftAdmin).mockResolvedValue({ playerId: 'admin-1', isAdmin: true } as never);
  mocks.getQueuePool.mockResolvedValue(pool);
  mocks.getDraftPoolById.mockResolvedValue(pool);
  mocks.callDraftRpc.mockResolvedValue({ state_version: 9 });
});

describe('GET /state (polled)', () => {
  const call = () =>
    getState(new NextRequest(`http://localhost/api/drafts/${POOL}/state?since=4`), {
      params: Promise.resolve({ id: POOL }),
    });

  it('a plain poll never schedules the claim', async () => {
    mocks.getDraftSnapshot.mockResolvedValue({ dto: unchanged, publishedNow: false, timeoutsResolved: 0, seasonId: null });
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('a resolved timeout schedules the claim once and never leaks the count', async () => {
    mocks.getDraftSnapshot.mockResolvedValue({ dto: unchanged, publishedNow: false, timeoutsResolved: 2, seasonId: null });
    const res = await call();
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
    expect(mocks.schedule).toHaveBeenCalledWith(POOL);
    expect(mocks.expireDraftReads).not.toHaveBeenCalled();
    const text = await res.text();
    expect(text).not.toContain('timeouts_resolved');
    expect(text).not.toContain('timeoutsResolved');
  });

  it('a publish schedules the claim and expires the reads', async () => {
    mocks.getDraftSnapshot.mockResolvedValue({ dto: unchanged, publishedNow: true, timeoutsResolved: 0, seasonId: null });
    await call();
    expect(mocks.schedule).toHaveBeenCalledWith(POOL);
    expect(mocks.expireDraftReads).toHaveBeenCalledWith(SEASON);
  });
});

describe('GET /my-turn (polled, hidden tab)', () => {
  const call = () => getMyTurn(new Request(`http://localhost/api/drafts/${POOL}/my-turn`), { params: Promise.resolve({ id: POOL }) });

  it('a plain poll never schedules the claim and reads no pool', async () => {
    mocks.callDraftRpc.mockResolvedValue(myTurnRaw({}));
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.callDraftRpc).toHaveBeenCalledWith('draft_my_turn', { p_pool_id: POOL, p_player_id: 'p1' });
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.getDraftPoolById).not.toHaveBeenCalled();
    expect(mocks.getQueuePool).not.toHaveBeenCalled();
  });

  it('a resolved timeout schedules the claim; the DTO stays unchanged', async () => {
    mocks.callDraftRpc.mockResolvedValue(myTurnRaw({ timeouts_resolved: 1 }));
    const res = await call();
    expect(mocks.schedule).toHaveBeenCalledWith(POOL);
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual(
      ['deadline_at', 'league_name', 'mode', 'on_clock', 'paused', 'quiet_hours', 'remaining_ms_at_pause', 'server_now',
        'slot_id', 'state_version', 'status', 'up_next'].sort(),
    );
  });

  it('a publish schedules the claim and expires the reads', async () => {
    mocks.callDraftRpc.mockResolvedValue(myTurnRaw({ published_now: true }));
    await call();
    expect(mocks.schedule).toHaveBeenCalledWith(POOL);
    expect(mocks.expireDraftReads).toHaveBeenCalledWith(SEASON);
  });
});

describe('admin writes that can change the active slot', () => {
  it('start schedules the claim', async () => {
    const res = await postStart(json({}), { params: Promise.resolve({ id: POOL }) });
    expect(res.status).toBe(200);
    expect(mocks.schedule).toHaveBeenCalledWith(POOL);
  });

  it('resume schedules the claim; pause does not', async () => {
    // The pause must succeed: a refused request would also schedule nothing (Kilo 4245734237).
    const paused = await postPause(json({ paused: true, reason: 'break' }), { params: Promise.resolve({ id: POOL }) });
    expect(paused.status).toBe(200);
    expect(mocks.callDraftRpc).toHaveBeenCalledWith('draft_set_paused', expect.objectContaining({ p_paused: true }));
    expect(mocks.schedule).not.toHaveBeenCalled();
    const res = await postPause(json({ paused: false }), { params: Promise.resolve({ id: POOL }) });
    expect(res.status).toBe(200);
    expect(mocks.schedule).toHaveBeenCalledWith(POOL);
  });

  it('void schedules the claim', async () => {
    const res = await postVoid(json({ reason: 'misclick', requeue: true }), {
      params: Promise.resolve({ id: POOL, pickId: OTHER }),
    });
    expect(res.status).toBe(200);
    expect(mocks.schedule).toHaveBeenCalledWith(POOL);
  });

  it('correct schedules the claim', async () => {
    const res = await postCorrect(
      json({ line_id: 'teddiursa--ursaluna', reason: 'misclick', client_request_id: OTHER }),
      { params: Promise.resolve({ id: POOL, pickId: OTHER }) },
    );
    expect(res.status).toBe(200);
    expect(mocks.schedule).toHaveBeenCalledWith(POOL);
  });

  it('redraft restore-drop schedules the claim', async () => {
    const res = await postRestore(json({ reason: 'admin error' }), {
      params: Promise.resolve({ id: POOL, redraftSlotId: OTHER }),
    });
    expect(res.status).toBe(200);
    expect(mocks.schedule).toHaveBeenCalledWith(POOL);
  });

  it('a failed write schedules nothing', async () => {
    mocks.callDraftRpc.mockRejectedValue(new Error('boom'));
    const res = await postStart(json({}), { params: Promise.resolve({ id: POOL }) });
    expect(res.status).toBe(500);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
