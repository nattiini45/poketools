/**
 * GET/POST /api/cron/draft-ticks (B-CRON, draft-backend §8.1 #32, §11.2).
 * The RPC layer is mocked at `callDraftRpc`; `dispatchDraftNotifications` runs
 * for real against mocked reads, so the test sees the Discord calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) =>
    NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));
vi.mock('@/lib/draft/rpc-errors', () => ({ callDraftRpc: vi.fn() }));
vi.mock('@/lib/draft/notify', async () => {
  const actual = await vi.importActual<typeof import('@/lib/draft/notify')>('@/lib/draft/notify');
  return { ...actual, listTickablePools: vi.fn() };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/revalidation', () => ({ expireDraftReads: vi.fn() }));
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/supabase/queries/players', () => ({ getPlayersByIds: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn() }));

import { GET, POST } from '@/app/api/cron/draft-ticks/route';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { listTickablePools } from '@/lib/draft/notify';
import { expireDraftReads } from '@/lib/revalidation';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { getPlayersByIds } from '@/lib/supabase/queries/players';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { safeErrorResponse } from '@/lib/api/error-response';

const originalCronSecret = process.env.CRON_SECRET;

const request = (auth?: string, query = '') =>
  new Request(`https://example.test/api/cron/draft-ticks${query}`, {
    headers: auth ? { authorization: auth } : {},
  });

const turnClaim = {
  type: 'turn_started', pool_id: 'pool-a', season_id: 'season-a', slot_id: 'slot-1', player_id: 'p1',
  deadline_at: '2026-10-11T21:59:59+00:00', timer_seconds: 43200, round: 1, pick_number: 3, kind: 'normal', mode: 'slow',
};

function rpc(answers: { tick?: (poolId: string) => unknown; claims?: () => unknown }) {
  vi.mocked(callDraftRpc).mockImplementation(async (fn, args) => {
    if (fn === 'draft_tick') return answers.tick ? answers.tick(String(args.p_pool_id)) : { timeouts: 0, published: false };
    if (fn === 'draft_claim_notifications') return answers.claims ? answers.claims() : [];
    throw new Error(`unexpected rpc ${fn}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'cron-secret';
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(listTickablePools).mockResolvedValue([
    { id: 'pool-a', season_id: 'season-a' },
    { id: 'pool-b', season_id: 'season-b' },
  ]);
  vi.mocked(getSeasonById).mockResolvedValue({ id: 'season-a', name: 'EvoLiga S1' } as never);
  vi.mocked(getPlayersByIds).mockResolvedValue(new Map([['p1', { id: 'p1', name: 'Misty', discord_id: 'd1' }]]) as never);
  rpc({});
});

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
});

describe('/api/cron/draft-ticks auth', () => {
  it('answers 401 cron_unauthorized without a secret', async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, code: 'cron_unauthorized' });
    expect(listTickablePools).not.toHaveBeenCalled();
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('answers 401 with a wrong secret', async () => {
    const res = await POST(request('Bearer wrong-secret'));
    expect(res.status).toBe(401);
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('answers 500 cron_not_configured when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(request('Bearer cron-secret'));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'cron_not_configured' });
  });
});

describe('/api/cron/draft-ticks run', () => {
  it('ticks every open pool, then claims and dispatches the notifications', async () => {
    rpc({
      tick: (poolId) => (poolId === 'pool-a' ? { timeouts: 2, published: false } : { timeouts: 1, published: false }),
      claims: () => [turnClaim],
    });

    const res = await GET(request('Bearer cron-secret'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      success: true,
      data: { pools: 2, timeouts: 3, published: 0, notifications: 1, publishRefused: 0, publishBackoff: 0 },
    });
    expect(listTickablePools).toHaveBeenCalledWith(25);
    expect(vi.mocked(callDraftRpc).mock.calls).toEqual([
      ['draft_tick', { p_pool_id: 'pool-a' }],
      ['draft_tick', { p_pool_id: 'pool-b' }],
      ['draft_claim_notifications', {}],
    ]);
    expect(expireDraftReads).not.toHaveBeenCalled();
    expect(emitDiscordEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'draft_turn_started', season_id: 'season-a' }));
  });

  it('a published redraft expires that season\'s draft reads', async () => {
    rpc({ tick: (poolId) => ({ timeouts: 0, published: poolId === 'pool-b' }) });
    const res = await POST(request('Bearer cron-secret'));
    expect((await res.json()).data).toMatchObject({ published: 1 });
    expect(expireDraftReads).toHaveBeenCalledTimes(1);
    expect(expireDraftReads).toHaveBeenCalledWith('season-b');
  });

  it('a refused deadline publish is logged with its code, never counted as published', async () => {
    rpc({
      tick: (poolId) =>
        poolId === 'pool-b'
          ? { timeouts: 0, published: false, publish_refused: 'REDRAFT_NOT_COMPLETABLE' }
          : { timeouts: 0, published: false, publish_refused: null },
    });
    const res = await POST(request('Bearer cron-secret'));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ published: 0, publishRefused: 1, publishBackoff: 0 });
    expect(expireDraftReads).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      '[cron/draft-ticks] redraft publish refused for pool pool-b: REDRAFT_NOT_COMPLETABLE',
    );
  });

  it('a backed-off publish (refused before, pool unchanged) is counted, not logged again', async () => {
    rpc({
      tick: (poolId) =>
        poolId === 'pool-b'
          ? { timeouts: 0, published: false, publish_refused: null, publish_backoff: true }
          : { timeouts: 0, published: false },
    });
    const res = await GET(request('Bearer cron-secret'));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ published: 0, publishRefused: 0, publishBackoff: 1 });
    expect(console.error).not.toHaveBeenCalled();
    expect(expireDraftReads).not.toHaveBeenCalled();
  });

  it('sends Discord fire-and-forget: a webhook that never settles does not hold the response', async () => {
    vi.mocked(emitDiscordEvent).mockImplementation(() => {
      void new Promise(() => undefined);
    });
    rpc({ claims: () => [turnClaim, { ...turnClaim, slot_id: 'slot-2', type: 'turn_reminder', threshold: '1h' }] });
    const res = await GET(request('Bearer cron-secret'));
    expect((await res.json()).data.notifications).toBe(2);
    expect(emitDiscordEvent).toHaveBeenCalledTimes(2);
  });

  it('one failing pool does not stop the others', async () => {
    rpc({
      tick: (poolId) => {
        if (poolId === 'pool-a') throw new Error('pool-a broke');
        return { timeouts: 1, published: false };
      },
    });
    const res = await GET(request('Bearer cron-secret'));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ pools: 2, timeouts: 1 });
    expect(callDraftRpc).toHaveBeenCalledWith('draft_claim_notifications', {});
  });

  it('honours ?limit= within 1..100 and rejects anything else with 400 validation_failed', async () => {
    await GET(request('Bearer cron-secret', '?limit=7'));
    expect(listTickablePools).toHaveBeenCalledWith(7);

    const res = await GET(request('Bearer cron-secret', '?limit=500'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'validation_failed' });
  });

  it('a failed pool listing goes through safeErrorResponse', async () => {
    vi.mocked(listTickablePools).mockRejectedValue(new Error('db down'));
    const res = await GET(request('Bearer cron-secret'));
    expect(res.status).toBe(500);
    expect(safeErrorResponse).toHaveBeenCalledWith(expect.any(Error), 'Failed to tick drafts');
  });
});
