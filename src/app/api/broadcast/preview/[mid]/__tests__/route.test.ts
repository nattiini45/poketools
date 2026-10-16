import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
  getH2HBetweenPlayers: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/signatures', () => ({
  getPlayerSignatures: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/ratings', () => ({
  getPlayerRating: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/streaks', () => ({
  getPlayerStreaks: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/achievements', () => ({
  getPlayerAchievements: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/teams', () => ({
  getPlayerTeamForTournament: vi.fn(),
}));

vi.mock('@/lib/team/visibility', () => ({
  filterTeamPokemonForBroadcast: vi.fn(),
}));

vi.mock('@/lib/pkmn/sprites', () => ({
  getSpriteUrl: vi.fn((species: string) => `https://sprites.test/${species}.png`),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

import { GET } from '../route';
import { getMatchById, getH2HBetweenPlayers } from '@/lib/supabase/queries/matches';
import { getPlayerSignatures } from '@/lib/supabase/queries/signatures';
import { getPlayerRating } from '@/lib/supabase/queries/ratings';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { getPlayerAchievements } from '@/lib/supabase/queries/achievements';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getPlayerTeamForTournament } from '@/lib/supabase/queries/teams';
import { filterTeamPokemonForBroadcast } from '@/lib/team/visibility';
import { safeErrorResponse } from '@/lib/api/error-response';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

// ── Test data ─────────────────────────────────────────────────────────

const mockMatch = {
  id: 'match-1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  player_1_avatar_url: null,
  player_2_avatar_url: null,
  tournament_id: 't1',
  round_id: 'r1',
  winner_id: null,
};

const mockRating = {
  rating: 1500,
  rd: 100,
  peak_rating: 1600,
  wins: 5,
  losses: 2,
  draws: 0,
};

function setupDefaultMocks() {
  vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
  vi.mocked(getPlayerSignatures).mockResolvedValue({ signatures: [] } as never);
  vi.mocked(getPlayerRating).mockResolvedValue(mockRating as never);
  vi.mocked(getPlayerStreaks).mockResolvedValue([] as never);
  vi.mocked(getPlayerAchievements).mockResolvedValue([] as never);
  vi.mocked(getPlayerTeamForTournament).mockResolvedValue(null as never);
  vi.mocked(getTournamentById).mockResolvedValue({
    id: 't1',
    name: 'Tournament One',
    season_id: 's1',
    best_of_default: 3,
  } as never);
  vi.mocked(getRoundById).mockResolvedValue({
    id: 'r1',
    name: 'Round 1',
    best_of: 3,
  } as never);
  vi.mocked(getSeasonById).mockResolvedValue({ id: 's1', name: 'Season One' } as never);
  vi.mocked(filterTeamPokemonForBroadcast).mockResolvedValue([] as never);
  vi.mocked(getH2HBetweenPlayers).mockResolvedValue([] as never);
}

describe('GET /api/broadcast/preview/[mid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when match is not found', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null);

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'match-1' }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Match not found');
    expect(json.code).toBe('match_not_found');
  });

  it('returns match preview data on happy path', async () => {
    setupDefaultMocks();

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'match-1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.match_id).toBe('match-1');
    expect(json.data.player1.id).toBe('p1');
    expect(json.data.player1.name).toBe('Alice');
    expect(json.data.player2.id).toBe('p2');
    expect(json.data.player2.name).toBe('Bob');
    expect(json.data.tournament_name).toBe('Tournament One');
    expect(json.data.round_name).toBe('Round 1');
    expect(json.data.season_name).toBe('Season One');
    expect(json.data.best_of).toBe(3);
  });

  it('enriches player info with ratings and record', async () => {
    setupDefaultMocks();

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'match-1' }) });
    const json = await res.json();

    expect(json.data.player1.record).toEqual({ wins: 5, losses: 2, draws: 0 });
    expect(json.data.player1.rating).toEqual({
      rating: 1500,
      rd: 100,
      peak: 1600,
    });
  });

  it('handles null rating gracefully', async () => {
    setupDefaultMocks();
    vi.mocked(getPlayerRating).mockResolvedValue(null as never);

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'match-1' }) });
    const json = await res.json();

    expect(json.data.player1.record).toEqual({ wins: 0, losses: 0, draws: 0 });
    expect(json.data.player1.rating).toBeNull();
  });

  it('includes team rosters when visibility filter returns pokemon', async () => {
    setupDefaultMocks();
    vi.mocked(filterTeamPokemonForBroadcast).mockResolvedValue([
      { species: 'Garchomp', item: 'Choice Scarf', ability: 'Rough Skin', moves: ['Earthquake', 'Dragon Claw'] },
    ] as never);

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'match-1' }) });
    const json = await res.json();

    expect(json.data.player1_team).toHaveLength(1);
    expect(json.data.player1_team[0].pokemon_name).toBe('Garchomp');
    expect(json.data.player1_team[0].sprite_url).toContain('Garchomp');
    expect(json.data.player1_team[0].item).toBe('Choice Scarf');
    expect(json.data.player1_team[0].ability).toBe('Rough Skin');
    expect(json.data.player1_team[0].moves_used).toEqual(['Earthquake', 'Dragon Claw']);
  });

  it('returns H2H record when prior matches exist', async () => {
    setupDefaultMocks();
    vi.mocked(getH2HBetweenPlayers).mockResolvedValue([
      { id: 'm1', winner_id: 'p1' },
      { id: 'm2', winner_id: 'p2' },
      { id: 'm3', winner_id: 'p1' },
    ] as never);

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'match-1' }) });
    const json = await res.json();

    expect(json.data.h2h).toEqual({
      player1_id: 'p1',
      player2_id: 'p2',
      player1_wins: 2,
      player2_wins: 1,
      total_matches: 3,
    });
  });

  it('returns null H2H when no prior matches', async () => {
    setupDefaultMocks();
    vi.mocked(getH2HBetweenPlayers).mockResolvedValue([] as never);

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'match-1' }) });
    const json = await res.json();

    expect(json.data.h2h).toBeNull();
  });

  it('handles missing season_id on tournament gracefully', async () => {
    setupDefaultMocks();
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 't1',
      name: 'Tournament One',
      season_id: null,
      best_of_default: 1,
    } as never);

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'match-1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.season_name).toBe('');
    expect(getSeasonById).not.toHaveBeenCalled();
  });

  it('sets Cache-Control header', async () => {
    setupDefaultMocks();

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'match-1' }) });

    expect(res.headers.get('Cache-Control')).toBe(
      'public, s-maxage=30, stale-while-revalidate=60',
    );
  });

  it('delegates to safeErrorResponse on thrown error', async () => {
    vi.mocked(getMatchById).mockRejectedValue(new Error('DB down'));

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'match-1' }) });

    expect(res.status).toBe(500);
    expect(safeErrorResponse).toHaveBeenCalled();
  });

  it('uses tournament best_of_default when round best_of is null', async () => {
    setupDefaultMocks();
    vi.mocked(getRoundById).mockResolvedValue({
      id: 'r1',
      name: 'Round 1',
      best_of: null,
    } as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 't1',
      name: 'Tournament One',
      season_id: 's1',
      best_of_default: 5,
    } as never);

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'match-1' }) });
    const json = await res.json();

    expect(json.data.best_of).toBe(5);
  });
});
