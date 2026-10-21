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

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
  getH2HBetweenPlayers: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/broadcast-moments', () => ({
  getRecentMomentsByMatch: vi.fn(),
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

vi.mock('@/lib/supabase/queries/match-analyses', () => ({
  getMatchAnalysis: vi.fn(),
}));

vi.mock('@/lib/match/aggregation', () => ({
  computePokemonScore: vi.fn(),
}));

vi.mock('@/lib/pkmn/sprite-styles', () => ({
  siteSpriteUrl: vi.fn((name: string) => `https://sprites/${name}.png`),
}));

import { GET } from '@/app/api/broadcast/state/[mid]/route';
import { getMatchById, getH2HBetweenPlayers } from '@/lib/supabase/queries/matches';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getRecentMomentsByMatch } from '@/lib/supabase/queries/broadcast-moments';
import { getPlayerSignatures } from '@/lib/supabase/queries/signatures';
import { getPlayerRating } from '@/lib/supabase/queries/ratings';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { getPlayerAchievements } from '@/lib/supabase/queries/achievements';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { computePokemonScore } from '@/lib/match/aggregation';
import { getMatchAnalysis } from '@/lib/supabase/queries/match-analyses';
import { safeErrorResponse } from '@/lib/api/error-response';

const mockMatch = {
  id: '33333333-3333-4333-8333-333333333333',
  tournament_id: 'tourn-1',
  round_id: 'round-1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  player_1_avatar_url: 'https://example.com/alice.png',
  player_2_avatar_url: 'https://example.com/bob.png',
  status: 'in_progress',
  winner_id: null,
  winner_name: null,
  games: [
    {
      id: 'game-1',
      game_number: 1,
      winner_id: 'p1',
      replay_url: null,
    },
  ],
};

const routeContext = { params: Promise.resolve({ mid: '33333333-3333-4333-8333-333333333333' }) };

