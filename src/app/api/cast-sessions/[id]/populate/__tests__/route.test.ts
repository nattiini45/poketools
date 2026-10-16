import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';
import type { CastSession } from '@/types/cast-session';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requireCreator: vi.fn(),
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

vi.mock('@/lib/supabase/queries/cast-sessions', () => ({
  getCastSessionById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/teams', () => ({
  getPlayerTeamForTournament: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(),
}));

vi.mock('@/lib/match/aggregation', () => ({
  resolveActualTeam: vi.fn(),
}));

vi.mock('@/lib/team/visibility', () => ({
  canViewTeamPokemon: vi.fn(),
}));

import { POST } from '../../populate/route';
import { requireCreator } from '@/lib/auth/helpers';
import { getCastSessionById } from '@/lib/supabase/queries/cast-sessions';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getPlayerTeamForTournament } from '@/lib/supabase/queries/teams';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { canViewTeamPokemon } from '@/lib/team/visibility';

// ── Fixtures ───────────────────────────────────────────────────────────

const OWNER_PLAYER = {
  playerId: 'player-1',
  name: 'Caster',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: true,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
} as const;

const MOCK_SESSION: CastSession = {
  id: 'session-1',
  owner_id: 'player-1',
  realtime_key: '00000000-0000-4000-8000-000000000001',
  match_id: null,
  tournament_id: 'tourn-1',
  season_id: null,
  name: 'Test Session',
  mode: 'cast',
  status: 'draft',
  player1_id: 'p1',
  player1_name: 'Alice',
  player1_avatar_url: null,
  player2_id: 'p2',
  player2_name: 'Bob',
  player2_avatar_url: null,
  player1_team: [],
  player2_team: [],
  tracker_state: null,
  overlay_config: {},
  caster_notes: {},
  format: 'gen9ou',
  generation: 9,
  created_at: '2026-04-07T00:00:00.000Z',
  updated_at: '2026-04-07T00:00:00.000Z',
};

const MATCH_UUID = 'a0000000-0000-4000-a000-000000000001';

const MOCK_MATCH = {
  id: MATCH_UUID,
  tournament_id: 'tourn-1',
  round_id: 'round-1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  player_1_avatar_url: 'https://example.com/a.png',
  player_2_avatar_url: 'https://example.com/b.png',
  status: 'in_progress',
  games: [],
};

function makeRouteParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: unknown): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('POST /api/cast-sessions/[id]/populate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCreator).mockResolvedValue(OWNER_PLAYER);
    vi.mocked(getCastSessionById).mockResolvedValue(MOCK_SESSION);
    vi.mocked(getMatchById).mockResolvedValue(MOCK_MATCH as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', name: 'Round 1', best_of: 3 } as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourn-1',
      season_id: 'season-1',
      ruleset_id: 'ruleset-1',
    } as never);
    vi.mocked(getRulesetById).mockResolvedValue({
      id: 'ruleset-1',
      base_format: 'gen9ou',
    } as never);
    vi.mocked(getPlayerTeamForTournament).mockResolvedValue({
      pokemon: [{ species: 'Garchomp' }],
    } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);
    vi.mocked(canViewTeamPokemon).mockResolvedValue(true);
  });

  it('populates session data from a match', async () => {
    const req = makeRequest({ match_id: MATCH_UUID });
    const res = await POST(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.match.id).toBe(MATCH_UUID);
    expect(json.data.player1.name).toBe('Alice');
    expect(json.data.player2.name).toBe('Bob');
    expect(json.data.format).toBe('gen9ou');
    expect(json.data.generation).toBe(9);
  });

  it('returns 404 when session does not exist', async () => {
    vi.mocked(getCastSessionById).mockResolvedValue(null);

    const req = makeRequest({ match_id: MATCH_UUID });
    const res = await POST(req, makeRouteParams('nonexistent'));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Session not found');
    expect(json.code).toBe('cast_session_not_found');
  });

  it('returns 403 when caller is not session owner', async () => {
    vi.mocked(requireCreator).mockResolvedValue({
      ...OWNER_PLAYER,
      playerId: 'player-other',
    });

    const req = makeRequest({ match_id: MATCH_UUID });
    const res = await POST(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Not authorized');
    expect(json.code).toBe('cast_session_forbidden');
  });

  it('returns 400 when match_id is missing', async () => {
    const req = makeRequest({});
    const res = await POST(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('match_id');
    expect(json.code).toBe('validation_failed');
    expect(json.params).toEqual({ issues: json.error });
  });

  it('returns 404 when match does not exist', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null);

    const req = makeRequest({ match_id: 'b0000000-0000-4000-b000-000000000001' });
    const res = await POST(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Match not found');
    expect(json.code).toBe('match_not_found');
  });

  it('returns empty teams when visibility is denied', async () => {
    vi.mocked(canViewTeamPokemon).mockResolvedValue(false);

    const req = makeRequest({ match_id: MATCH_UUID });
    const res = await POST(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.player1_team).toEqual([]);
    expect(json.data.player2_team).toEqual([]);
  });

  it('allows admin access even if not session owner', async () => {
    vi.mocked(requireCreator).mockResolvedValue({
      ...OWNER_PLAYER,
      playerId: 'player-admin',
      isAdmin: true,
    });

    const req = makeRequest({ match_id: MATCH_UUID });
    const res = await POST(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(json.success).toBe(true);
  });

  it('returns null format when tournament has no ruleset', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourn-1',
      season_id: null as never,
      ruleset_id: null,
    } as never);

    const req = makeRequest({ match_id: MATCH_UUID });
    const res = await POST(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.format).toBeNull();
    expect(json.data.generation).toBeNull();
  });
});
