import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockBuilder = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'select', 'eq', 'in', 'gt', 'order']) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.range = vi.fn();
  return mb;
});

vi.mock('@/lib/supabase/client', () => ({ supabase: mockBuilder }));
vi.mock('../../client', () => ({ supabase: mockBuilder }));

import { getPlayerScopeUsage } from '../aggregates';

const usage = (i: number, scope_type = 'league', scope_id: string | null = 's1') => ({
  id: `row-${String(i).padStart(4, '0')}`,
  scope_type,
  scope_id,
  pokemon_name: `Mon ${i}`,
  total_brought: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of ['from', 'select', 'eq', 'in', 'gt', 'order']) {
    mockBuilder[m].mockReturnValue(mockBuilder);
  }
});

describe('getPlayerScopeUsage', () => {
  it("reads only the player's league and tournament rows that were brought", async () => {
    mockBuilder.range.mockResolvedValueOnce({ data: [usage(1)], error: null, count: 1 });

    const rows = await getPlayerScopeUsage('p1');

    expect(rows).toEqual([{ scope_type: 'league', scope_id: 's1', pokemon_name: 'Mon 1', total_brought: 1 }]);
    expect(mockBuilder.from).toHaveBeenCalledWith('player_aggregates');
    expect(mockBuilder.eq).toHaveBeenCalledWith('player_id', 'p1');
    expect(mockBuilder.in).toHaveBeenCalledWith('scope_type', ['league', 'tournament']);
    expect(mockBuilder.gt).toHaveBeenCalledWith('total_brought', 0);
    expect(mockBuilder.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(mockBuilder.select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' });
  });

  it('pages past a server max_rows cap up to the exact count', async () => {
    // The server caps each response at 2 rows although 5 match.
    mockBuilder.range
      .mockResolvedValueOnce({ data: [usage(1), usage(2)], error: null, count: 5 })
      .mockResolvedValueOnce({ data: [usage(3), usage(4)], error: null, count: null })
      .mockResolvedValueOnce({ data: [usage(5)], error: null, count: null });

    const rows = await getPlayerScopeUsage('p1');

    expect(rows.map((r) => r.pokemon_name)).toEqual(['Mon 1', 'Mon 2', 'Mon 3', 'Mon 4', 'Mon 5']);
    expect(mockBuilder.range.mock.calls.map(([from]) => from)).toEqual([0, 2, 4]);
    // Only the first page asks for the count.
    expect(mockBuilder.select.mock.calls.map(([, opts]) => opts)).toEqual([{ count: 'exact' }, undefined, undefined]);
  });

  it('skips rows without a scope id and still finishes paging', async () => {
    mockBuilder.range
      .mockResolvedValueOnce({ data: [usage(1, 'league', null)], error: null, count: 2 })
      .mockResolvedValueOnce({ data: [usage(2, 'tournament', 't1')], error: null, count: null });

    const rows = await getPlayerScopeUsage('p1');

    expect(rows).toEqual([{ scope_type: 'tournament', scope_id: 't1', pokemon_name: 'Mon 2', total_brought: 1 }]);
    expect(mockBuilder.range).toHaveBeenCalledTimes(2);
  });

  it('stops when rows vanish mid-read', async () => {
    mockBuilder.range
      .mockResolvedValueOnce({ data: [usage(1)], error: null, count: 3 })
      .mockResolvedValueOnce({ data: [], error: null, count: null });

    const rows = await getPlayerScopeUsage('p1');

    expect(rows).toHaveLength(1);
  });

  it('throws a query error', async () => {
    const error = { message: 'boom', code: 'XX000' };
    mockBuilder.range.mockResolvedValueOnce({ data: null, error, count: null });

    await expect(getPlayerScopeUsage('p1')).rejects.toBe(error);
  });
});
