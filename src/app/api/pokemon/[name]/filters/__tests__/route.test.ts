import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAggregateScopesForPokemon: vi.fn(),
  getPlayerIdsForPokemon: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  listSeasonsByIds: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  listTournamentsByIds: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  getPlayersByIds: vi.fn(),
}));

import { GET } from '../route';
import { getAggregateScopesForPokemon, getPlayerIdsForPokemon } from '@/lib/supabase/queries/aggregates';
import { listSeasonsByIds } from '@/lib/supabase/queries/seasons';
import { listTournamentsByIds } from '@/lib/supabase/queries/tournaments';
import { getPlayersByIds } from '@/lib/supabase/queries/players';

const mockGetScopes = getAggregateScopesForPokemon as ReturnType<typeof vi.fn>;
const mockGetPlayerIds = getPlayerIdsForPokemon as ReturnType<typeof vi.fn>;
const mockListSeasons = listSeasonsByIds as ReturnType<typeof vi.fn>;
const mockListTournaments = listTournamentsByIds as ReturnType<typeof vi.fn>;
const mockGetPlayers = getPlayersByIds as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeArgs(name: string): [NextRequest, { params: Promise<{ name: string }> }] {
  const url = new URL(`http://localhost:3000/api/pokemon/${encodeURIComponent(name)}/filters`);
  const req = { url: url.toString(), nextUrl: url } as unknown as NextRequest;
  return [req, { params: Promise.resolve({ name }) }];
}

describe('GET /api/pokemon/[name]/filters', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns filter options for a pokemon with data', async () => {
    mockGetScopes.mockResolvedValue([
      { scope_type: 'league', scope_id: 'league-1' },
      { scope_type: 'tournament', scope_id: 'tourney-1' },
    ]);
    mockGetPlayerIds.mockResolvedValue(['player-1', 'player-2']);
    mockListSeasons.mockResolvedValue([{ id: 'league-1', name: 'Season 1' }]);
    mockListTournaments.mockResolvedValue([{ id: 'tourney-1', name: 'Cup 1', season_id: null }]);
    mockGetPlayers.mockResolvedValue(
      new Map([
        ['player-1', { id: 'player-1', name: 'Alice' }],
        ['player-2', { id: 'player-2', name: 'Bob' }],
      ]),
    );

    const [req, ctx] = makeArgs('Garchomp');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.leagues).toEqual([{ id: 'league-1', name: 'Season 1' }]);
    expect(json.data.tournaments).toEqual([{ id: 'tourney-1', name: 'Cup 1' }]);
    expect(json.data.players).toHaveLength(2);
    expect(json.data.players[0].name).toBe('Alice'); // sorted alphabetically
  });

  it('excludes tournaments that are stages of a league', async () => {
    mockGetScopes.mockResolvedValue([
      { scope_type: 'tournament', scope_id: 't-1' },
    ]);
    mockGetPlayerIds.mockResolvedValue([]);
    mockListSeasons.mockResolvedValue([]);
    mockListTournaments.mockResolvedValue([
      { id: 't-1', name: 'Stage 1', season_id: 'some-league' },
    ]);
    mockGetPlayers.mockResolvedValue(new Map());

    const [req, ctx] = makeArgs('Garchomp');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(json.data.tournaments).toEqual([]);
  });

  it('handles empty scopes gracefully', async () => {
    mockGetScopes.mockResolvedValue([]);
    mockGetPlayerIds.mockResolvedValue([]);
    mockGetPlayers.mockResolvedValue(new Map());

    const [req, ctx] = makeArgs('Garchomp');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.leagues).toEqual([]);
    expect(json.data.tournaments).toEqual([]);
    expect(json.data.players).toEqual([]);
    // Should not call season/tournament fetchers with empty arrays
    expect(mockListSeasons).not.toHaveBeenCalled();
    expect(mockListTournaments).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    mockGetScopes.mockRejectedValue(new Error('DB down'));

    const [req, ctx] = makeArgs('Garchomp');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch filter options');
  });
});
