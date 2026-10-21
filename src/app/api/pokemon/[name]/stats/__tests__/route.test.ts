import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAggregateForPokemon: vi.fn(),
  getPlayerAggregatesForPokemon: vi.fn(),
  getTotalGamesInScope: vi.fn(),
}));

// Item usage goes through the tagged public read cache (H9).
vi.mock('@/lib/cache/public-reads', () => ({
  publicReads: { itemUsage: vi.fn() },
}));

// Reads whose cache key is not bounded by real data skip the cache.
vi.mock('@/lib/supabase/queries/teams', () => ({
  getItemUsageForPokemon: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  resolvePlayerNames: vi.fn(),
}));

import { GET } from '../route';
import {
  getAggregateForPokemon,
  getPlayerAggregatesForPokemon,
  getTotalGamesInScope,
} from '@/lib/supabase/queries/aggregates';
import { publicReads } from '@/lib/cache/public-reads';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import { getItemUsageForPokemon } from '@/lib/supabase/queries/teams';

const mockGetAggregate = getAggregateForPokemon as ReturnType<typeof vi.fn>;
const mockGetPlayerAggs = getPlayerAggregatesForPokemon as ReturnType<typeof vi.fn>;
const mockGetTotalGames = getTotalGamesInScope as ReturnType<typeof vi.fn>;
const mockGetItems = publicReads.itemUsage as ReturnType<typeof vi.fn>;
const mockGetItemsUncached = getItemUsageForPokemon as ReturnType<typeof vi.fn>;

const SCOPE_ID = '00000000-0000-4000-8000-0000000000a1';
const PLAYER_ID = '00000000-0000-4000-8000-0000000000b2';
const mockResolveNames = resolvePlayerNames as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeArgs(
  name: string,
  queryParams: Record<string, string> = {},
): [NextRequest, { params: Promise<{ name: string }> }] {
  const url = new URL(`http://localhost:3000/api/pokemon/${encodeURIComponent(name)}/stats`);
  for (const [k, v] of Object.entries(queryParams)) url.searchParams.set(k, v);
  const req = { url: url.toString(), nextUrl: url } as unknown as NextRequest;
  return [req, { params: Promise.resolve({ name }) }];
}

const SAMPLE_AGG = {
  total_appearances: 50,
  total_games: 30,
  total_kos_dealt: 80,
  total_koed: 20,
  total_brought: 25,
  total_led: 10,
  total_wins: 35,
  move_counts: { Earthquake: 40, 'Dragon Claw': 30 },
};

