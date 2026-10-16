import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAggregateForPokemon: vi.fn(),
  getPlayerAggregatesForPokemon: vi.fn(),
  getTotalGamesInScope: vi.fn(),
}));

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
import { getItemUsageForPokemon } from '@/lib/supabase/queries/teams';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';

const mockGetAggregate = getAggregateForPokemon as ReturnType<typeof vi.fn>;
const mockGetPlayerAggs = getPlayerAggregatesForPokemon as ReturnType<typeof vi.fn>;
const mockGetTotalGames = getTotalGamesInScope as ReturnType<typeof vi.fn>;
const mockGetItems = getItemUsageForPokemon as ReturnType<typeof vi.fn>;
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
      player_id: 'p-1',
    }]);
    mockGetItems.mockResolvedValue([]);

    const [req, ctx] = makeArgs('Garchomp', { player_id: 'p-1' });
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.players).toEqual([]);
    expect(mockGetAggregate).not.toHaveBeenCalled();
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
});
