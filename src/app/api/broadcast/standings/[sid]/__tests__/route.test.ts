import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { AuthError };
});

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: vi.fn(),
  getParticipants: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByTournament: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/ratings', () => ({
  getPlayerRatingsBatch: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/signatures', () => ({
  getPlayerSignaturesBatch: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAggregates: vi.fn(),
}));

vi.mock('@/lib/tournament/season-standings', () => ({
  computeStandingsForSeason: vi.fn(),
}));

vi.mock('@/lib/pkmn/sprites', () => ({
  getSpriteUrl: vi.fn((name: string) => `https://sprites/${name}.png`),
}));

import { GET } from '@/app/api/broadcast/standings/[sid]/route';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import {
  getStagesBySeasonId,
  getParticipants,
} from '@/lib/supabase/queries/tournaments';
import { getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { getPlayerRatingsBatch } from '@/lib/supabase/queries/ratings';
import { getPlayerSignaturesBatch } from '@/lib/supabase/queries/signatures';
import { getAggregates } from '@/lib/supabase/queries/aggregates';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { safeErrorResponse } from '@/lib/api/error-response';

const routeContext = { params: Promise.resolve({ sid: 'season-1' }) };

const mockSeason = {
  id: 'season-1',
  name: 'Summer League 2024',
  season_id: null,
};

const mockTournament = {
  id: 'tourn-1',
  name: 'Swiss Stage',
  season_id: 'season-1',
};

const mockParticipants = [
  { id: 'p1', name: 'Alice', avatar_url: 'https://example.com/alice.png' },
  { id: 'p2', name: 'Bob', avatar_url: null },
];

const mockMatch = {
  id: 'match-1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  player_1_avatar_url: 'https://example.com/alice.png',
  player_2_avatar_url: null,
  winner_id: 'p1',
  winner_name: 'Alice',
  status: 'completed',
  updated_at: '2024-06-15T10:00:00Z',
  games: [
    { id: 'g1', winner_id: 'p1' },
    { id: 'g2', winner_id: 'p1' },
  ],
};

const mockStandings = [
  {
    player_id: 'p1',
    player_name: 'Alice',
    avatar_url: 'https://example.com/alice.png',
    wins: 1,
    losses: 0,
    draws: 0,
    rank: 1,
    game_wins: 2,
    game_losses: 0,
  },
  {
    player_id: 'p2',
    player_name: 'Bob',
    avatar_url: null,
    wins: 0,
    losses: 1,
    draws: 0,
    rank: 2,
    game_wins: 0,
    game_losses: 2,
  },
];

describe('GET /api/broadcast/standings/[sid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns enriched standings for a season', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([mockTournament as never]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([mockMatch as never]);
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue(mockStandings as never);

    const ratingsMap = new Map([
      ['p1', { rating: 1500, rd: 50, wins: 1, losses: 0, draws: 0, peak_rating: 1500 }],
    ]);
    const sigsMap = new Map([
      ['p1', [{ pokemon_name: 'Pikachu', games: 10 }]],
    ]);
    vi.mocked(getPlayerRatingsBatch).mockResolvedValue(ratingsMap as never);
    vi.mocked(getPlayerSignaturesBatch).mockResolvedValue(sigsMap as never);
    vi.mocked(getAggregates).mockResolvedValue([]);

    const request = {} as NextRequest;
    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.season_id).toBe('season-1');
    expect(body.data.league_name).toBe('Summer League 2024');
    expect(body.data.standings).toHaveLength(2);
    expect(body.data.standings[0].rating).toBe(1500);
    expect(body.data.standings[0].signature_pokemon).toBe('Pikachu');
    expect(body.data.standings[0].signature_sprite_url).toBe(
      'https://sprites/Pikachu.png'
    );
    expect(body.data.standings[1].rating).toBeNull();
    expect(body.data.standings[1].signature_pokemon).toBeNull();
    expect(body.data.recent_results).toHaveLength(1);
    expect(body.data.leaders).toBeDefined();
  });

  it('returns 404 when season not found', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(null as never);

    const request = {} as NextRequest;
    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Season not found', code: 'season_not_found' });
  });

  it('returns empty standings when no tournaments in season', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([]);

    const request = {} as NextRequest;
    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.standings).toEqual([]);
    expect(body.data.recent_results).toEqual([]);
    expect(body.data.leaders.most_kos).toBeNull();
    expect(body.data.leaders.best_record).toBeNull();
    expect(body.data.leaders.pokemon_mvp).toBeNull();
  });

  it('computes leaders from aggregates', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([mockTournament as never]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([mockMatch as never]);
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue(mockStandings as never);
    vi.mocked(getPlayerRatingsBatch).mockResolvedValue(new Map() as never);
    vi.mocked(getPlayerSignaturesBatch).mockResolvedValue(new Map() as never);
    vi.mocked(getAggregates).mockResolvedValue([
      {
        pokemon_name: 'Pikachu',
        total_kos_dealt: 15,
        total_brought: 5,
        total_wins: 4,
      },
      {
        pokemon_name: 'Charizard',
        total_kos_dealt: 10,
        total_brought: 3,
        total_wins: 3,
      },
    ] as never);

    const request = {} as NextRequest;
    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(body.data.leaders.most_kos).not.toBeNull();
    expect(body.data.leaders.most_kos.pokemon_name).toBe('Pikachu');
    expect(body.data.leaders.most_kos.kos).toBe(15);
    expect(body.data.leaders.pokemon_mvp).not.toBeNull();
    expect(body.data.leaders.pokemon_mvp.pokemon_name).toBe('Charizard');
    expect(body.data.leaders.best_record).not.toBeNull();
    expect(body.data.leaders.best_record.player_name).toBe('Alice');
  });

  it('sets public cache headers', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([mockTournament as never]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([]);
    vi.mocked(getParticipants).mockResolvedValue([]);
    vi.mocked(computeStandingsForSeason).mockResolvedValue([]);
    vi.mocked(getPlayerRatingsBatch).mockResolvedValue(new Map() as never);
    vi.mocked(getPlayerSignaturesBatch).mockResolvedValue(new Map() as never);
    vi.mocked(getAggregates).mockResolvedValue([]);

    const request = {} as NextRequest;
    const res = await GET(request, routeContext);

    expect(res.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=120'
    );
  });

  it('delegates to safeErrorResponse on unexpected error', async () => {
    vi.mocked(getSeasonById).mockRejectedValue(new Error('DB error'));

    const request = {} as NextRequest;
    await GET(request, routeContext);

    expect(safeErrorResponse).toHaveBeenCalled();
  });
});