describe('GET /api/pokemon/[name]/stats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns stats for all_time scope (default)', async () => {
    mockGetTotalGames.mockResolvedValue(100);
    mockGetAggregate.mockResolvedValue(SAMPLE_AGG);
    mockGetPlayerAggs.mockResolvedValue([]);
    mockGetItems.mockResolvedValue([]);
    mockResolveNames.mockResolvedValue({});

    const [req, ctx] = makeArgs('Garchomp');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.pokemon_name).toBe('Garchomp');
    expect(json.data.total_appearances).toBe(50);
    expect(json.data.usage_percent).toBe(50); // 50/100 * 100
    expect(json.data.moves).toHaveLength(2);
    expect(json.data.moves[0].name).toBe('Earthquake'); // sorted by count desc
  });

  it('sends null (not an English "Unknown") for an unresolved player name', async () => {
    mockGetTotalGames.mockResolvedValue(100);
    mockGetAggregate.mockResolvedValue(SAMPLE_AGG);
    mockGetPlayerAggs.mockResolvedValue([
      { player_id: 'p1', total_games: 2, total_appearances: 2, total_kos_dealt: 1, total_koed: 0, total_brought: 2, total_led: 1, total_wins: 1 },
      { player_id: 'p2', total_games: 1, total_appearances: 1, total_kos_dealt: 0, total_koed: 1, total_brought: 1, total_led: 0, total_wins: 0 },
    ]);
    mockGetItems.mockResolvedValue([]);
    mockResolveNames.mockResolvedValue({ p1: 'Ash' });

    const [req, ctx] = makeArgs('Garchomp');
    const json = await (await GET(req, ctx)).json();

    expect(json.data.players.map((p: { player_name: string | null }) => p.player_name)).toEqual(['Ash', null]);
  });

  it('returns 400 for invalid scope', async () => {
    const [req, ctx] = makeArgs('Garchomp', { scope: 'invalid' });
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('scope must be');
    expect(json.code).toBe('stats_scope_invalid');
  });

  it('returns 400 when scope_id missing for non-all_time scope', async () => {
    const [req, ctx] = makeArgs('Garchomp', { scope: 'tournament' });
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('scope_id required');
    expect(json.code).toBe('stats_scope_id_required');
  });

  it('returns empty result when no aggregate data exists', async () => {
    mockGetTotalGames.mockResolvedValue(100);
    mockGetAggregate.mockResolvedValue(null);
    mockGetPlayerAggs.mockResolvedValue([]);
    mockGetItems.mockResolvedValue([]);

    const [req, ctx] = makeArgs('Garchomp');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.total_appearances).toBe(0);
    expect(json.data.usage_percent).toBe(0);
  });

  it('filters by player_id when provided', async () => {
    mockGetTotalGames.mockResolvedValue(100);
    mockGetPlayerAggs.mockResolvedValue([{
      ...SAMPLE_AGG,
      player_id: PLAYER_ID,
    }]);
    mockGetItems.mockResolvedValue([]);

    const [req, ctx] = makeArgs('Garchomp', { player_id: PLAYER_ID });
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.players).toEqual([]);
    expect(mockGetAggregate).not.toHaveBeenCalled();
    expect(mockGetItems).toHaveBeenCalledWith('Garchomp', 'all_time', null, PLAYER_ID);
  });

  it('reads item usage through the public read cache with the scope, and sends Cache-Control', async () => {
    mockGetTotalGames.mockResolvedValue(10);
    mockGetAggregate.mockResolvedValue(SAMPLE_AGG);
    mockGetPlayerAggs.mockResolvedValue([]);
    mockGetItems.mockResolvedValue([{ name: 'Choice Scarf', count: 3, usage_percent: 75 }]);
    mockResolveNames.mockResolvedValue({});

    const [req, ctx] = makeArgs('Garchomp', { scope: 'league', scope_id: SCOPE_ID });
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=60, stale-while-revalidate=60');
    expect(json.data.items).toEqual([{ name: 'Choice Scarf', count: 3, usage_percent: 75 }]);
    expect(mockGetItems).toHaveBeenCalledWith('Garchomp', 'league', SCOPE_ID, null);
  });

  it('ignores a scope_id on all_time (one cache entry per species)', async () => {
    mockGetTotalGames.mockResolvedValue(10);
    mockGetAggregate.mockResolvedValue(null);
    mockGetPlayerAggs.mockResolvedValue([]);
    mockGetItems.mockResolvedValue([]);

    const [req, ctx] = makeArgs('Garchomp', { scope: 'all_time', scope_id: SCOPE_ID });
    const res = await GET(req, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=60');
    expect(mockGetItems).toHaveBeenCalledWith('Garchomp', 'all_time', null, null);
    expect(mockGetTotalGames).toHaveBeenCalledWith('all_time', null);
  });

  it('does not cache item usage for a player without aggregate rows (unbounded player ids)', async () => {
    mockGetTotalGames.mockResolvedValue(100);
    mockGetPlayerAggs.mockResolvedValue([]);
    mockGetItemsUncached.mockResolvedValue([]);

    const [req, ctx] = makeArgs('Garchomp', { player_id: PLAYER_ID });
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.total_appearances).toBe(0);
    expect(mockGetItems).not.toHaveBeenCalled();
    expect(mockGetItemsUncached).toHaveBeenCalledWith('Garchomp', 'all_time', null, PLAYER_ID);
  });

  it('does not cache item usage for a scope id without aggregate rows (unbounded scope ids)', async () => {
    mockGetTotalGames.mockResolvedValue(0);
    mockGetAggregate.mockResolvedValue(null);
    mockGetPlayerAggs.mockResolvedValue([]);
    mockGetItemsUncached.mockResolvedValue([]);

    const [req, ctx] = makeArgs('Garchomp', { scope: 'tournament', scope_id: SCOPE_ID });
    const res = await GET(req, ctx);

    expect(res.status).toBe(200);
    expect(mockGetItems).not.toHaveBeenCalled();
    expect(mockGetItemsUncached).toHaveBeenCalledWith('Garchomp', 'tournament', SCOPE_ID, undefined);
  });

  it('returns 500 when the uncached item usage read fails (no silent empty items)', async () => {
    mockGetTotalGames.mockResolvedValue(100);
    mockGetPlayerAggs.mockResolvedValue([]);
    mockGetItemsUncached.mockRejectedValue(new Error('rpc failed'));

    const [req, ctx] = makeArgs('Garchomp', { player_id: PLAYER_ID });
    const res = await GET(req, ctx);

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to fetch Pokemon stats');
  });

  it('returns 400 stats_scope_id_invalid for a scope_id that is not a UUID, without a query', async () => {
    const [req, ctx] = makeArgs('Garchomp', { scope: 'tournament', scope_id: 'not-a-uuid' });
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ success: false, error: 'scope_id must be a valid UUID', code: 'stats_scope_id_invalid' });
    expect(mockGetTotalGames).not.toHaveBeenCalled();
    expect(mockGetItems).not.toHaveBeenCalled();
  });

  it('returns 400 stats_player_id_invalid for a player_id that is not a UUID, without a query', async () => {
    const [req, ctx] = makeArgs('Garchomp', { player_id: 'p-1' });
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ success: false, error: 'player_id must be a valid UUID', code: 'stats_player_id_invalid' });
    expect(mockGetTotalGames).not.toHaveBeenCalled();
    expect(mockGetItems).not.toHaveBeenCalled();
  });

  it('returns 500 when the item usage read fails (no silent empty items)', async () => {
    mockGetTotalGames.mockResolvedValue(10);
    mockGetAggregate.mockResolvedValue(SAMPLE_AGG);
    mockGetPlayerAggs.mockResolvedValue([]);
    mockGetItems.mockRejectedValue(new Error('rpc failed'));

    const [req, ctx] = makeArgs('Garchomp');
    const res = await GET(req, ctx);

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to fetch Pokemon stats');
  });

  it('returns 400 stats_pokemon_name_invalid for malformed percent-encoding, without a query', async () => {
    const url = new URL('http://localhost:3000/api/pokemon/x/stats');
    const req = { url: url.toString(), nextUrl: url } as unknown as NextRequest;

    const res = await GET(req, { params: Promise.resolve({ name: '%E0%A4%A' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('stats_pokemon_name_invalid');
    expect(mockGetTotalGames).not.toHaveBeenCalled();
    expect(mockGetItems).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    mockGetTotalGames.mockRejectedValue(new Error('DB error'));

    const [req, ctx] = makeArgs('Garchomp');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch Pokemon stats');
  });
  // ── Species resolution before any read (H9) ──────────────────────────

  it('rejects an unknown species with 404 pokemon_not_found and reads nothing', async () => {
    const [req, ctx] = makeArgs('Notamon');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.code).toBe('pokemon_not_found');
    expect(json.params).toEqual({ pokemon: 'Notamon' });
    expect(mockGetTotalGames).not.toHaveBeenCalled();
    expect(mockGetAggregate).not.toHaveBeenCalled();
    expect(mockGetPlayerAggs).not.toHaveBeenCalled();
    expect(mockGetItems).not.toHaveBeenCalled();
  });

  it('reads and caches by the canonical species name, not the raw path segment', async () => {
    mockGetTotalGames.mockResolvedValue(10);
    mockGetAggregate.mockResolvedValue(null);
    mockGetPlayerAggs.mockResolvedValue([]);
    mockGetItems.mockResolvedValue([]);

    const [req, ctx] = makeArgs('rotomwash');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.pokemon_name).toBe('Rotom-Wash');
    expect(mockGetAggregate).toHaveBeenCalledWith('Rotom-Wash', 'all_time', null);
    expect(mockGetItems).toHaveBeenCalledWith('Rotom-Wash', 'all_time', null, null);
  });
});
