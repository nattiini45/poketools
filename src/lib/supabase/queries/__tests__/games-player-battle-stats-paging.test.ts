import { beforeEach, describe, expect, it, vi } from 'vitest';

// A query builder that answers like PostgREST under max_rows = 1000.
const h = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
    orders: [] as string[],
    ranges: [] as Array<[number, number]>,
    limits: [] as number[],
  };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.from = chain;
  builder.select = chain;
  builder.eq = chain;
  builder.limit = (n: number) => {
    state.limits.push(n);
    return builder;
  };
  builder.order = (column: string) => {
    state.orders.push(column);
    return builder;
  };
  builder.range = (from: number, to: number) => {
    state.ranges.push([from, to]);
    const width = Math.min(to - from + 1, 1000);
    return Promise.resolve({ data: state.rows.slice(from, from + width), error: null });
  };
  return { state, builder };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: h.builder }));

import { getPlayerBattleStats } from '../games';

const PLAYER_ID = '5eed0001-0000-4000-8000-000000000001';

function statRow(n: number) {
  return {
    pokemon_name: `Mon ${n % 6}`,
    kos_dealt: 1,
    was_koed: false,
    match_won: true,
    games: { matches: { tournament_id: 'tourney-1' } },
  };
}

describe('getPlayerBattleStats', () => {
  beforeEach(() => {
    h.state.rows = [];
    h.state.orders = [];
    h.state.ranges = [];
    h.state.limits = [];
  });

  it('returns every row of a player with more than 1,000 battle stats', async () => {
    h.state.rows = Array.from({ length: 1250 }, (_, i) => statRow(i));

    const stats = await getPlayerBattleStats(PLAYER_ID);

    expect(stats).toHaveLength(1250);
    expect(stats[0]).toEqual({
      pokemon_name: 'Mon 0', kos_dealt: 1, was_koed: false, match_won: true, tournament_id: 'tourney-1',
    });
    expect(h.state.ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(h.state.limits).toEqual([]);
  });

  it('reads a player with 1,000 rows or fewer in one request', async () => {
    h.state.rows = Array.from({ length: 40 }, (_, i) => statRow(i));

    expect(await getPlayerBattleStats(PLAYER_ID)).toHaveLength(40);
    expect(h.state.ranges).toEqual([[0, 999]]);
  });

  it('orders by a unique column so a page boundary never skips or repeats a row', async () => {
    await getPlayerBattleStats(PLAYER_ID);

    expect(h.state.orders).toEqual(['created_at', 'id']);
  });
});
