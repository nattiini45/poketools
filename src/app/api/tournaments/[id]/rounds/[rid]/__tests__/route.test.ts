import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';
import type { Round } from '@/types/round';

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'AuthError';
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
  updateRoundStatus: vi.fn(),
  updateRoundBestOf: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByRound: vi.fn(),
  getCompletedMatchRecords: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
}));

vi.mock('@/lib/tournament/season-standings', () => ({
  computeStandingsForSeason: vi.fn(),
}));

vi.mock('@/lib/discord/notify', () => ({
  emitDiscordEvent: vi.fn(),
}));

vi.mock('@/lib/social/notify', () => ({
  emitSocialEvent: vi.fn(),
}));

vi.mock('@/lib/ai/trigger', () => ({
  triggerTournamentReport: vi.fn(),
}));

import { GET, PATCH } from '@/app/api/tournaments/[id]/rounds/[rid]/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getRoundById, updateRoundStatus, updateRoundBestOf } from '@/lib/supabase/queries/rounds';
import { getMatchesByRound, getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { triggerTournamentReport } from '@/lib/ai/trigger';
import { revalidateTag } from 'next/cache';
import { PRIVATE_MATCH_FIELDS, PUBLIC_MATCH_FIELDS, toPublicMatch } from '@/lib/match/public-match';
import { expectNoPrivateMatchData, fullMatchRow } from '@/lib/match/__tests__/private-match-fields';

const T_ID = '11111111-1111-4111-8111-111111111111';
const R_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_RID = '99999999-9999-4999-8999-999999999999';

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: R_ID,
    tournament_id: T_ID,
    name: 'Round 1',
    round_number: 1,
    best_of: 3,
    status: 'pending',
    pairings_generated: true,
    deadline: null,
    bracket_side: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeMatchForRound(overrides: Record<string, unknown> = {}) {
  return {
    id: 'match-1',
    player_1_id: 'p1',
    player_2_id: 'p2',
    player_1_name: 'Player 1',
    player_2_name: 'Player 2',
    winner_id: 'p1',
    status: 'completed',
    games: [
      { winner_id: 'p1' },
      { winner_id: 'p1' },
    ],
    ...overrides,
  };
}

/* ── GET ──────────────────────────────────────────────────── */

describe('GET /api/tournaments/[id]/rounds/[rid]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when round is not found', async () => {
    vi.mocked(getRoundById).mockResolvedValue(null as never);

    const request = { nextUrl: new URL('http://localhost:3000/api/test') } as unknown as NextRequest;
    const response = await GET(request, {
      params: Promise.resolve({ id: T_ID, rid: MISSING_RID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('Round not found');
    expect((payload as { code?: string }).code).toBe('round_not_found');
  });

  it('returns round with matches on success', async () => {
    const round = makeRound();
    const matches = [makeMatchForRound()];
    vi.mocked(getRoundById).mockResolvedValue(round);
    vi.mocked(getMatchesByRound).mockResolvedValue(matches as never);

    const request = { nextUrl: new URL('http://localhost:3000/api/test') } as unknown as NextRequest;
    const response = await GET(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.id).toBe(R_ID);
    expect(payload.data.matches).toEqual(matches);
  });

  it('returns the matches as PublicMatch: no admin notes, submitter or confirmation timestamps', async () => {
    const round = makeRound();
    const rows = [
      fullMatchRow({ id: 'match-1', round_id: R_ID, tournament_id: T_ID }),
      fullMatchRow({ id: 'match-2', round_id: R_ID, tournament_id: T_ID, status: 'scheduled' }),
    ];
    vi.mocked(getRoundById).mockResolvedValue(round);
    vi.mocked(getMatchesByRound).mockResolvedValue(rows);

    const request = { nextUrl: new URL('http://localhost:3000/api/test') } as unknown as NextRequest;
    const response = await GET(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.matches).toHaveLength(2);
    for (const match of payload.data.matches) {
      expect(Object.keys(match)).toEqual([...PUBLIC_MATCH_FIELDS]);
      for (const key of PRIVATE_MATCH_FIELDS) expect(match).not.toHaveProperty(key);
    }
    expect(payload.data.matches).toEqual(JSON.parse(JSON.stringify(rows.map(toPublicMatch))));
    expectNoPrivateMatchData(payload);
  });

  it('returns 404 when the round belongs to another tournament (and reads no matches)', async () => {
    vi.mocked(getRoundById).mockResolvedValue(makeRound({ tournament_id: 'tournament-2' }));
    vi.mocked(getMatchesByRound).mockResolvedValue([fullMatchRow()]);

    const request = { nextUrl: new URL('http://localhost:3000/api/test') } as unknown as NextRequest;
    const response = await GET(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('Round does not belong to this tournament');
    expect((payload as { code?: string }).code).toBe('round_wrong_tournament');
    expect(payload).not.toHaveProperty('data');
    expect(vi.mocked(getMatchesByRound)).not.toHaveBeenCalled();
  });

  it.each([
    ['round id', T_ID, 'abc', 'Round not found', 'INVALID_ROUND_ID'],
    ['tournament id', 'abc', R_ID, 'Tournament not found', 'INVALID_TOURNAMENT_ID'],
    ['tournament and round id', 'abc', 'xyz', 'Tournament not found', 'INVALID_TOURNAMENT_ID'],
  ])('returns 404 for a malformed %s without querying, naming that segment', async (_label, id, rid, error, code) => {
    const request = { nextUrl: new URL('http://localhost:3000/api/test') } as unknown as NextRequest;
    const response = await GET(request, { params: Promise.resolve({ id, rid }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ success: false, error, code });
    expect(vi.mocked(getRoundById)).not.toHaveBeenCalled();
  });

  it('returns 500 when getRoundById throws', async () => {
    vi.mocked(getRoundById).mockRejectedValue(new Error('db failure'));

    const request = { nextUrl: new URL('http://localhost:3000/api/test') } as unknown as NextRequest;
    const response = await GET(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('Failed to fetch round');
  });
});

/* ── PATCH ─────────────────────────────────────────────────── */

describe('PATCH /api/tournaments/[id]/rounds/[rid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects round updates when rid is not under authorized tournament id', async () => {
    vi.mocked(getRoundById).mockResolvedValue(
      makeRound({ tournament_id: 'tournament-2' })
    );

    const request = {
      json: vi.fn().mockResolvedValue({ status: 'active' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(404);
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('does not belong');
    expect((payload as { code?: string }).code).toBe('round_wrong_tournament');
    expect(vi.mocked(requireResourceAdmin)).toHaveBeenCalledWith('tournament', T_ID);
    expect(vi.mocked(updateRoundStatus)).not.toHaveBeenCalled();
    expect(vi.mocked(updateRoundBestOf)).not.toHaveBeenCalled();
  });

  it('updates round when rid belongs to authorized tournament', async () => {
    const updated = makeRound({ status: 'active' });
    vi.mocked(getRoundById).mockResolvedValue(makeRound());
    vi.mocked(updateRoundStatus).mockResolvedValue(updated);

    const request = {
      json: vi.fn().mockResolvedValue({ status: 'active' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });
    const payload = await response.json() as { success: boolean; data: Round };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.status).toBe('active');
    expect(vi.mocked(updateRoundStatus)).toHaveBeenCalledWith(R_ID, 'active');
  });

  it('expires the tournament and its league read-cache tags after the write (D37)', async () => {
    vi.mocked(getRoundById).mockResolvedValue(makeRound());
    vi.mocked(updateRoundStatus).mockResolvedValue(makeRound({ status: 'active' }));
    vi.mocked(getTournamentById).mockResolvedValueOnce({ id: T_ID, season_id: 'season-1' } as never);

    const request = {
      json: vi.fn().mockResolvedValue({ status: 'active' }),
    } as unknown as NextRequest;
    const response = await PATCH(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });

    expect(response.status).toBe(200);
    const tags = vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag);
    expect(tags).toEqual(expect.arrayContaining([`tournament:${T_ID}`, 'season:season-1']));
    for (const [, profile] of vi.mocked(revalidateTag).mock.calls) expect(profile).toEqual({ expire: 0 });
    expect(vi.mocked(updateRoundStatus).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(revalidateTag).mock.invocationCallOrder[0],
    );
  });

  it('reads the tournament before writing: a failed read changes nothing', async () => {
    vi.mocked(getRoundById).mockResolvedValue(makeRound());
    vi.mocked(getTournamentById).mockRejectedValueOnce(new Error('DB failure'));

    const request = {
      json: vi.fn().mockResolvedValue({ status: 'active' }),
    } as unknown as NextRequest;
    const response = await PATCH(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });

    expect(response.status).toBe(500);
    expect(vi.mocked(updateRoundStatus)).not.toHaveBeenCalled();
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it('returns 400 when neither status nor best_of is provided', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({}),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Provide status');
    expect((payload as { code?: string }).code).toBe('validation_failed');
  });

  it('returns 404 when round does not exist', async () => {
    vi.mocked(getRoundById).mockResolvedValue(null as never);

    const request = {
      json: vi.fn().mockResolvedValue({ status: 'active' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: T_ID, rid: MISSING_RID }),
    });
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Round not found');
    expect((payload as { code?: string }).code).toBe('round_not_found');
  });

  it('returns 404 INVALID_ROUND_ID for a malformed round id, after the auth guard', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({ status: 'active' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: T_ID, rid: 'abc' }),
    });
    const payload = await response.json() as { success: boolean; error?: string; code?: string };

    expect(response.status).toBe(404);
    expect(payload.code).toBe('INVALID_ROUND_ID');
    expect(vi.mocked(requireResourceAdmin)).toHaveBeenCalledWith('tournament', T_ID);
    expect(vi.mocked(getRoundById)).not.toHaveBeenCalled();
  });

  it('returns 400 when changing best_of on a non-pending round', async () => {
    vi.mocked(getRoundById).mockResolvedValue(makeRound({ status: 'active' }));

    const request = {
      json: vi.fn().mockResolvedValue({ best_of: 5 }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Can only change best_of on pending rounds');
    expect((payload as { code?: string }).code).toBe('round_best_of_locked');
  });

  it('updates best_of on a pending round', async () => {
    const round = makeRound({ status: 'pending' });
    const updated = makeRound({ status: 'pending', best_of: 5 });
    vi.mocked(getRoundById).mockResolvedValue(round);
    vi.mocked(updateRoundBestOf).mockResolvedValue(updated);

    const request = {
      json: vi.fn().mockResolvedValue({ best_of: 5 }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });
    const payload = await response.json() as { success: boolean; data: Round };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(vi.mocked(updateRoundBestOf)).toHaveBeenCalledWith(R_ID, 5);
    // updateRoundStatus should not be called when only best_of is supplied
    expect(vi.mocked(updateRoundStatus)).not.toHaveBeenCalled();
  });

  it('emits Discord/social events and triggers AI on status=completed', async () => {
    const round = makeRound({ status: 'active', round_number: 2 });
    const completedRound = makeRound({ status: 'completed', round_number: 2 });
    vi.mocked(getRoundById).mockResolvedValue(round);
    vi.mocked(updateRoundStatus).mockResolvedValue(completedRound);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: T_ID,
      name: 'Example League Season 5',
      season_id: 'season-1',
    } as never);
    vi.mocked(getMatchesByRound).mockResolvedValue([
      makeMatchForRound({
        games: [{ winner_id: 'p1' }, { winner_id: 'p2' }, { winner_id: 'p1' }],
      }),
    ] as never);
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as never);
    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1', name: 'Player 1' },
      { id: 'p2', name: 'Player 2' },
    ] as never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue([
      { player_id: 'p1', player_name: 'Player 1', wins: 1, losses: 0, draws: 0, points: 3 },
      { player_id: 'p2', player_name: 'Player 2', wins: 0, losses: 1, draws: 0, points: 0 },
    ] as never);

    const request = {
      json: vi.fn().mockResolvedValue({ status: 'completed' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });
    const payload = await response.json() as { success: boolean };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(vi.mocked(emitDiscordEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitSocialEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(triggerTournamentReport)).toHaveBeenCalledWith(
      T_ID, R_ID, 'round_recap',
    );
    // Round 2 -> should compute both current + previous standings
    expect(vi.mocked(computeStandingsForSeason)).toHaveBeenCalledTimes(2);
  });

  it('skips previous standings computation for round 1', async () => {
    const round = makeRound({ status: 'active', round_number: 1 });
    const completedRound = makeRound({ status: 'completed', round_number: 1 });
    vi.mocked(getRoundById).mockResolvedValue(round);
    vi.mocked(updateRoundStatus).mockResolvedValue(completedRound);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: T_ID,
      name: 'Example League S5',
      season_id: 'season-1',
    } as never);
    vi.mocked(getMatchesByRound).mockResolvedValue([] as never);
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as never);
    vi.mocked(getParticipants).mockResolvedValue([] as never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue([] as never);

    const request = {
      json: vi.fn().mockResolvedValue({ status: 'completed' }),
    } as unknown as NextRequest;

    await PATCH(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });

    // Only current standings, no previous
    expect(vi.mocked(computeStandingsForSeason)).toHaveBeenCalledTimes(1);
  });

  it('does not break when Discord event assembly throws', async () => {
    const round = makeRound({ status: 'active' });
    const completedRound = makeRound({ status: 'completed' });
    vi.mocked(getRoundById).mockResolvedValue(round);
    vi.mocked(updateRoundStatus).mockResolvedValue(completedRound);
    vi.mocked(getTournamentById).mockResolvedValue({ id: T_ID, season_id: null, name: 'Cup' } as never);
    vi.mocked(getCompletedMatchRecords).mockRejectedValueOnce(new Error('DB failure'));

    const request = {
      json: vi.fn().mockResolvedValue({ status: 'completed' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });
    const payload = await response.json() as { success: boolean };

    // The round update should still succeed
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(vi.mocked(triggerTournamentReport)).toHaveBeenCalled();
  });

  it('filters BYE matches from match_results', async () => {
    const round = makeRound({ status: 'active', round_number: 1 });
    vi.mocked(getRoundById).mockResolvedValue(round);
    vi.mocked(updateRoundStatus).mockResolvedValue(makeRound({ status: 'completed' }));
    vi.mocked(getTournamentById).mockResolvedValue({
      id: T_ID,
      name: 'Example League',
      season_id: 's1',
    } as never);
    vi.mocked(getMatchesByRound).mockResolvedValue([
      makeMatchForRound({
        player_1_id: 'p1',
        player_2_id: '__BYE__',
        player_2_name: 'BYE',
        games: [],
      }),
      makeMatchForRound({
        id: 'match-2',
        player_1_id: 'p1',
        player_2_id: 'p2',
        games: [{ winner_id: 'p1' }],
      }),
    ] as never);
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as never);
    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1', name: 'Player 1' },
      { id: 'p2', name: 'Player 2' },
    ] as never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue([] as never);

    const request = {
      json: vi.fn().mockResolvedValue({ status: 'completed' }),
    } as unknown as NextRequest;

    await PATCH(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });

    // BYE matches (player_2_id === '__BYE__') are filtered out of match_results
    const discordCall = vi.mocked(emitDiscordEvent).mock.calls[0][0] as unknown as unknown as Record<string, unknown>;
    const data = discordCall.data as unknown as unknown as Record<string, unknown>;
    const matchResults = data.match_results as Array<Record<string, string>>;
    expect(matchResults).toHaveLength(1);
    expect(matchResults[0].player_2_name).toBe('Player 2');
  });

  it('returns safeErrorResponse on auth failure', async () => {
    const { AuthError } = await import('@/lib/auth/helpers');
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Forbidden', 403),
    );

    const request = {
      json: vi.fn().mockResolvedValue({ status: 'active' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('Forbidden');
  });
});
