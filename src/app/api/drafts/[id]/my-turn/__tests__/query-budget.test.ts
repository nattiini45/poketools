/**
 * Query budget and behaviour of GET /api/drafts/[id]/my-turn (draft-backend
 * §8.1 #8, §8.5, §11.1; critique B8). It is the only draft endpoint polled
 * while the tab is hidden, so a quiet tick costs exactly one RPC (no pool
 * read; Kilo 4245127444): the pool is read only when the tick published a
 * redraft, for the season whose draft reads it expires.
 *
 * The real query modules run against a counting fake of the service-role
 * client; auth is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  pools: [] as Record<string, unknown>[],
  calls: [] as string[],
  rpcArgs: [] as [string, unknown][],
  rpcResult: { data: null as unknown, error: null as unknown },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock('@/lib/supabase/client', () => {
  function builder() {
    let id: unknown;
    const chain = {
      select: () => chain,
      eq: (_column: string, value: unknown) => {
        id = value;
        return chain;
      },
      maybeSingle: () => chain,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: db.pools.find((p) => p.id === id) ?? null, error: null }).then(resolve, reject),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => {
        db.calls.push(table);
        return builder();
      },
      rpc: (fn: string, args: unknown) => {
        db.calls.push(`rpc:${fn}`);
        db.rpcArgs.push([fn, args]);
        return Promise.resolve(db.rpcResult);
      },
    },
  };
});

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

import { GET } from '@/app/api/drafts/[id]/my-turn/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { revalidateTag } from 'next/cache';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';

const POOL = '11111111-1111-4111-8111-111111111111';
const SEASON = 'season-1';

function poolRow(engine: 'queue' | 'legacy'): Record<string, unknown> {
  return {
    id: POOL, season_id: SEASON, draft_type: 'snake', point_budget: 180, pool_mode: 'point_buy', status: 'in_progress',
    created_at: '2026-10-01', updated_at: '2026-10-01', engine, kind: 'initial', mode: 'slow', phase: 'drafting',
  };
}

function myTurn(publishedNow: boolean): Record<string, unknown> {
  return {
    state_version: 12, server_now: '2026-10-11T12:00:00Z', status: 'in_progress', mode: 'slow', paused: false,
    on_clock: true, up_next: false, slot_id: 'slot-4', deadline_at: '2026-10-11T20:00:00Z',
    remaining_ms_at_pause: null, league_name: 'EvoLiga', published_now: publishedNow,
  };
}

const call = (id = POOL) =>
  GET(new Request(`http://localhost/api/drafts/${id}/my-turn`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  db.pools = [poolRow('queue')];
  db.calls = [];
  db.rpcArgs = [];
  db.rpcResult = { data: myTurn(false), error: null };
  vi.mocked(revalidateTag).mockClear();
  vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'p1', isAdmin: false, isResourceAdmin: false } as never);
});

describe('GET /api/drafts/[id]/my-turn', () => {
  it('a quiet tick costs exactly one draft_my_turn RPC and no pool read', async () => {
    const res = await call();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(db.calls).toEqual(['rpc:draft_my_turn']);
    expect(db.rpcArgs).toEqual([['draft_my_turn', { p_pool_id: POOL, p_player_id: 'p1' }]]);
    expect(json.data).toEqual({
      state_version: 12, server_now: '2026-10-11T12:00:00Z', status: 'in_progress', mode: 'slow', paused: false,
      on_clock: true, up_next: false, slot_id: 'slot-4', deadline_at: '2026-10-11T20:00:00Z',
      remaining_ms_at_pause: null, league_name: 'EvoLiga',
    });
    expect(revalidateTag).not.toHaveBeenCalled();
    // `status` is the pool's status, not a player column.
    expectNoPrivatePlayerData(json, { allowKeys: ['status'] });
  });

  it('a redraft published by the tick expires the draft reads once and never leaks published_now', async () => {
    db.rpcResult = { data: myTurn(true), error: null };

    const res = await call();

    expect(res.status).toBe(200);
    // Only a publish reads the pool, after the RPC, for its season.
    expect(db.calls).toEqual(['rpc:draft_my_turn', 'draft_pools']);
    expect(vi.mocked(revalidateTag).mock.calls).toEqual([[`season:${SEASON}`, { expire: 0 }]]);
    expect(await res.text()).not.toContain('published_now');
  });

  it('a resolved timeout without a publish reads no pool and expires nothing', async () => {
    db.rpcResult = { data: { ...myTurn(false), timeouts_resolved: 1 }, error: null };

    const res = await call();

    expect(res.status).toBe(200);
    expect(db.calls).toEqual(['rpc:draft_my_turn']);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('a legacy pool answers 409 POOL_ENGINE_LEGACY (the RPC refuses it), with one call', async () => {
    db.pools = [poolRow('legacy')];
    db.rpcResult = { data: null, error: { code: 'P0001', message: 'POOL_ENGINE_LEGACY', details: null } };

    const res = await call();
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('POOL_ENGINE_LEGACY');
    expect(db.calls).toEqual(['rpc:draft_my_turn']);
  });

  it('an unknown or malformed pool id answers 404 POOL_NOT_FOUND', async () => {
    db.pools = [];
    db.rpcResult = { data: null, error: { code: 'P0001', message: 'POOL_NOT_FOUND', details: null } };
    expect((await (await call()).json()).code).toBe('POOL_NOT_FOUND');

    db.calls = [];
    const res = await call('not-a-uuid');
    expect(res.status).toBe(404);
    expect(db.calls).toEqual([]);
  });

  it('a rule error from the RPC keeps its code', async () => {
    db.rpcResult = { data: null, error: { code: 'P0001', message: 'POOL_NOT_FOUND', details: null } };
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('POOL_NOT_FOUND');
  });

  it('requires a signed-in player', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );
    const res = await call();
    expect(res.status).toBe(401);
    expect(db.calls).toEqual([]);
  });
});