describe('GET /api/broadcast/state/[mid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMatchAnalysis).mockResolvedValue(null);
  });

  it('returns slim broadcast state (no enrich)', async () => {
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({
      'game-1': [
        {
          id: 'stat-1',
          game_id: 'game-1',
          player_id: 'p1',
          pokemon_name: 'Pikachu',
          was_brought: true,
          was_lead: true,
          was_koed: false,
          kos_dealt: 2,
          moves_used: [],
          turns_active: 5,
        },
        {
          id: 'stat-2',
          game_id: 'game-1',
          player_id: 'p2',
          pokemon_name: 'Charizard',
          was_brought: true,
          was_lead: true,
          was_koed: true,
          kos_dealt: 0,
          moves_used: [],
          turns_active: 3,
        },
      ],
    } as never);
    vi.mocked(getRecentMomentsByMatch).mockResolvedValue([]);

    const url = new URL('http://localhost:3000/api/broadcast/state/33333333-3333-4333-8333-333333333333');
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.match_id).toBe('33333333-3333-4333-8333-333333333333');
    expect(body.data.series_score).toEqual({ player1: 1, player2: 0 });
    expect(body.data.player1.name).toBe('Alice');
    expect(body.data.player2.name).toBe('Bob');
    expect(body.data.current_game).not.toBeNull();
    expect(body.data.current_game.game_number).toBe(1);
    expect(body.data.current_game.player1_kos).toBe(2);
    expect(body.data.current_game.player2_kos).toBe(0);
    expect(body.data.match_status).toBe('in_progress');
    expect(getMatchById).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333');
  });

  it('returns null current_game when no games exist', async () => {
    vi.mocked(getMatchById).mockResolvedValue({
      ...mockMatch,
      games: [],
    } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);
    vi.mocked(getRecentMomentsByMatch).mockResolvedValue([]);

    const url = new URL('http://localhost:3000/api/broadcast/state/33333333-3333-4333-8333-333333333333');
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.current_game).toBeNull();
    expect(body.data.series_score).toEqual({ player1: 0, player2: 0 });
  });

  it('returns 404 when match not found', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null as never);

    const url = new URL('http://localhost:3000/api/broadcast/state/nonexistent');
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Match not found', code: 'match_not_found' });
  });

  it('delegates to safeErrorResponse on unexpected error', async () => {
    vi.mocked(getMatchById).mockRejectedValue(new Error('DB timeout'));

    const url = new URL('http://localhost:3000/api/broadcast/state/33333333-3333-4333-8333-333333333333');
    const request = { nextUrl: url } as unknown as NextRequest;

    await GET(request, routeContext);

    expect(safeErrorResponse).toHaveBeenCalled();
  });

  it('sets cache headers on slim response', async () => {
    vi.mocked(getMatchById).mockResolvedValue({
      ...mockMatch,
      games: [],
    } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);
    vi.mocked(getRecentMomentsByMatch).mockResolvedValue([]);

    const url = new URL('http://localhost:3000/api/broadcast/state/33333333-3333-4333-8333-333333333333');
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request, routeContext);

    expect(res.headers.get('Cache-Control')).toBe(
      'public, s-maxage=2, stale-while-revalidate=5'
    );
  });

  /* ── Enriched state tests (lines 116-337) ────────────────────── */

  it('returns enriched state when enrich=true', async () => {
    vi.mocked(getMatchById).mockResolvedValue({
      ...mockMatch,
      games: [
        { id: 'game-1', game_number: 1, winner_id: 'p1', replay_url: null },
      ],
    } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({
      'game-1': [
        { id: 's1', game_id: 'game-1', player_id: 'p1', pokemon_name: 'Pikachu', was_brought: true, was_lead: true, was_koed: false, kos_dealt: 2, moves_used: [], turns_active: 5 },
        { id: 's2', game_id: 'game-1', player_id: 'p2', pokemon_name: 'Charizard', was_brought: true, was_lead: true, was_koed: true, kos_dealt: 0, moves_used: [], turns_active: 3 },
      ],
    } as never);
    vi.mocked(getRecentMomentsByMatch).mockResolvedValue([]);

    vi.mocked(getPlayerSignatures).mockResolvedValue({ signatures: ['Dragon Master'] } as never);
    vi.mocked(getPlayerRating).mockResolvedValue({
      rating: 1500, rd: 50, peak_rating: 1600, wins: 10, losses: 5, draws: 1,
    } as never);
    vi.mocked(getPlayerStreaks).mockResolvedValue([{ type: 'win', count: 3 }] as never);
    vi.mocked(getPlayerAchievements).mockResolvedValue([{ id: 'ach-1', name: 'First Win' }] as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourn-1', name: 'Example League Season 5', season_id: 'season-1',
    } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', name: 'Round 1' } as never);
    vi.mocked(getSeasonById).mockResolvedValue({ id: 'season-1', name: 'Season 5' } as never);
    vi.mocked(getH2HBetweenPlayers).mockResolvedValue([]);
    vi.mocked(computePokemonScore).mockReturnValue({ p1Score: 5, p2Score: 3 } as never);

    const url = new URL('http://localhost:3000/api/broadcast/state/33333333-3333-4333-8333-333333333333?enrich=true');
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.enriched_player1).toBeDefined();
    expect(body.data.enriched_player2).toBeDefined();
    expect(body.data.enriched_player1.name).toBe('Alice');
    expect(body.data.enriched_player1.rating).toEqual({ rating: 1500, rd: 50, peak: 1600 });
    expect(body.data.enriched_player1.record).toEqual({ wins: 10, losses: 5, draws: 1 });
    expect(body.data.tournament_name).toBe('Example League Season 5');
    expect(body.data.round_name).toBe('Round 1');
    expect(body.data.season_name).toBe('Season 5');
    expect(body.data.pokemon_score).toEqual({ p1: 5, p2: 3 });
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=5, stale-while-revalidate=10');
  });

  it('answers a failed match-analysis read through safeErrorResponse, not as "no analysis"', async () => {
    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, games: [] } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);
    vi.mocked(getRecentMomentsByMatch).mockResolvedValue([]);
    vi.mocked(getPlayerSignatures).mockResolvedValue({ signatures: [] } as never);
    vi.mocked(getPlayerRating).mockResolvedValue(null);
    vi.mocked(getPlayerStreaks).mockResolvedValue([] as never);
    vi.mocked(getPlayerAchievements).mockResolvedValue([] as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: 'tourn-1', name: 'T', season_id: null } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', name: 'R1' } as never);
    vi.mocked(getH2HBetweenPlayers).mockResolvedValue([]);
    vi.mocked(computePokemonScore).mockReturnValue({ p1Score: 0, p2Score: 0 } as never);
    const dbError = new Error('analysis read failed');
    vi.mocked(getMatchAnalysis).mockRejectedValueOnce(dbError);

    const url = new URL('http://localhost:3000/api/broadcast/state/33333333-3333-4333-8333-333333333333?enrich=true');
    const res = await GET({ nextUrl: url } as unknown as NextRequest, routeContext);

    expect(res.status).toBe(500);
    expect(safeErrorResponse).toHaveBeenCalledWith(dbError, 'Failed to fetch broadcast state');
  });

  it('handles tournament with no season_id in enriched state', async () => {
    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, games: [] } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);
    vi.mocked(getRecentMomentsByMatch).mockResolvedValue([]);

    vi.mocked(getPlayerSignatures).mockResolvedValue({ signatures: [] } as never);
    vi.mocked(getPlayerRating).mockResolvedValue(null);
    vi.mocked(getPlayerStreaks).mockResolvedValue([] as never);
    vi.mocked(getPlayerAchievements).mockResolvedValue([] as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourn-1', name: 'Example League', season_id: null,
    } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', name: 'R1' } as never);
    vi.mocked(getH2HBetweenPlayers).mockResolvedValue([]);
    vi.mocked(computePokemonScore).mockReturnValue({ p1Score: 0, p2Score: 0 } as never);

    const url = new URL('http://localhost:3000/api/broadcast/state/33333333-3333-4333-8333-333333333333?enrich=true');
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(body.data.season_name).toBe('');
    expect(vi.mocked(getSeasonById)).not.toHaveBeenCalled();
  });

  it('handles null player rating gracefully', async () => {
    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, games: [] } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);
    vi.mocked(getRecentMomentsByMatch).mockResolvedValue([]);

    vi.mocked(getPlayerSignatures).mockResolvedValue({ signatures: [] } as never);
    vi.mocked(getPlayerRating).mockResolvedValue(null);
    vi.mocked(getPlayerStreaks).mockResolvedValue([] as never);
    vi.mocked(getPlayerAchievements).mockResolvedValue([] as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourn-1', name: 'Example League', season_id: 's1',
    } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', name: 'R1' } as never);
    vi.mocked(getSeasonById).mockResolvedValue({ id: 's1', name: 'S1' } as never);
    vi.mocked(getH2HBetweenPlayers).mockResolvedValue([]);
    vi.mocked(computePokemonScore).mockReturnValue({ p1Score: 0, p2Score: 0 } as never);

    const url = new URL('http://localhost:3000/api/broadcast/state/33333333-3333-4333-8333-333333333333?enrich=true');
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(body.data.enriched_player1.rating).toBeNull();
    expect(body.data.enriched_player1.record).toEqual({ wins: 0, losses: 0, draws: 0 });
  });

  it('builds H2H record from previous matches', async () => {
    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, games: [] } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);
    vi.mocked(getRecentMomentsByMatch).mockResolvedValue([]);

    vi.mocked(getPlayerSignatures).mockResolvedValue({ signatures: [] } as never);
    vi.mocked(getPlayerRating).mockResolvedValue(null);
    vi.mocked(getPlayerStreaks).mockResolvedValue([] as never);
    vi.mocked(getPlayerAchievements).mockResolvedValue([] as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourn-1', name: 'Example League', season_id: null,
    } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', name: 'R1' } as never);
    vi.mocked(computePokemonScore).mockReturnValue({ p1Score: 0, p2Score: 0 } as never);
    vi.mocked(getH2HBetweenPlayers).mockResolvedValue([
      { id: 'prev-1', winner_id: 'p1', player_1_id: 'p1', player_2_id: 'p2', winner_name: 'Alice', date_played: '2025-12-01', updated_at: '2025-12-01', games: [{ winner_id: 'p1' }] },
      { id: 'prev-2', winner_id: 'p2', player_1_id: 'p1', player_2_id: 'p2', winner_name: 'Bob', date_played: '2025-11-01', updated_at: '2025-11-01', games: [{ winner_id: 'p2' }] },
    ] as never);

    const url = new URL('http://localhost:3000/api/broadcast/state/33333333-3333-4333-8333-333333333333?enrich=true');
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(body.data.h2h).toEqual({
      player1_id: 'p1',
      player2_id: 'p2',
      player1_wins: 1,
      player2_wins: 1,
      total_matches: 2,
    });
    // Timeline excludes current match; sorted newest first
    expect(body.data.h2h_matches).toHaveLength(2);
    expect(body.data.h2h_matches[0].match_id).toBe('prev-1');
    expect(body.data.h2h_matches[0]).toMatchObject({ winner_name: 'Alice', draw: false });
  });

  it('flags a past H2H match without a winner as a draw and keeps the English label', async () => {
    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, games: [] } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);
    vi.mocked(getRecentMomentsByMatch).mockResolvedValue([]);

    vi.mocked(getPlayerSignatures).mockResolvedValue({ signatures: [] } as never);
    vi.mocked(getPlayerRating).mockResolvedValue(null);
    vi.mocked(getPlayerStreaks).mockResolvedValue([] as never);
    vi.mocked(getPlayerAchievements).mockResolvedValue([] as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourn-1', name: 'Example League', season_id: null,
    } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', name: 'R1' } as never);
    vi.mocked(computePokemonScore).mockReturnValue({ p1Score: 0, p2Score: 0 } as never);
    vi.mocked(getH2HBetweenPlayers).mockResolvedValue([
      { id: 'prev-draw', winner_id: null, player_1_id: 'p1', player_2_id: 'p2', winner_name: null, date_played: '2025-12-01', updated_at: '2025-12-01', games: [{ winner_id: 'p1' }, { winner_id: 'p2' }] },
    ] as never);

    const url = new URL('http://localhost:3000/api/broadcast/state/33333333-3333-4333-8333-333333333333?enrich=true');
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(body.data.h2h_matches).toEqual([
      { match_id: 'prev-draw', date: '2025-12-01', winner_name: 'Draw', draw: true, score: '1-1' },
    ]);
  });

  it('returns null H2H when no history exists', async () => {
    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, games: [] } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);
    vi.mocked(getRecentMomentsByMatch).mockResolvedValue([]);

    vi.mocked(getPlayerSignatures).mockResolvedValue({ signatures: [] } as never);
    vi.mocked(getPlayerRating).mockResolvedValue(null);
    vi.mocked(getPlayerStreaks).mockResolvedValue([] as never);
    vi.mocked(getPlayerAchievements).mockResolvedValue([] as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourn-1', name: 'Example League', season_id: null,
    } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', name: 'R1' } as never);
    vi.mocked(getH2HBetweenPlayers).mockResolvedValue([]);
    vi.mocked(computePokemonScore).mockReturnValue({ p1Score: 0, p2Score: 0 } as never);

    const url = new URL('http://localhost:3000/api/broadcast/state/33333333-3333-4333-8333-333333333333?enrich=true');
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(body.data.h2h).toBeNull();
  });

  it('fails the enriched response when the H2H read fails instead of showing an empty history', async () => {
    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, games: [] } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);
    vi.mocked(getRecentMomentsByMatch).mockResolvedValue([]);
    vi.mocked(getPlayerSignatures).mockResolvedValue({ signatures: [] } as never);
    vi.mocked(getPlayerRating).mockResolvedValue(null);
    vi.mocked(getPlayerStreaks).mockResolvedValue([] as never);
    vi.mocked(getPlayerAchievements).mockResolvedValue([] as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: 'tourn-1', name: 'Example League', season_id: null } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', name: 'R1' } as never);
    const h2hError = new Error('h2h read failed');
    vi.mocked(getH2HBetweenPlayers).mockRejectedValue(h2hError);

    const url = new URL('http://localhost:3000/api/broadcast/state/33333333-3333-4333-8333-333333333333?enrich=true');
    const res = await GET({ nextUrl: url } as unknown as NextRequest, routeContext);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Failed to fetch broadcast state' });
    expect(safeErrorResponse).toHaveBeenCalledWith(h2hError, 'Failed to fetch broadcast state');
  });

  it('builds per-game breakdown with MVP detection', async () => {
    vi.mocked(getMatchById).mockResolvedValue({
      ...mockMatch,
      games: [
        { id: 'game-1', game_number: 1, winner_id: 'p1', replay_url: null },
      ],
    } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({
      'game-1': [
        { id: 's1', game_id: 'game-1', player_id: 'p1', pokemon_name: 'Pikachu', was_brought: true, was_lead: true, was_koed: false, kos_dealt: 3, moves_used: [], turns_active: 10 },
        { id: 's2', game_id: 'game-1', player_id: 'p1', pokemon_name: 'Eevee', was_brought: true, was_lead: false, was_koed: false, kos_dealt: 1, moves_used: [], turns_active: 5 },
        { id: 's3', game_id: 'game-1', player_id: 'p2', pokemon_name: 'Charizard', was_brought: true, was_lead: true, was_koed: true, kos_dealt: 2, moves_used: [], turns_active: 7 },
      ],
    } as never);
    vi.mocked(getRecentMomentsByMatch).mockResolvedValue([]);

    vi.mocked(getPlayerSignatures).mockResolvedValue({ signatures: [] } as never);
    vi.mocked(getPlayerRating).mockResolvedValue(null);
    vi.mocked(getPlayerStreaks).mockResolvedValue([] as never);
    vi.mocked(getPlayerAchievements).mockResolvedValue([] as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourn-1', name: 'Example League', season_id: null,
    } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', name: 'R1' } as never);
    vi.mocked(getH2HBetweenPlayers).mockResolvedValue([]);
    vi.mocked(computePokemonScore).mockReturnValue({ p1Score: 4, p2Score: 2 } as never);

    const url = new URL('http://localhost:3000/api/broadcast/state/33333333-3333-4333-8333-333333333333?enrich=true');
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request, routeContext);
    const body = await res.json();

    const breakdown = body.data.per_game_breakdown[0];
    expect(breakdown.game_number).toBe(1);
    expect(breakdown.player1_kos).toBe(4);
    expect(breakdown.player2_kos).toBe(2);
    // MVP: Pikachu (highest KOs on winning side)
    const mvp = breakdown.player1_pokemon.find(
      (p: Record<string, unknown>) => p.is_mvp === true,
    );
    expect(mvp).toBeDefined();
    expect(mvp.pokemon_name).toBe('Pikachu');
    // Losing side has no MVP
    const p2Mvp = breakdown.player2_pokemon.find(
      (p: Record<string, unknown>) => p.is_mvp === true,
    );
    expect(p2Mvp).toBeUndefined();
    // sprite_url populated
    expect(breakdown.player1_pokemon[0].sprite_url).toBeDefined();
  });
  it.each([
    ['match-1', false],
    ['abc', false],
    ['nonexistent', true],
    ['33333333-3333-4333-8333-333333333333x', true],
  ])('returns 404 INVALID_MATCH_ID for malformed id %j (enrich=%s) without querying', async (mid, enrich) => {
    const url = new URL(`http://localhost:3000/api/broadcast/state/${mid}${enrich ? '?enrich=true' : ''}`);
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request, { params: Promise.resolve({ mid }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Match not found', code: 'INVALID_MATCH_ID' });
    expect(getMatchById).not.toHaveBeenCalled();
    expect(getBattleStatsByMatch).not.toHaveBeenCalled();
  });
});
