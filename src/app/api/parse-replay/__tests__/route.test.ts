import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

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

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/pkmn/replay', () => ({
  fetchReplay: vi.fn(),
  parseReplayLog: vi.fn(),
}));

vi.mock('@/lib/pkmn/game-pipeline', () => ({
  recordGameResult: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  getPlayerByPsUsername: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
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

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(),
}));

vi.mock('@/lib/discord/helpers', () => ({
  buildGamePokemonStats: vi.fn(),
  computePokemonScoreFromGameStats: vi.fn(),
}));

vi.mock('@/lib/ai/trigger', () => ({
  triggerMatchAnalysis: vi.fn(),
}));

vi.mock('@/lib/match/aggregate-queue', () => ({
  processAggregateJobs: vi.fn(),
}));

import { POST } from '@/app/api/parse-replay/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { fetchReplay, parseReplayLog } from '@/lib/pkmn/replay';
import { recordGameResult } from '@/lib/pkmn/game-pipeline';
import { getPlayerByPsUsername } from '@/lib/supabase/queries/players';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { revalidateMatchPages } from '@/lib/revalidation';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { buildGamePokemonStats, computePokemonScoreFromGameStats } from '@/lib/discord/helpers';

const MATCH_ID = '12345678-1234-4123-8123-123456789abc';
const REPLAY_URL = 'https://replay.pokemonshowdown.com/test';

const PLAYER = { playerId: 'p1', name: 'Alice', isAdmin: false, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' } as const;

const fakeMatch = {
  id: MATCH_ID,
  tournament_id: 't1',
  round_id: 'r1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  winner_name: null,
};

const fakeParsed = {
  winner_ps_username: 'alice_ps',
  players: [
    {
      ps_username: 'alice_ps',
      pokemon: [
        {
          pokemon_name: 'Pikachu',
          was_brought: true,
          was_lead: true,
          kos_dealt: 1,
          was_koed: false,
          moves_used: ['Thunderbolt'],
          turns_active: 5,
        },
      ],
    },
    {
      ps_username: 'bob_ps',
      pokemon: [
        {
          pokemon_name: 'Garchomp',
          was_brought: true,
          was_lead: true,
          kos_dealt: 0,
          was_koed: true,
          moves_used: ['Earthquake'],
          turns_active: 3,
        },
      ],
    },
  ],
};

function makeRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: { get: vi.fn().mockReturnValue(null) },
  } as unknown as NextRequest;
}

