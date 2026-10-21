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
  getPlayerTeamForMatch: vi.fn(),
  getTeamByShareToken: vi.fn(),
  getTeamVisibilityFacts: vi.fn(),
}));

// The real spec §7 decision runs (`@/lib/team/visibility` is NOT mocked).

vi.mock('@/lib/pkmn/sprite-styles', () => ({
  siteSpriteUrl: vi.fn((species: string) => `https://sprites.test/${species}.png`),
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
import { getPlayerTeamForMatch } from '@/lib/supabase/queries/teams';
import { safeErrorResponse } from '@/lib/api/error-response';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

// ── Test data ─────────────────────────────────────────────────────────

const mockMatch = {
  id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  player_1_id: 'p1',
  player_2_id: 'p2',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  player_1_avatar_url: null,
  player_2_avatar_url: null,
  tournament_id: 't1',
  round_id: 'r1',
  winner_id: null,
  status: 'scheduled',
};

const GARCHOMP_SET = {
  name: '',
  species: 'Garchomp',
  gender: '',
  item: 'Choice Scarf',
  ability: 'Rough Skin',
  evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: 'Jolly',
  level: 100,
  moves: ['Earthquake', 'Dragon Claw'],
};

function teamOf(playerId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `team-${playerId}`,
    player_id: playerId,
    name: '',
    tournament_id: 't1',
    season_id: null,
    match_id: null,
    pokemon: [GARCHOMP_SET],
    import_source: 'manual',
    locked: false,
    is_draft_team: false,
    draft_pool_id: null,
    library_published_at: null,
    library_title: null,
    library_description: null,
    library_tags: null,
    forked_from_team_id: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

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
  vi.mocked(getPlayerTeamForMatch).mockResolvedValue(null as never);
  vi.mocked(getTournamentById).mockResolvedValue({
    id: 't1',
    name: 'Tournament One',
    season_id: 's1',
    best_of_default: 3,
    team_visibility: 'hidden_until_match',
  } as never);
  vi.mocked(getRoundById).mockResolvedValue({
    id: 'r1',
    name: 'Round 1',
    best_of: 3,
  } as never);
  vi.mocked(getSeasonById).mockResolvedValue({ id: 's1', name: 'Season One' } as never);
  vi.mocked(getH2HBetweenPlayers).mockResolvedValue([] as never);
}

describe('GET /api/broadcast/preview/[mid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when match is not found', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null);

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Match not found');
    expect(json.code).toBe('match_not_found');
  });

  it('returns match preview data on happy path', async () => {
    setupDefaultMocks();

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.match_id).toBe('ffffffff-ffff-4fff-8fff-ffffffffffff');
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
    const res = await GET(req, { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });
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
    const res = await GET(req, { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });
    const json = await res.json();

    expect(json.data.player1.record).toEqual({ wins: 0, losses: 0, draws: 0 });
    expect(json.data.player1.rating).toBeNull();
  });

  it('reads each roster for THIS match (match-linked row, else planned row)', async () => {
    setupDefaultMocks();

    await GET(makeRequest(), { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });

    expect(getPlayerTeamForMatch).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', tournament_id: 't1' }));
    expect(getPlayerTeamForMatch).toHaveBeenCalledWith('p2', expect.objectContaining({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', tournament_id: 't1' }));
  });

  it('hides both planned rosters of an upcoming match from an anonymous visitor (H3)', async () => {
    setupDefaultMocks();
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId: string) => teamOf(playerId) as never);

    const res = await GET(makeRequest(), { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.player1_team).toHaveLength(6);
    expect(json.data.player2_team).toHaveLength(6);
    for (const slot of [...json.data.player1_team, ...json.data.player2_team]) {
      expect(slot.pokemon_name).toBe('hidden');
      expect(slot.item).toBe('');
      expect(slot.moves_used).toEqual([]);
    }
    expect(JSON.stringify(json)).not.toContain('Garchomp');
    expect(JSON.stringify(json)).not.toContain('Choice Scarf');
  });

  it('hides an in-progress match roster too', async () => {
    setupDefaultMocks();
    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, status: 'in_progress' } as never);
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId: string) => teamOf(playerId) as never);

    const res = await GET(makeRequest(), { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });

    expect(JSON.stringify(await res.json())).not.toContain('Garchomp');
  });

  it('shows rosters of an upcoming match when the tournament is always_public', async () => {
    setupDefaultMocks();
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 't1',
      name: 'Tournament One',
      season_id: 's1',
      best_of_default: 3,
      team_visibility: 'always_public',
    } as never);
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId: string) => teamOf(playerId) as never);

    const res = await GET(makeRequest(), { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });
    const json = await res.json();

    expect(json.data.player1_team[0].pokemon_name).toBe('Garchomp');
    expect(json.data.player2_team[0].pokemon_name).toBe('Garchomp');
  });

  it('includes team rosters once the match is completed', async () => {
    setupDefaultMocks();
    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, status: 'completed' } as never);
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId: string) =>
      (playerId === 'p1' ? teamOf(playerId, { match_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) : null) as never
    );

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });
    const json = await res.json();

    expect(json.data.player1_team).toHaveLength(1);
    expect(json.data.player1_team[0].pokemon_name).toBe('Garchomp');
    expect(json.data.player1_team[0].sprite_url).toContain('Garchomp');
    expect(json.data.player1_team[0].item).toBe('Choice Scarf');
    expect(json.data.player1_team[0].ability).toBe('Rough Skin');
    expect(json.data.player1_team[0].moves_used).toEqual(['Earthquake', 'Dragon Claw']);
    expect(json.data.player2_team).toEqual([]);
  });

  it('returns 500 (not an empty roster) when the team read fails', async () => {
    setupDefaultMocks();
    vi.mocked(getPlayerTeamForMatch).mockRejectedValue(new Error('teams down'));

    const res = await GET(makeRequest(), { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });

    expect(res.status).toBe(500);
    expect(safeErrorResponse).toHaveBeenCalled();
  });

  it('returns H2H record when prior matches exist', async () => {
    setupDefaultMocks();
    vi.mocked(getH2HBetweenPlayers).mockResolvedValue([
      { id: 'm1', winner_id: 'p1' },
      { id: 'm2', winner_id: 'p2' },
      { id: 'm3', winner_id: 'p1' },
    ] as never);

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });
    const json = await res.json();

    expect(json.data.h2h).toEqual({
      player1_id: 'p1',
      player2_id: 'p2',
      player1_wins: 2,
      player2_wins: 1,
      total_matches: 3,
    });
  });

  it('returns 500 (not a null H2H) when the head-to-head read fails', async () => {
    setupDefaultMocks();
    vi.mocked(getH2HBetweenPlayers).mockRejectedValue(new Error('h2h down'));

    const res = await GET(makeRequest(), { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });

    expect(res.status).toBe(500);
    expect(safeErrorResponse).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'h2h down' }),
      'Failed to fetch match preview',
    );
  });

  it('returns null H2H when no prior matches', async () => {
    setupDefaultMocks();
    vi.mocked(getH2HBetweenPlayers).mockResolvedValue([] as never);

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });
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
    const res = await GET(req, { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.season_name).toBe('');
    expect(getSeasonById).not.toHaveBeenCalled();
  });

  it('sets Cache-Control header', async () => {
    setupDefaultMocks();

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });

    expect(res.headers.get('Cache-Control')).toBe(
      'public, s-maxage=30, stale-while-revalidate=60',
    );
  });

  it('delegates to safeErrorResponse on thrown error', async () => {
    vi.mocked(getMatchById).mockRejectedValue(new Error('DB down'));

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });

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
    const res = await GET(req, { params: makeParams({ mid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });
    const json = await res.json();

    expect(json.data.best_of).toBe(5);
  });
});
