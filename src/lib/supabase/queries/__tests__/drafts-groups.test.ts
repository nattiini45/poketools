/**
 * League groups in the draft pool lookups (20261018180000): `getDraftPoolBySeason` refuses a league with groups,
 * `getDraftPoolBySeasonGroup` resolves one group's pool, `getDraftPoolsBySeasonWithGroups` lists every pool with its
 * group. The Supabase client is a recording chain mock (no database).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };

const { chain, calls, state } = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  // `queue`: results for the next awaits in order (then `result` again).
  const state: { result: { data: unknown; error: unknown; count?: number }; queue: { data: unknown; error: unknown; count?: number }[] } = {
    result: { data: null, error: null },
    queue: [],
  };
  const next = () => state.queue.shift() ?? state.result;
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'neq', 'is', 'order', 'limit']) {
    chain[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    };
  }
  chain.maybeSingle = (...args: unknown[]) => {
    calls.push({ method: 'maybeSingle', args });
    return Promise.resolve(next());
  };
  // Awaiting the chain itself (list reads, head counts) resolves the current result.
  chain.then = (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(next()).then(resolve, reject);
  return { chain, calls, state };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: chain }));

import {
  getDraftPoolBySeason,
  getDraftPoolBySeasonGroup,
  getDraftPoolsBySeasonWithGroups,
  GroupedLeaguePoolLookupError,
} from '../drafts';

const poolRow = {
  id: 'pool-1',
  season_id: 's-1',
  draft_type: 'snake',
  pick_order: 'snake',
  point_budget: 180,
  pool_mode: 'point_buy',
  default_point_cost: null,
  team_size_mode: null,
  team_size_exact: null,
  team_size_min: null,
  team_size_max: null,
  status: 'pending',
  created_at: '2026-10-18T00:00:00Z',
  updated_at: '2026-10-18T00:00:00Z',
  engine: 'queue',
  kind: 'initial',
  mode: 'live',
  phase: 'setup',
  list_version_id: 'lv-1',
  parent_pool_id: null,
  roster_size: 9,
  pick_seconds: 300,
  makeup_seconds: 150,
  slow_ladder_seconds: [43200],
  extension_seconds: [120, 60],
  extensions_enabled: true,
  redraft_max_lines: 3,
  redraft_lock_no_redraft_lines: true,
  submission_deadline_at: null,
  submissions_published_at: null,
  token_purchase_closes_at: null,
  paused_at: null,
  paused_by: null,
  pause_reason: null,
  state_version: 1,
  publish_notified_at: null,
  started_at: null,
  ended_at: null,
  created_by: null,
  season_group_id: null as string | null,
};

function respond(result: Result): void {
  state.result = result;
}

function called(method: string): unknown[][] {
  return calls.filter((c) => c.method === method).map((c) => c.args);
}

beforeEach(() => {
  calls.length = 0;
  state.queue.length = 0;
  respond({ data: null, error: null });
});

describe('getDraftPoolBySeason (leagues without groups only)', () => {
  it('returns the oldest pool of a league without groups, in one query, mapping season_group_id', async () => {
    respond({ data: { ...poolRow, seasons: { season_groups: [{ count: 0 }] } }, error: null });
    const pool = await getDraftPoolBySeason('s-1');
    expect(pool?.id).toBe('pool-1');
    expect(pool?.season_group_id).toBeNull();
    expect(called('from')).toEqual([['draft_pools']]);
    expect(called('select')).toEqual([['*, seasons ( season_groups ( count ) )']]);
    expect(called('order')).toEqual([['created_at', { ascending: true }]]);
    expect(called('limit')).toEqual([[1]]);
  });

  it('keeps working for a row read without the embed (pre-migration or a mocked row)', async () => {
    respond({ data: { ...poolRow }, error: null });
    expect((await getDraftPoolBySeason('s-1'))?.id).toBe('pool-1');
  });

  it('refuses a league that has groups (embedded group count), loudly', async () => {
    respond({ data: { ...poolRow, seasons: { season_groups: [{ count: 2 }] } }, error: null });
    await expect(getDraftPoolBySeason('s-1')).rejects.toBeInstanceOf(GroupedLeaguePoolLookupError);
  });

  it('refuses a group pool even without the embed', async () => {
    respond({ data: { ...poolRow, season_group_id: 'g-1' }, error: null });
    const err = await getDraftPoolBySeason('s-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GroupedLeaguePoolLookupError);
    expect((err as GroupedLeaguePoolLookupError).seasonId).toBe('s-1');
    expect((err as Error).message).toMatch(/getDraftPoolBySeasonGroup/);
  });

  it('returns null when a league without groups has no pool (one group head count), and rethrows a query error', async () => {
    state.queue.push({ data: null, error: null }, { data: null, error: null, count: 0 });
    expect(await getDraftPoolBySeason('s-1')).toBeNull();
    expect(called('from')).toEqual([['draft_pools'], ['season_groups']]);
    expect(called('select')[1]).toEqual(['id', { count: 'exact', head: true }]);
    const failure = { code: '42P01', message: 'boom' };
    respond({ data: null, error: failure });
    await expect(getDraftPoolBySeason('s-1')).rejects.toBe(failure);
  });

  it('refuses a league that has groups but no pool yet (no caller reads "no draft")', async () => {
    state.queue.push({ data: null, error: null }, { data: null, error: null, count: 2 });
    const err = await getDraftPoolBySeason('s-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GroupedLeaguePoolLookupError);
  });

  it('rethrows a failed group head count', async () => {
    const failure = { code: '57014', message: 'statement timeout' };
    state.queue.push({ data: null, error: null }, { data: null, error: failure });
    await expect(getDraftPoolBySeason('s-1')).rejects.toBe(failure);
  });
});

describe('getDraftPoolBySeasonGroup', () => {
  it("reads a group's initial pool by season, kind and group id", async () => {
    respond({ data: { ...poolRow, season_group_id: 'g-1' }, error: null });
    const pool = await getDraftPoolBySeasonGroup('s-1', 'g-1');
    expect(pool?.season_group_id).toBe('g-1');
    expect(called('eq')).toEqual([['season_id', 's-1'], ['kind', 'initial'], ['season_group_id', 'g-1']]);
    expect(called('is')).toEqual([]);
    expect(called('neq')).toEqual([]);
  });

  it('a null group selects the pool without a group (a league without groups)', async () => {
    respond({ data: { ...poolRow }, error: null });
    await getDraftPoolBySeasonGroup('s-1', null);
    expect(called('is')).toEqual([['season_group_id', null]]);
  });

  it("a redraft lookup returns the group's live (not cancelled) redraft", async () => {
    respond({ data: null, error: null });
    expect(await getDraftPoolBySeasonGroup('s-1', 'g-2', 'redraft')).toBeNull();
    expect(called('eq')).toContainEqual(['kind', 'redraft']);
    expect(called('neq')).toEqual([['phase', 'cancelled']]);
  });

  it('rethrows a query error', async () => {
    const failure = { code: 'PGRST116', message: 'multiple rows' };
    respond({ data: null, error: failure });
    await expect(getDraftPoolBySeasonGroup('s-1', 'g-1')).rejects.toBe(failure);
  });
});

describe('getDraftPoolsBySeasonWithGroups', () => {
  const row = (id: string, group: { id: string; name: string; sort_order: number } | null, kind = 'initial') => ({
    id,
    engine: 'queue',
    kind,
    phase: 'setup',
    mode: 'live',
    status: 'pending',
    season_group_id: group?.id ?? null,
    parent_pool_id: null,
    point_budget: 180,
    created_at: '2026-10-18T00:00:00Z',
    season_groups: group ? { name: group.name, sort_order: group.sort_order } : null,
  });

  it('orders by group position, then creation, and carries the group name', async () => {
    const b = { id: 'g-b', name: 'Silber', sort_order: 2 };
    const a = { id: 'g-a', name: 'Gold', sort_order: 1 };
    respond({ data: [row('p1', b), row('p2', a), row('p3', b, 'redraft'), row('p4', a, 'redraft')], error: null });
    const pools = await getDraftPoolsBySeasonWithGroups('s-1');
    expect(pools.map((p) => [p.id, p.season_group_name, p.kind])).toEqual([
      ['p2', 'Gold', 'initial'],
      ['p4', 'Gold', 'redraft'],
      ['p1', 'Silber', 'initial'],
      ['p3', 'Silber', 'redraft'],
    ]);
    expect(pools[0]).toMatchObject({ season_group_id: 'g-a', season_group_sort_order: 1, point_budget: 180 });
    expect(called('order')).toEqual([['created_at', { ascending: true }]]);
  });

  it('a league without groups keeps creation order with null group fields', async () => {
    respond({ data: [row('p1', null), row('p2', null, 'redraft')], error: null });
    const pools = await getDraftPoolsBySeasonWithGroups('s-1');
    expect(pools.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(pools[1]).toMatchObject({ season_group_id: null, season_group_name: null, season_group_sort_order: null });
  });

  it('rethrows a query error', async () => {
    const failure = { code: '42703', message: 'column does not exist' };
    respond({ data: null, error: failure });
    await expect(getDraftPoolsBySeasonWithGroups('s-1')).rejects.toBe(failure);
  });
});
