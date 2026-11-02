import { beforeEach, describe, expect, it, vi } from 'vitest';

// A query builder that answers like PostgREST under `max_rows = 1000`: a response never holds more than 1,000 rows,
// whatever `.range()` asks for.
const h = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
    orders: [] as string[],
    ranges: [] as Array<[number, number]>,
    error: null as unknown,
  };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.from = chain;
  builder.select = chain;
  builder.eq = chain;
  builder.order = (column: string) => {
    state.orders.push(column);
    return builder;
  };
  builder.range = (from: number, to: number) => {
    state.ranges.push([from, to]);
    if (state.error) return Promise.resolve({ data: null, error: state.error });
    const sorted = [...state.rows].sort(
      (a, b) => (a.pick_number as number) - (b.pick_number as number) || String(a.id).localeCompare(String(b.id)),
    );
    const width = Math.min(to - from + 1, 1000);
    return Promise.resolve({ data: sorted.slice(from, from + width), error: null });
  };
  // A caller that does not page awaits the builder itself and gets the first 1,000 rows.
  builder.then = (resolve: (value: unknown) => unknown) => {
    const sorted = [...state.rows].sort((a, b) => (a.pick_number as number) - (b.pick_number as number));
    return Promise.resolve({ data: sorted.slice(0, 1000), error: null }).then(resolve);
  };
  return { state, builder };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: h.builder }));

import { getPicksByPool } from '../drafts';

function pickRow(n: number) {
  return {
    id: `pick-${String(n).padStart(5, '0')}`,
    draft_pool_id: 'pool-1',
    player_id: `player-${n % 21}`,
    pokemon_name: `Mon ${n}`,
    pick_number: n,
    round: Math.ceil(n / 21),
    points_spent: 0,
    timestamp: '2026-01-01T00:00:00Z',
    voided_at: null,
    players: { name: `Trainer ${n % 21}` },
  };
}

describe('getPicksByPool', () => {
  beforeEach(() => {
    h.state.rows = [];
    h.state.orders = [];
    h.state.ranges = [];
    h.state.error = null;
  });

  it('returns every pick of a 21 trainer x 50 round pool (1,050 picks), past the 1,000 row cap', async () => {
    h.state.rows = Array.from({ length: 1050 }, (_, i) => pickRow(i + 1));

    const picks = await getPicksByPool('pool-1');

    expect(picks).toHaveLength(1050);
    expect(picks[0].pick_number).toBe(1);
    expect(picks[1049].pick_number).toBe(1050);
    expect(picks[1049].player_name).toBe('Trainer 0');
    expect(h.state.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('reads a pool of 1,000 picks or fewer in one request', async () => {
    h.state.rows = Array.from({ length: 40 }, (_, i) => pickRow(i + 1));

    expect(await getPicksByPool('pool-1')).toHaveLength(40);
    expect(h.state.ranges).toEqual([[0, 999]]);
  });

  it('orders by the pick number and then a unique column, so a page boundary never skips or repeats a pick', async () => {
    await getPicksByPool('pool-1');

    expect(h.state.orders).toEqual(['pick_number', 'id']);
  });

  it('keeps a voided pick that shares its pick number in a stable place', async () => {
    h.state.rows = [
      { ...pickRow(1), id: 'pick-b', voided_at: '2026-01-02T00:00:00Z' },
      { ...pickRow(1), id: 'pick-a' },
      pickRow(2),
    ];

    const picks = await getPicksByPool('pool-1');

    expect(picks.map((p) => p.id)).toEqual(['pick-a', 'pick-b', 'pick-00002']);
  });

  it('throws on a read error rather than returning the picks read so far', async () => {
    h.state.rows = Array.from({ length: 1050 }, (_, i) => pickRow(i + 1));
    h.state.error = new Error('read failed');

    await expect(getPicksByPool('pool-1')).rejects.toThrow('read failed');
  });
});
