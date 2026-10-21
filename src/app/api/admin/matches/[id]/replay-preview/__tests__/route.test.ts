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
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) =>
    NextResponse.json({ success: false, error: fallback }, { status: 500 })
  ),
}));

vi.mock('@/lib/utils/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 19, retryAfterSeconds: 0 })),
}));

vi.mock('@/lib/pkmn/replay', () => ({
  fetchReplay: vi.fn(),
  parseReplayLog: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  getPlayerByPsUsername: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  isResourceAdminFor: vi.fn(),
}));

import { POST } from '@/app/api/admin/matches/[id]/replay-preview/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { fetchReplay, parseReplayLog } from '@/lib/pkmn/replay';
import { getPlayerByPsUsername } from '@/lib/supabase/queries/players';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';

const MATCH_ID = 'daa274a2-59da-43fd-84a5-8cede96e15a4';
const REPLAY_URL = 'https://replay.pokemonshowdown.com/test';

const ADMIN = { playerId: 'admin1', name: 'Admin', isAdmin: true, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' } as const;
const NON_ADMIN = { playerId: 'user1', name: 'User', isAdmin: false, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' } as const;

const fakeMatch = {
  id: MATCH_ID,
  tournament_id: 't1',
  round_id: 'r1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
};

const fakeParsed = {
  winner_ps_username: 'alice_ps',
  players: [
    { ps_username: 'alice_ps', pokemon: [{ pokemon_name: 'Pikachu', was_brought: true, was_lead: true, kos_dealt: 1, was_koed: false, moves_used: ['Thunderbolt'], turns_active: 5 }] },
    { ps_username: 'subby', pokemon: [{ pokemon_name: 'Garchomp', was_brought: true, was_lead: true, kos_dealt: 0, was_koed: true, moves_used: ['Earthquake'], turns_active: 3 }] },
  ],
};

function makeRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: { get: vi.fn().mockReturnValue(null) },
  } as unknown as NextRequest;
}

function makeParams() {
  return { params: Promise.resolve({ id: MATCH_ID }) };
}

describe('POST /api/admin/matches/[id]/replay-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(ADMIN);
  });

  it('returns 404 when match not found', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null);
    const res = await POST(makeRequest({ replay_url: REPLAY_URL }), makeParams());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('match_not_found');
  });

  it('returns 403 when caller is neither admin nor resource admin', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(NON_ADMIN);
    vi.mocked(getMatchById).mockResolvedValue(fakeMatch as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);

    const res = await POST(makeRequest({ replay_url: REPLAY_URL }), makeParams());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
  });

  it('parses without the username gate and returns best-effort suggestions', async () => {
    vi.mocked(getMatchById).mockResolvedValue(fakeMatch as never);
    vi.mocked(fetchReplay).mockResolvedValue({ log: 'log', id: '1', format: 'gen9', players: ['alice_ps', 'subby'] as [string, string], winner: 'alice_ps' });
    vi.mocked(parseReplayLog).mockReturnValue(fakeParsed);
    // alice_ps resolves to participant p1; "subby" (the substitute) resolves to nobody.
    vi.mocked(getPlayerByPsUsername).mockImplementation(async (username: string) => {
      if (username === 'alice_ps') return { id: 'p1', name: 'Alice' } as never;
      return null;
    });

    const res = await POST(makeRequest({ replay_url: REPLAY_URL }), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.winner_ps_username).toBe('alice_ps');
    expect(body.data.suggestions).toEqual([
      { ps_username: 'alice_ps', suggested_player_id: 'p1' },
      { ps_username: 'subby', suggested_player_id: null },
    ]);
    // Resource-admin lookup is skipped for site admins.
    expect(vi.mocked(isResourceAdminFor)).not.toHaveBeenCalled();
  });

  it('does not suggest a player who is not a participant in this match', async () => {
    vi.mocked(getMatchById).mockResolvedValue(fakeMatch as never);
    vi.mocked(fetchReplay).mockResolvedValue({ log: 'log', id: '1', format: 'gen9', players: ['alice_ps', 'subby'] as [string, string], winner: 'alice_ps' });
    vi.mocked(parseReplayLog).mockReturnValue(fakeParsed);
    // alice_ps resolves to a registered player who is NOT in this match.
    vi.mocked(getPlayerByPsUsername).mockImplementation(async (username: string) => {
      if (username === 'alice_ps') return { id: 'p999', name: 'Stranger' } as never;
      return null;
    });

    const res = await POST(makeRequest({ replay_url: REPLAY_URL }), makeParams());
    const body = await res.json();
    expect(body.data.suggestions[0].suggested_player_id).toBeNull();
  });
});
