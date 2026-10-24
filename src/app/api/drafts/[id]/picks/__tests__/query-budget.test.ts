/**
 * Query budget of POST /api/drafts/[id]/picks on a queue-engine pool: before the response, `draft_pools`,
 * [`point_buy_list_entries` in a redraft], `rpc:draft_confirm_pick`,
 * `rpc:draft_snapshot` — at most 4. The `after()` notification work is
 * excluded: `after` only collects its callbacks here.
 *
 * The real query, snapshot and RPC modules run against a counting fake of
 * the service-role client; auth is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  calls: [] as string[],
  rpcResults: {} as Record<string, unknown>,
  afterCallbacks: [] as (() => unknown)[],
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (cb: () => unknown) => void db.afterCallbacks.push(cb) };
});

vi.mock('@/lib/supabase/client', () => {
  function builder(table: string) {
    const filters: [string, unknown][] = [];
    const run = () => {
      const rows = (db.tables[table] ?? []).filter((row) => filters.every(([c, v]) => !(c in row) || row[c] === v));
      return { data: rows[0] ?? null, error: null };
    };
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return chain;
      },
      maybeSingle: () => chain,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => {
        db.calls.push(table);
        return builder(table);
      },
      rpc: (fn: string) => {
        db.calls.push(`rpc:${fn}`);
        return Promise.resolve({ data: db.rpcResults[fn] ?? null, error: null });
      },
    },
  };
});

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(async () => ({ playerId: P1, isAdmin: false, isResourceAdmin: false })),
  requireDraftAdmin: vi.fn(),
}));

import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/drafts/[id]/picks/route';

const POOL = '11111111-1111-4111-8111-111111111111';
const SLOT = '22222222-2222-4222-8222-222222222222';
const REQ = '33333333-3333-4333-8333-333333333333';
const P1 = '44444444-4444-4444-8444-444444444444';
const SEASON = 'season-1';

function seed(kind: 'initial' | 'redraft') {
  db.tables = {
    draft_pools: [
      {
        id: POOL, season_id: SEASON, draft_type: 'snake', point_budget: 180, pool_mode: 'point_buy', status: 'in_progress',
        created_at: '2026-10-01', updated_at: '2026-10-01', engine: 'queue', kind, phase: 'drafting', list_version_id: 'list-1',
      },
    ],
    point_buy_list_entries: [
      {
        id: 'e1', list_version_id: 'list-1', line_id: 'eevee--sylveon', base_pokemon: 'Eevee', stage2_pokemon: 'Sylveon',
        stage3_pokemon: null, kills_to_stage2: 3, additional_kills_to_stage3: null, price: 10, special_rules: {},
      },
    ],
  };
  db.rpcResults = {
    draft_confirm_pick: {
      pick_id: 'pick-1', line_id: 'eevee--sylveon', pick_number: 1, player_id: P1, price: 10, replay: false,
      completed: false, state_version: 4,
    },
    draft_snapshot: {
      state_version: 4,
      server_now: '2026-10-11T12:00:00Z',
      pool: { id: POOL, season_id: SEASON, kind, mode: 'live', status: 'in_progress', paused: false, phase: 'drafting', list_version_id: 'list-1' },
      config: {},
      participants: [],
      active_slot: null,
      upcoming: [],
      picks: [],
      taken: {},
      prices: {},
      restrictions: [],
      no_redraft_line_ids: [],
      redraft: null,
      recent_events: [],
      published_now: false,
    },
  };
}

const makeRequest = (b: Row) => ({ json: () => Promise.resolve(b) }) as unknown as NextRequest;
const pick = (b: Row = {}) =>
  POST(makeRequest({ slot_id: SLOT, line_id: 'eevee--sylveon', client_request_id: REQ, ...b }), {
    params: Promise.resolve({ id: POOL }),
  });

beforeEach(() => {
  db.calls = [];
  db.afterCallbacks = [];
});

describe('POST /api/drafts/[id]/picks — queue engine query budget', () => {
  it('an initial-draft pick costs the pool read and two RPCs before the response', async () => {
    seed('initial');
    const res = await pick();

    expect(res.status).toBe(201);
    expect(db.calls).toEqual(['draft_pools', 'rpc:draft_confirm_pick', 'rpc:draft_snapshot']);
    expect(db.afterCallbacks).toHaveLength(1);
  });

  it('a redraft pick adds only the list entry read (≤ 4)', async () => {
    seed('redraft');
    const res = await pick({ redraft_slot_id: '66666666-6666-4666-8666-666666666666' });

    expect(res.status).toBe(201);
    expect(db.calls).toEqual(['draft_pools', 'point_buy_list_entries', 'rpc:draft_confirm_pick', 'rpc:draft_snapshot']);
    expect(db.calls.length).toBeLessThanOrEqual(4);
  });
});
