import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAggregates: vi.fn(),
  getTotalGamesInScope: vi.fn(),
}));

import { GET } from '@/app/api/stats/route';
import {
  getAggregates,
  getTotalGamesInScope,
} from '@/lib/supabase/queries/aggregates';

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/stats');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return { url: url.toString(), nextUrl: url } as unknown as NextRequest;
}

const TOURNAMENT_ID = '11111111-2222-4333-8444-555555555555';

const fakeAggregate = (name: string) => ({
  id: `agg-${name}`,
  scope_type: 'tournament' as const,
  scope_id: TOURNAMENT_ID,
  last_updated: '2026-01-01T00:00:00.000Z',
  pokemon_name: name,
  total_appearances: 10,
  total_games: 8,
  total_kos_dealt: 5,
  total_koed: 3,
  total_brought: 6,
  total_led: 2,
  total_wins: 7,
  move_counts: { 'Close Combat': 4, Earthquake: 2 } as Record<string, number>,
});

describe('GET /api/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Validation ────────────────────────────────────────────

  it('rejects invalid scope', async () => {
    const res = await GET(makeRequest({ scope: 'invalid' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('scope must be');
    expect(body.code).toBe('stats_scope_invalid');
  });

  it('requires scope_id for tournament scope', async () => {
    const res = await GET(makeRequest({ scope: 'tournament' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('scope_id required');
    expect(body.code).toBe('stats_scope_id_required');
  });

  it('requires scope_id for league scope', async () => {
    const res = await GET(makeRequest({ scope: 'league' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('scope_id required');
    expect(body.code).toBe('stats_scope_id_required');
  });

  it('rejects an unknown view before querying', async () => {
    const res = await GET(
      makeRequest({ scope: 'tournament', scope_id: TOURNAMENT_ID, view: 'everything' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'view must be usage, raw, or moves', code: 'stats_view_invalid' });
    expect(vi.mocked(getAggregates)).not.toHaveBeenCalled();
  });

  it('rejects a scope_id that is not a UUID before querying', async () => {
    const cases: Record<string, string>[] = [
      { scope: 'tournament', scope_id: 't1' },
      { scope: 'league', scope_id: 'not-a-uuid', view: 'moves' },
      { scope: 'all_time', scope_id: "x' or 1=1" },
    ];
    for (const params of cases) {
      const res = await GET(makeRequest(params));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ success: false, error: 'scope_id must be a valid UUID', code: 'stats_scope_id_invalid' });
    }
    expect(vi.mocked(getAggregates)).not.toHaveBeenCalled();
    expect(vi.mocked(getTotalGamesInScope)).not.toHaveBeenCalled();
  });

  it('accepts each valid view with a UUID scope_id', async () => {
    vi.mocked(getAggregates).mockResolvedValue([]);
    vi.mocked(getTotalGamesInScope).mockResolvedValue(0);

    for (const view of ['usage', 'raw', 'moves']) {
      const res = await GET(makeRequest({ scope: 'league', scope_id: TOURNAMENT_ID, view }));
      expect(res.status).toBe(200);
    }
    expect(vi.mocked(getAggregates)).toHaveBeenCalledTimes(3);
  });

  // ── Raw view ──────────────────────────────────────────────

  it('returns raw aggregates when view=raw', async () => {
    const aggs = [fakeAggregate('Pikachu')];
    vi.mocked(getAggregates).mockResolvedValue(aggs);

    const res = await GET(
      makeRequest({ scope: 'tournament', scope_id: TOURNAMENT_ID, view: 'raw' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(aggs);
    expect(vi.mocked(getAggregates)).toHaveBeenCalledWith('tournament', TOURNAMENT_ID);
  });

  // ── Moves view ────────────────────────────────────────────

  it('returns move data sorted by count when view=moves', async () => {
    const aggs = [fakeAggregate('Lucario')];
    vi.mocked(getAggregates).mockResolvedValue(aggs);

    const res = await GET(
      makeRequest({ scope: 'tournament', scope_id: TOURNAMENT_ID, view: 'moves' }),
    );
    const body = await res.json();
    expect(body.success).toBe(true);

    const rows = body.data.rows;
    expect(rows[0]).toMatchObject({
      pokemon_name: 'Lucario',
      move_name: 'Close Combat',
      count: 4,
      move_type: 'Fighting',
      move_category: 'Physical',
    });
    expect(rows[1]).toMatchObject({
      pokemon_name: 'Lucario',
      move_name: 'Earthquake',
      count: 2,
      move_type: 'Ground',
      move_category: 'Physical',
    });

    expect(res.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=60',
    );

    expect(body.data.pokemonTotals).toEqual([
      {
        pokemon_name: 'Lucario',
        total_brought: 6,
        total_appearances: 10,
      },
    ]);
  });

  it('narrows the moves view to one move when move= is set', async () => {
    const lucario = fakeAggregate('Lucario');
    const garchomp = {
      ...fakeAggregate('Garchomp'),
      move_counts: { Earthquake: 9, 'Swords Dance': 3 } as Record<string, number>,
    };
    const pikachu = {
      ...fakeAggregate('Pikachu'),
      move_counts: { Thunderbolt: 5 } as Record<string, number>,
    };
    vi.mocked(getAggregates).mockResolvedValue([lucario, garchomp, pikachu]);

    const res = await GET(
      makeRequest({ scope: 'all_time', view: 'moves', move: 'Earthquake' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.rows).toEqual([
      {
        pokemon_name: 'Garchomp',
        move_name: 'Earthquake',
        count: 9,
        move_type: 'Ground',
        move_category: 'Physical',
      },
      {
        pokemon_name: 'Lucario',
        move_name: 'Earthquake',
        count: 2,
        move_type: 'Ground',
        move_category: 'Physical',
      },
    ]);
    // Totals only for the Pokémon that used the move (Pikachu is dropped).
    expect(body.data.pokemonTotals.map((t: { pokemon_name: string }) => t.pokemon_name)).toEqual([
      'Lucario',
      'Garchomp',
    ]);
    expect(res.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=60',
    );
  });

  it('returns empty move rows when no Pokémon used the filtered move', async () => {
    vi.mocked(getAggregates).mockResolvedValue([fakeAggregate('Lucario')]);

    const res = await GET(
      makeRequest({ scope: 'all_time', view: 'moves', move: 'constructor' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ rows: [], pokemonTotals: [] });
  });

  it('rejects an empty or over-long move filter', async () => {
    const empty = await GET(makeRequest({ scope: 'all_time', view: 'moves', move: '  ' }));
    expect(empty.status).toBe(400);
    const emptyBody = await empty.json();
    expect(emptyBody.error).toContain('move must be');
    expect(emptyBody.code).toBe('stats_move_filter_length');
    expect(emptyBody.params).toEqual({ max: 64 });

    const long = await GET(
      makeRequest({ scope: 'all_time', view: 'moves', move: 'x'.repeat(65) }),
    );
    expect(long.status).toBe(400);
    expect(vi.mocked(getAggregates)).not.toHaveBeenCalled();
  });

  // ── Default (usage) view ──────────────────────────────────

  it('returns usage rows with computed percentages and stats cache headers', async () => {
    const aggs = [fakeAggregate('Garchomp')];
    vi.mocked(getAggregates).mockResolvedValue(aggs);
    vi.mocked(getTotalGamesInScope).mockResolvedValue(20);

    const res = await GET(
      makeRequest({ scope: 'tournament', scope_id: TOURNAMENT_ID }),
    );
    const body = await res.json();
    expect(body.success).toBe(true);

    const row = body.data[0];
    expect(row.pokemon_name).toBe('Garchomp');
    expect(row.usage_percent).toBe((10 / 20) * 100);
    expect(row.koed_rate).toBe((3 / 10) * 100);
    expect(res.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=60',
    );
  });

  it('handles zero total games gracefully', async () => {
    const aggs = [fakeAggregate('Pikachu')];
    vi.mocked(getAggregates).mockResolvedValue(aggs);
    vi.mocked(getTotalGamesInScope).mockResolvedValue(0);

    const res = await GET(
      makeRequest({ scope: 'tournament', scope_id: TOURNAMENT_ID }),
    );
    const body = await res.json();
    expect(body.data[0].usage_percent).toBe(0);
  });

  it('allows all_time scope without scope_id', async () => {
    vi.mocked(getAggregates).mockResolvedValue([] as never);
    vi.mocked(getTotalGamesInScope).mockResolvedValue(0);

    const res = await GET(makeRequest({ scope: 'all_time' }));
    expect(res.status).toBe(200);
    expect(vi.mocked(getAggregates)).toHaveBeenCalledWith('all_time', null);
  });

  // ── Error path ────────────────────────────────────────────

  it('returns 500 when query throws', async () => {
    vi.mocked(getAggregates).mockRejectedValue(new Error('db fail'));

    const res = await GET(
      makeRequest({ scope: 'tournament', scope_id: TOURNAMENT_ID, view: 'raw' }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to fetch stats');
  });
});