describe('POST /api/parse-replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(PLAYER);
  });

  // ── Validation ────────────────────────────────────────────

  it('rejects when match_id is missing', async () => {
    const res = await POST(makeRequest({ replay_url: REPLAY_URL }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('match_id');
    expect(body.code).toBe('validation_failed');
  });

  it('rejects when replay_url is missing', async () => {
    const res = await POST(makeRequest({ match_id: MATCH_ID }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('replay_url');
  });

  // ── Match not found ───────────────────────────────────────

  it('returns 404 when match not found', async () => {
    vi.mocked(fetchReplay).mockResolvedValue({ log: 'log', id: '1', format: 'gen9', players: ['alice_ps', 'bob_ps'] as [string, string], winner: 'alice_ps' });
    vi.mocked(parseReplayLog).mockReturnValue(fakeParsed);
    vi.mocked(getMatchById).mockResolvedValue(null);

    const res = await POST(
      makeRequest({ match_id: MATCH_ID, replay_url: REPLAY_URL }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('match_not_found');
  });

  // ── PS username not registered ────────────────────────────

  it('returns 400 when PS username cannot be matched', async () => {
    vi.mocked(fetchReplay).mockResolvedValue({ log: 'log', id: '1', format: 'gen9', players: ['alice_ps', 'bob_ps'] as [string, string], winner: 'alice_ps' });
    vi.mocked(parseReplayLog).mockReturnValue(fakeParsed);
    vi.mocked(getMatchById).mockResolvedValue(fakeMatch as never);
    vi.mocked(getPlayerByPsUsername).mockResolvedValue(null);

    const res = await POST(
      makeRequest({ match_id: MATCH_ID, replay_url: REPLAY_URL }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Could not match PS username');
    expect(body.code).toBe('name_mismatch');
    expect(body.params).toEqual({ username: 'alice_ps' });
    expect(body.ps_usernames).toEqual(['alice_ps', 'bob_ps']);
  });

  // ── Player not in match ───────────────────────────────────

  it('returns 400 when player is not a match participant', async () => {
    vi.mocked(fetchReplay).mockResolvedValue({ log: 'log', id: '1', format: 'gen9', players: ['alice_ps', 'bob_ps'] as [string, string], winner: 'alice_ps' });
    vi.mocked(parseReplayLog).mockReturnValue(fakeParsed);
    vi.mocked(getMatchById).mockResolvedValue(fakeMatch as never);
    // Return a player that is NOT in the match
    vi.mocked(getPlayerByPsUsername).mockResolvedValue({ id: 'p999', name: 'Stranger' } as never);

    const res = await POST(
      makeRequest({ match_id: MATCH_ID, replay_url: REPLAY_URL }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('not a participant');
    // Dedicated code; ReplaySubmitForm still offers the manual-assign fallback on it.
    expect(body.code).toBe('replay_player_not_in_match');
    expect(body.params).toEqual({ username: 'alice_ps', player: 'Stranger' });
    expect(body.ps_usernames).toEqual(['alice_ps', 'bob_ps']);
  });

  // ── Happy path ────────────────────────────────────────────

  it('processes a valid replay and returns game result', async () => {
    vi.mocked(fetchReplay).mockResolvedValue({ log: 'log', id: '1', format: 'gen9', players: ['alice_ps', 'bob_ps'] as [string, string], winner: 'alice_ps' });
    vi.mocked(parseReplayLog).mockReturnValue(fakeParsed);
    vi.mocked(getMatchById).mockResolvedValue(fakeMatch as never);
    vi.mocked(getPlayerByPsUsername).mockImplementation(async (username: string) => {
      if (username === 'alice_ps') return { id: 'p1', name: 'Alice' } as never;
      if (username === 'bob_ps') return { id: 'p2', name: 'Bob' } as never;
      return null;
    });

    const gameResult = { game_id: 'g1', bo_reached: false } as never;
    vi.mocked(recordGameResult).mockResolvedValue(gameResult);
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);
    vi.mocked(getTournamentById).mockResolvedValue(null);

    const res = await POST(
      makeRequest({ match_id: MATCH_ID, replay_url: REPLAY_URL }),
    );
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(gameResult);

    expect(vi.mocked(recordGameResult)).toHaveBeenCalledWith(
      expect.objectContaining({
        match_id: MATCH_ID,
        winner_id: 'p1',
        replay_url: REPLAY_URL,
        source: 'ps_replay',
        submitter_id: 'p1',
        is_admin: false,
      }),
    );
  });

  // ── Discord notification fire-and-forget ──────────────────

  it('fires Discord notification when tournament exists', async () => {
    vi.mocked(fetchReplay).mockResolvedValue({ log: 'log', id: '1', format: 'gen9', players: ['alice_ps', 'bob_ps'] as [string, string], winner: 'alice_ps' });
    vi.mocked(parseReplayLog).mockReturnValue(fakeParsed);
    vi.mocked(getMatchById).mockResolvedValue(fakeMatch as never);
    vi.mocked(getPlayerByPsUsername).mockImplementation(async (username: string) => {
      if (username === 'alice_ps') return { id: 'p1', name: 'Alice' } as never;
      if (username === 'bob_ps') return { id: 'p2', name: 'Bob' } as never;
      return null;
    });
    vi.mocked(recordGameResult).mockResolvedValue({ game_id: 'g1', bo_reached: false } as never);
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't1', name: 'Test Cup', season_id: 's1', current_round: 1 } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'r1', name: 'Round 1' } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue([] as never);
    vi.mocked(buildGamePokemonStats).mockReturnValue([]);
    vi.mocked(computePokemonScoreFromGameStats).mockReturnValue({ p1: 3, p2: 1 });

    const res = await POST(
      makeRequest({ match_id: MATCH_ID, replay_url: REPLAY_URL }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  // ── Auth error ────────────────────────────────────────────

  it('returns safeErrorResponse when auth fails', async () => {
    const AuthError = (await import('@/lib/auth/helpers')).AuthError as unknown as new (
      msg: string,
      code: number,
    ) => Error & { statusCode: number };
    vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Not authenticated', 401));

    const res = await POST(
      makeRequest({ match_id: MATCH_ID, replay_url: REPLAY_URL }),
    );
    expect(res.status).toBe(500);
  });
});
