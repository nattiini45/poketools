import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// --------------- mocks ---------------

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/api/error-response', async () => {
  const { AuthError } = await import('@/lib/auth/helpers');
  const { NextResponse } = await import('next/server');
  return {
    safeErrorResponse: vi.fn((err: unknown, fallback: string) => {
      if (err instanceof AuthError) {
        return NextResponse.json(
          { success: false, error: (err as InstanceType<typeof AuthError>).message },
          { status: (err as InstanceType<typeof AuthError>).statusCode }
        );
      }
      return NextResponse.json({ success: false, error: fallback }, { status: 500 });
    }),
  };
});

vi.mock('@/lib/pkmn/game-pipeline', () => ({
  recordGameResult: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/broadcast-moments', () => ({
  createMomentsBatch: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

vi.mock('@/lib/discord/notify', () => ({
  emitDiscordEvent: vi.fn(),
}));

vi.mock('@/lib/social/notify', () => ({
  emitSocialEvent: vi.fn(),
}));

vi.mock('@/lib/discord/helpers', () => ({
  buildGamePokemonStats: vi.fn().mockReturnValue([]),
  computePokemonScoreFromGameStats: vi.fn().mockReturnValue({ p1: 0, p2: 0 }),
}));

vi.mock('@/lib/ai/trigger', () => ({
  triggerMatchAnalysis: vi.fn(),
}));

vi.mock('@/lib/match/aggregate-queue', () => ({
  processAggregateJobs: vi.fn(),
}));

// --------------- imports (after mocks) ---------------

import { POST } from '@/app/api/manual-result/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { recordGameResult } from '@/lib/pkmn/game-pipeline';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { triggerMatchAnalysis } from '@/lib/ai/trigger';

// --------------- helpers ---------------

function makeRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: { get: vi.fn().mockReturnValue('session=xyz') },
  } as unknown as NextRequest;
}

const MATCH_ID = '12345678-1234-4123-8123-123456789abc';
const P1_ID = '11111111-1111-4111-8111-111111111111';
const P2_ID = '22222222-2222-4222-8222-222222222222';
const TOURNAMENT_ID = '33333333-3333-4333-8333-333333333333';
const ROUND_ID = '44444444-4444-4444-8444-444444444444';

const match = {
  id: MATCH_ID,
  tournament_id: TOURNAMENT_ID,
  round_id: ROUND_ID,
  player_1_id: P1_ID,
  player_2_id: P2_ID,
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  winner_id: null,
  winner_name: null,
  status: 'in_progress',
  games: [],
};

const validBody = {
  match_id: MATCH_ID,
  winner_id: P1_ID,
  pokemon_stats: [
    {
      player_id: P1_ID,
      pokemon: [
        { pokemon_name: 'Pikachu', kos_dealt: 2, was_koed: false },
      ],
    },
    {
      player_id: P2_ID,
      pokemon: [
        { pokemon_name: 'Charizard', kos_dealt: 0, was_koed: true },
      ],
    },
  ],
};

// --------------- tests ---------------

describe('POST /api/manual-result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue({
      playerId: P1_ID,
      name: 'Alice',
      isAdmin: false,
    } as never);
  });

  // ---- auth ----

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Unauthorized', 401));

    const response = await POST(makeRequest(validBody));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.success).toBe(false);
  });

  // ---- validation ----

  it('returns 400 when match_id is missing', async () => {
    const body = { winner_id: P1_ID, pokemon_stats: [{ player_id: P1_ID, pokemon: [] }] };
    const response = await POST(makeRequest(body));

    expect(response.status).toBe(400);
  });

  it('returns 400 when winner_id is missing', async () => {
    const body = { match_id: MATCH_ID, pokemon_stats: [{ player_id: P1_ID, pokemon: [] }] };
    const response = await POST(makeRequest(body));

    expect(response.status).toBe(400);
  });

  it('returns 400 when pokemon_stats is empty', async () => {
    const body = { match_id: MATCH_ID, winner_id: P1_ID, pokemon_stats: [] };
    const response = await POST(makeRequest(body));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('validation_failed');
    expect(payload.params).toEqual({ issues: payload.error });
  });

  it('sends rate_limited with the retry seconds once the hourly limit is used up', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'rate-limit-player', name: 'Eve', isAdmin: false } as never);
    for (let i = 0; i < 20; i++) await POST(makeRequest({}));

    const response = await POST(makeRequest({}));
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload.code).toBe('rate_limited');
    expect(payload.error).toBe(`Rate limit exceeded. Try again in ${payload.params.seconds}s.`);
    expect(payload.params.seconds).toBeGreaterThan(0);
  });

  it('returns 404 when match does not exist', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null as never);

    const response = await POST(makeRequest(validBody));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toContain('not found');
    expect(payload.code).toBe('match_not_found');
  });

  it('returns 400 when winner is not a match participant', async () => {
    vi.mocked(getMatchById).mockResolvedValue(match as never);
    const OUTSIDER = '99999999-9999-4999-8999-999999999999';
    const body = { ...validBody, winner_id: OUTSIDER };

    const response = await POST(makeRequest(body));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('participant');
    expect(payload.code).toBe('manual_result_winner_not_participant');
  });

  it('returns 400 when pokemon_stats references a non-participant', async () => {
    vi.mocked(getMatchById).mockResolvedValue(match as never);
    const OUTSIDER = '99999999-9999-4999-8999-999999999999';
    const body = {
      ...validBody,
      pokemon_stats: [
        { player_id: OUTSIDER, pokemon: [{ pokemon_name: 'Pikachu' }] },
        { player_id: P2_ID, pokemon: [{ pokemon_name: 'Charizard' }] },
      ],
    };

    const response = await POST(makeRequest(body));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('not in this match');
    expect(payload.code).toBe('match_player_not_participant');
    expect(payload.params).toEqual({ playerId: OUTSIDER });
  });

  // ---- happy path ----

  it('records the game result and returns 200', async () => {
    vi.mocked(getMatchById).mockResolvedValue(match as never);
    vi.mocked(recordGameResult).mockResolvedValue({
      game_id: 'g-1',
      bo_reached: false,
    } as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 't-1',
      name: 'League',
      season_id: 's-1',
      current_round: 1,
    } as never);
    vi.mocked(getRoundById).mockResolvedValue({ name: 'Round 1' } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);

    const response = await POST(makeRequest(validBody));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(recordGameResult).toHaveBeenCalledWith(
      expect.objectContaining({
        match_id: MATCH_ID,
        winner_id: P1_ID,
        source: 'manual',
        submitter_id: P1_ID,
      })
    );
  });

  it('triggers AI match analysis when BO threshold is reached', async () => {
    vi.mocked(getMatchById).mockResolvedValue(match as never);
    vi.mocked(recordGameResult).mockResolvedValue({
      game_id: 'g-1',
      bo_reached: true,
    } as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 't-1',
      name: 'League',
      season_id: 's-1',
      current_round: 1,
    } as never);
    vi.mocked(getRoundById).mockResolvedValue({ name: 'Round 1' } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);

    await POST(makeRequest(validBody));

    expect(triggerMatchAnalysis).toHaveBeenCalledWith(MATCH_ID, 'session=xyz');
  });

  it('does NOT trigger AI analysis when BO threshold is not reached', async () => {
    vi.mocked(getMatchById).mockResolvedValue(match as never);
    vi.mocked(recordGameResult).mockResolvedValue({
      game_id: 'g-1',
      bo_reached: false,
    } as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 't-1',
      name: 'League',
      season_id: 's-1',
      current_round: 1,
    } as never);
    vi.mocked(getRoundById).mockResolvedValue({ name: 'Round 1' } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);

    await POST(makeRequest(validBody));

    expect(triggerMatchAnalysis).not.toHaveBeenCalled();
  });

  // ---- error handling ----

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getMatchById).mockRejectedValue(new Error('db'));

    const response = await POST(makeRequest(validBody));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBe(false);
  });
});
