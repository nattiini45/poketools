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
  getRoundsByTournament: vi.fn(),
  updateRoundStatus: vi.fn(),
  completeRound: vi.fn(),
  updateRoundBestOf: vi.fn(),
  updateRoundDeadline: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
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

vi.mock('@/lib/format-engine/runtime/hooks', () => ({ onRoundCompleted: vi.fn() }));

import { GET, PATCH } from '@/app/api/tournaments/[id]/rounds/[rid]/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import {
  getRoundById,
  getRoundsByTournament,
  updateRoundStatus,
  completeRound,
  updateRoundBestOf,
  updateRoundDeadline,
} from '@/lib/supabase/queries/rounds';
import { logAuditEvent } from '@/lib/audit/log';
import { getMatchesByRound, getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { triggerTournamentReport } from '@/lib/ai/trigger';
import { onRoundCompleted } from '@/lib/format-engine/runtime/hooks';
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
    bye_player_ids: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** `completeRound` moved the round; `unfinished` is what it counted under the lock of the round row. */
function claimed(round: Round, unfinished = 0) {
  return { outcome: 'completed' as const, round, unfinished };
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
    vi.mocked(requireResourceAdmin).mockResolvedValue({
      playerId: 'admin-1',
      name: 'Admin One',
      isAdmin: false,
    } as never);
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
    expect(vi.mocked(updateRoundStatus)).toHaveBeenCalledWith(R_ID, 'active', 'pending');
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
    vi.mocked(completeRound).mockResolvedValue(claimed(completedRound));
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
    vi.mocked(completeRound).mockResolvedValue(claimed(completedRound));
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

  describe('Swiss byes in the round_completed standings', () => {
    async function patchComplete(bracketType: string) {
      const round = makeRound({ status: 'active', round_number: 2 });
      vi.mocked(getRoundById).mockResolvedValue(round);
      vi.mocked(completeRound).mockResolvedValue(claimed(makeRound({ status: 'completed', round_number: 2 })));
      vi.mocked(getTournamentById).mockResolvedValue({
        id: T_ID,
        name: 'Harbor Cup Spring',
        season_id: 'season-1',
        bracket_type: bracketType,
      } as never);
      vi.mocked(getRoundsByTournament).mockResolvedValue([
        makeRound({ round_number: 1, bye_player_ids: ['p3'] }),
        makeRound({ round_number: 2, bye_player_ids: ['p4'] }),
      ]);
      vi.mocked(getMatchesByRound).mockResolvedValue([] as never);
      vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as never);
      vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1', name: 'Player 1' }] as never);
      vi.mocked(computeStandingsForSeason).mockResolvedValue([] as never);

      const request = {
        json: vi.fn().mockResolvedValue({ status: 'completed' }),
      } as unknown as NextRequest;
      await PATCH(request, { params: Promise.resolve({ id: T_ID, rid: R_ID }) });
    }

    it('passes a Swiss tournament byes to the current and the previous table', async () => {
      await patchComplete('swiss');

      const calls = vi.mocked(computeStandingsForSeason).mock.calls;
      expect(calls).toHaveLength(2);
      const expectedByes = [
        { player_id: 'p3', round_number: 1 },
        { player_id: 'p4', round_number: 2 },
      ];
      // (seasonId, ids, names, matches, avatars, options)
      expect(calls[0][5]).toEqual({ byes: expectedByes });
      expect(calls[1][5]).toEqual({ maxRound: 1, byes: expectedByes });
    });

    it('passes no byes for a round robin tournament and reads no rounds for them', async () => {
      await patchComplete('round_robin');

      for (const call of vi.mocked(computeStandingsForSeason).mock.calls) {
        expect(call[5]).toEqual(expect.objectContaining({ byes: [] }));
      }
      expect(getRoundsByTournament).not.toHaveBeenCalled();
    });
  });

  describe('completing a round with unfinished matches', () => {
    const patchBody = (body: Record<string, unknown>) =>
      ({ json: vi.fn().mockResolvedValue(body) }) as unknown as NextRequest;
    const call = (body: Record<string, unknown>) =>
      PATCH(patchBody(body), { params: Promise.resolve({ id: T_ID, rid: R_ID }) });

    beforeEach(() => {
      vi.mocked(getRoundById).mockResolvedValue(makeRound({ status: 'active', round_number: 2 }));
      vi.mocked(completeRound).mockResolvedValue(claimed(makeRound({ status: 'completed', round_number: 2 })));
      vi.mocked(getTournamentById).mockResolvedValue({ id: T_ID, name: 'Cup', season_id: 'season-1' } as never);
      vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as never);
      vi.mocked(getParticipants).mockResolvedValue([] as never);
      vi.mocked(computeStandingsForSeason).mockResolvedValue([] as never);
    });

    function expectNothingWritten() {
      expect(updateRoundStatus).not.toHaveBeenCalled();
      expect(completeRound).not.toHaveBeenCalled();
      expect(updateRoundBestOf).not.toHaveBeenCalled();
      expect(updateRoundDeadline).not.toHaveBeenCalled();
      expect(revalidateTag).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
      expect(emitDiscordEvent).not.toHaveBeenCalled();
      expect(emitSocialEvent).not.toHaveBeenCalled();
      expect(triggerTournamentReport).not.toHaveBeenCalled();
    }

    it.each(['scheduled', 'in_progress', 'pending_confirmation', 'disputed'])(
      'refuses with 409 round_matches_unfinished while a match is %s, and writes nothing',
      async (status) => {
        vi.mocked(getMatchesByRound).mockResolvedValue([
          makeMatchForRound({ id: 'm-1' }),
          makeMatchForRound({ id: 'm-2', status }),
        ] as never);

        const response = await call({ status: 'completed' });
        const payload = await response.json();

        expect(response.status).toBe(409);
        expect(payload.code).toBe('round_matches_unfinished');
        expect(payload.params).toEqual({ round: 'Round 1', count: 1 });
        expectNothingWritten();
      }
    );

    it('counts every unfinished match', async () => {
      vi.mocked(getMatchesByRound).mockResolvedValue([
        makeMatchForRound({ id: 'm-1', status: 'scheduled' }),
        makeMatchForRound({ id: 'm-2', status: 'disputed' }),
        makeMatchForRound({ id: 'm-3' }),
      ] as never);

      const payload = await (await call({ status: 'completed' })).json();

      expect(payload.params).toEqual({ round: 'Round 1', count: 2 });
    });

    it('refuses before any other field of the same request is written', async () => {
      vi.mocked(getRoundById).mockResolvedValue(makeRound({ status: 'pending' }));
      vi.mocked(getMatchesByRound).mockResolvedValue([makeMatchForRound({ status: 'scheduled' })] as never);

      const response = await call({ status: 'completed', best_of: 5, deadline: '2026-11-01T18:00:00Z' });

      expect(response.status).toBe(409);
      expectNothingWritten();
    });

    it('completes a round whose matches are all completed, firing the event and the recap (no audit of a force)', async () => {
      vi.mocked(getMatchesByRound).mockResolvedValue([makeMatchForRound({ id: 'm-1' }), makeMatchForRound({ id: 'm-2' })] as never);

      const response = await call({ status: 'completed' });

      expect(response.status).toBe(200);
      expect(completeRound).toHaveBeenCalledWith(R_ID, { force: false });
      expect(emitDiscordEvent).toHaveBeenCalledTimes(1);
      expect(triggerTournamentReport).toHaveBeenCalledWith(T_ID, R_ID, 'round_recap');
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('treats force on a fully finished round like a normal completion: no force audit', async () => {
      vi.mocked(getMatchesByRound).mockResolvedValue([makeMatchForRound()] as never);

      const response = await call({ status: 'completed', force: true, reason: 'Not needed' });

      expect(response.status).toBe(200);
      expect(emitDiscordEvent).toHaveBeenCalledTimes(1);
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('force-completes with a reason: writes, audits round.force_complete once, and still fires the event', async () => {
      vi.mocked(getMatchesByRound).mockResolvedValue([
        makeMatchForRound({ id: 'm-1' }),
        makeMatchForRound({ id: 'm-2', status: 'disputed' }),
      ] as never);

      vi.mocked(completeRound).mockResolvedValue(claimed(makeRound({ status: 'completed', round_number: 2 }), 1));

      const response = await call({ status: 'completed', force: true, reason: '  Opponent never showed up  ' });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.data.status).toBe('completed');
      expect(completeRound).toHaveBeenCalledWith(R_ID, { force: true });
      expect(vi.mocked(logAuditEvent).mock.calls.filter(([e]) => e.action === 'round.force_complete')).toHaveLength(1);
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_id: 'admin-1',
          actor_name: 'Admin One',
          action: 'round.force_complete',
          resource_type: 'round',
          resource_id: R_ID,
          changes: { status: { before: 'active', after: 'completed' } },
          metadata: expect.objectContaining({
            tournament_id: T_ID,
            unfinished_matches: 1,
            reason: 'Opponent never showed up',
          }),
        })
      );
      expect(emitDiscordEvent).toHaveBeenCalledTimes(1);
      expect(triggerTournamentReport).toHaveBeenCalledWith(T_ID, R_ID, 'round_recap');
    });

    it('audits the unfinished matches counted under the lock, not the ones the earlier read saw', async () => {
      // The read before the write saw one open match; a challenge accepted before the claim took the lock made it two.
      vi.mocked(getMatchesByRound).mockResolvedValue([makeMatchForRound({ id: 'm-1', status: 'disputed' })] as never);
      vi.mocked(completeRound).mockResolvedValue(claimed(makeRound({ status: 'completed', round_number: 2 }), 2));

      const response = await call({ status: 'completed', force: true, reason: 'Opponent never showed up' });

      expect(response.status).toBe(200);
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'round.force_complete', metadata: expect.objectContaining({ unfinished_matches: 2 }) })
      );
    });

    it('refuses with 409 when a match appeared between the read and the locked claim (a challenge accepted meanwhile), with no side effect', async () => {
      vi.mocked(getMatchesByRound).mockResolvedValue([makeMatchForRound({ id: 'm-1' })] as never);
      vi.mocked(completeRound).mockResolvedValue({ outcome: 'unfinished', unfinished: 1 });

      const response = await call({ status: 'completed' });
      const payload = await response.json();

      expect(response.status).toBe(409);
      expect(payload.code).toBe('round_matches_unfinished');
      expect(payload.params).toEqual({ round: 'Round 1', count: 1 });
      expect(completeRound).toHaveBeenCalledWith(R_ID, { force: false });
      expect(logAuditEvent).not.toHaveBeenCalled();
      expect(emitDiscordEvent).not.toHaveBeenCalled();
      expect(emitSocialEvent).not.toHaveBeenCalled();
      expect(triggerTournamentReport).not.toHaveBeenCalled();
    });

    // The refusal from the first read precedes every write; the locked refusal cannot, because the new match is only
    // visible under the lock. What it does guarantee is no completion and no side effect, and a retry converges.
    it('refuses at the locked claim after a best_of write of the same request: the round stays open and nothing else is written', async () => {
      vi.mocked(getRoundById).mockResolvedValue(makeRound({ status: 'pending', round_number: 2 }));
      vi.mocked(getMatchesByRound).mockResolvedValue([] as never);
      vi.mocked(updateRoundBestOf).mockResolvedValue(makeRound({ status: 'pending', round_number: 2, best_of: 5 }));
      vi.mocked(completeRound).mockResolvedValue({ outcome: 'unfinished', unfinished: 1 });

      const response = await call({ status: 'completed', best_of: 5, deadline: '2026-11-01T18:00:00Z' });
      const payload = await response.json();

      expect(response.status).toBe(409);
      expect(payload.code).toBe('round_matches_unfinished');
      expect(payload.params).toEqual({ round: 'Round 1', count: 1 });
      expect(updateRoundBestOf).toHaveBeenCalledWith(R_ID, 5);
      expect(completeRound).toHaveBeenCalledTimes(1);
      // Neither the deadline nor the status, the audit nor an event follows the refusal. The best_of write did commit, so its
      // reads expire all the same.
      expect(updateRoundStatus).not.toHaveBeenCalled();
      expect(updateRoundDeadline).not.toHaveBeenCalled();
      expect(revalidateTag).toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
      expect(emitDiscordEvent).not.toHaveBeenCalled();
      expect(emitSocialEvent).not.toHaveBeenCalled();
      expect(triggerTournamentReport).not.toHaveBeenCalled();
    });

    it.each([
      ['no reason', { status: 'completed', force: true }],
      ['a blank reason', { status: 'completed', force: true, reason: '   ' }],
      ['an over-long reason', { status: 'completed', force: true, reason: 'x'.repeat(501) }],
    ])('answers 400 validation_failed for force with %s, reading no matches', async (_label, body) => {
      const response = await call(body);
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.code).toBe('validation_failed');
      expect(getMatchesByRound).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    it('does not read the matches for any other status change', async () => {
      const response = await call({ status: 'active' });

      expect(response.status).toBe(200);
      expect(getMatchesByRound).not.toHaveBeenCalled();
    });

    it('lets a denied admin write and audit nothing (403 from the live guard, before the body is read)', async () => {
      vi.mocked(requireResourceAdmin).mockRejectedValue(
        Object.assign(new Error('Forbidden'), { name: 'AuthError', statusCode: 403 })
      );

      const response = await call({ status: 'completed', force: true, reason: 'x' });

      expect(response.status).toBe(403);
      expect(getMatchesByRound).not.toHaveBeenCalled();
      expectNothingWritten();
    });
  });

  describe('completion side effects fire only on a real transition', () => {
    const call = (body: Record<string, unknown>) =>
      PATCH(({ json: vi.fn().mockResolvedValue(body) }) as unknown as NextRequest, {
        params: Promise.resolve({ id: T_ID, rid: R_ID }),
      });

    const openMatches = () =>
      [makeMatchForRound({ id: 'm-1' }), makeMatchForRound({ id: 'm-2', status: 'disputed' })] as never;

    beforeEach(() => {
      vi.mocked(getTournamentById).mockResolvedValue({ id: T_ID, name: 'Cup', season_id: 'season-1' } as never);
      vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as never);
      vi.mocked(getParticipants).mockResolvedValue([] as never);
      vi.mocked(computeStandingsForSeason).mockResolvedValue([] as never);
    });

    function expectNoCompletionSideEffects() {
      expect(logAuditEvent).not.toHaveBeenCalled();
      expect(emitDiscordEvent).not.toHaveBeenCalled();
      expect(emitSocialEvent).not.toHaveBeenCalled();
      expect(triggerTournamentReport).not.toHaveBeenCalled();
    }

    it('answers a repeated normal completion with the round and no side effect', async () => {
      vi.mocked(getRoundById).mockResolvedValue(makeRound({ status: 'completed' }));
      vi.mocked(getMatchesByRound).mockResolvedValue([makeMatchForRound()] as never);

      const response = await call({ status: 'completed' });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.data.status).toBe('completed');
      expect(completeRound).not.toHaveBeenCalled();
      expect(updateRoundStatus).not.toHaveBeenCalled();
      expectNoCompletionSideEffects();
    });

    it('answers a repeated forced completion with no second audit, event or recap while matches stay open', async () => {
      vi.mocked(getRoundById).mockResolvedValue(makeRound({ status: 'completed' }));
      vi.mocked(getMatchesByRound).mockResolvedValue(openMatches());

      const response = await call({ status: 'completed', force: true, reason: 'Opponent never showed up' });

      expect(response.status).toBe(200);
      expect(completeRound).not.toHaveBeenCalled();
      expectNoCompletionSideEffects();
    });

    it('answers a repeat without force on a completed round that holds open matches with the round, not a 409', async () => {
      vi.mocked(getRoundById).mockResolvedValue(makeRound({ status: 'completed' }));
      vi.mocked(getMatchesByRound).mockResolvedValue(openMatches());

      const response = await call({ status: 'completed' });

      expect(response.status).toBe(200);
      expectNoCompletionSideEffects();
    });

    it('lets only the submission that wins the atomic claim act when two overlap', async () => {
      // Both submissions read the round as active; the conditional update changes a row for one of them only.
      vi.mocked(getRoundById)
        .mockResolvedValueOnce(makeRound({ status: 'active' }))
        .mockResolvedValueOnce(makeRound({ status: 'active' }))
        .mockResolvedValue(makeRound({ status: 'completed' }));
      vi.mocked(getMatchesByRound).mockResolvedValue(openMatches());
      vi.mocked(completeRound)
        .mockResolvedValueOnce(claimed(makeRound({ status: 'completed' }), 1))
        .mockResolvedValueOnce({ outcome: 'unchanged' });
      const body = { status: 'completed', force: true, reason: 'Opponent never showed up' };

      const [first, second] = await Promise.all([call(body), call(body)]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect((await second.json()).data.status).toBe('completed');
      expect(vi.mocked(logAuditEvent).mock.calls.filter(([e]) => e.action === 'round.force_complete')).toHaveLength(1);
      expect(emitDiscordEvent).toHaveBeenCalledTimes(1);
      expect(emitSocialEvent).toHaveBeenCalledTimes(1);
      expect(triggerTournamentReport).toHaveBeenCalledTimes(1);
    });

    it('answers 404 round_not_found when a lost claim finds the round gone, with no side effect', async () => {
      vi.mocked(getRoundById)
        .mockResolvedValueOnce(makeRound({ status: 'active' }))
        .mockResolvedValue(null as never);
      vi.mocked(getMatchesByRound).mockResolvedValue([makeMatchForRound()] as never);
      vi.mocked(completeRound).mockResolvedValue({ outcome: 'unchanged' });

      const response = await call({ status: 'completed' });

      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe('round_not_found');
      expectNoCompletionSideEffects();
    });
  });

  it('does not break when Discord event assembly throws', async () => {
    const round = makeRound({ status: 'active' });
    const completedRound = makeRound({ status: 'completed' });
    vi.mocked(getRoundById).mockResolvedValue(round);
    vi.mocked(completeRound).mockResolvedValue(claimed(completedRound));
    vi.mocked(getTournamentById).mockResolvedValue({ id: T_ID, season_id: null, name: 'Cup' } as never);
    vi.mocked(getMatchesByRound).mockResolvedValue([] as never);
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
    vi.mocked(completeRound).mockResolvedValue(claimed(makeRound({ status: 'completed' })));
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

  describe('deadline', () => {
    const DEADLINE = '2026-11-01T18:00:00.000Z';

    function patch(body: unknown) {
      const request = { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
      return PATCH(request, { params: Promise.resolve({ id: T_ID, rid: R_ID }) });
    }

    it('sets the deadline, expires the tournament and league reads, and audits the change', async () => {
      vi.mocked(getRoundById).mockResolvedValue(makeRound());
      vi.mocked(getTournamentById).mockResolvedValueOnce({ id: T_ID, season_id: 'season-1' } as never);
      vi.mocked(updateRoundDeadline).mockResolvedValue(makeRound({ deadline: DEADLINE }));

      const response = await patch({ deadline: DEADLINE });
      const payload = await response.json() as { success: boolean; data: Round };

      expect(response.status).toBe(200);
      expect(payload.data.deadline).toBe(DEADLINE);
      expect(vi.mocked(updateRoundDeadline)).toHaveBeenCalledWith(R_ID, DEADLINE);
      expect(vi.mocked(updateRoundStatus)).not.toHaveBeenCalled();
      expect(vi.mocked(updateRoundBestOf)).not.toHaveBeenCalled();

      const tags = vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag);
      expect(tags).toEqual(expect.arrayContaining([`tournament:${T_ID}`, 'season:season-1']));
      expect(vi.mocked(updateRoundDeadline).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(revalidateTag).mock.invocationCallOrder[0],
      );

      expect(vi.mocked(logAuditEvent)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_id: 'admin-1',
          actor_name: 'Admin One',
          resource_type: 'round',
          resource_id: R_ID,
          changes: { deadline: { before: null, after: DEADLINE } },
          metadata: { tournament_id: T_ID, field: 'deadline' },
        }),
      );
    });

    it('accepts an offset deadline', async () => {
      const offset = '2026-11-01T19:00:00+01:00';
      vi.mocked(getRoundById).mockResolvedValue(makeRound());
      vi.mocked(updateRoundDeadline).mockResolvedValue(makeRound({ deadline: DEADLINE }));

      const response = await patch({ deadline: offset });

      expect(response.status).toBe(200);
      expect(vi.mocked(updateRoundDeadline)).toHaveBeenCalledWith(R_ID, offset);
    });

    it('clears the deadline with null and audits the change', async () => {
      vi.mocked(getRoundById).mockResolvedValue(makeRound({ deadline: DEADLINE }));
      vi.mocked(updateRoundDeadline).mockResolvedValue(makeRound({ deadline: null }));

      const response = await patch({ deadline: null });
      const payload = await response.json() as { success: boolean; data: Round };

      expect(response.status).toBe(200);
      expect(payload.data.deadline).toBeNull();
      expect(vi.mocked(updateRoundDeadline)).toHaveBeenCalledWith(R_ID, null);
      expect(vi.mocked(revalidateTag)).toHaveBeenCalled();
      expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(
        expect.objectContaining({ changes: { deadline: { before: DEADLINE, after: null } } }),
      );
    });

    it('does not audit a deadline that names the same instant', async () => {
      vi.mocked(getRoundById).mockResolvedValue(makeRound({ deadline: '2026-11-01T18:00:00+00:00' }));
      vi.mocked(updateRoundDeadline).mockResolvedValue(makeRound({ deadline: '2026-11-01T18:00:00+00:00' }));

      const response = await patch({ deadline: DEADLINE });

      expect(response.status).toBe(200);
      expect(vi.mocked(logAuditEvent)).not.toHaveBeenCalled();
    });

    it('leaves the deadline alone when the body does not name it', async () => {
      vi.mocked(getRoundById).mockResolvedValue(makeRound({ deadline: DEADLINE }));
      vi.mocked(updateRoundStatus).mockResolvedValue(makeRound({ status: 'active', deadline: DEADLINE }));

      const response = await patch({ status: 'active' });

      expect(response.status).toBe(200);
      expect(vi.mocked(updateRoundDeadline)).not.toHaveBeenCalled();
      expect(vi.mocked(logAuditEvent)).not.toHaveBeenCalled();
    });

    it('sets the deadline together with a status change', async () => {
      vi.mocked(getRoundById).mockResolvedValue(makeRound());
      vi.mocked(updateRoundStatus).mockResolvedValue(makeRound({ status: 'active' }));
      vi.mocked(updateRoundDeadline).mockResolvedValue(makeRound({ status: 'active', deadline: DEADLINE }));

      const response = await patch({ status: 'active', deadline: DEADLINE });
      const payload = await response.json() as { success: boolean; data: Round };

      expect(response.status).toBe(200);
      expect(payload.data).toMatchObject({ status: 'active', deadline: DEADLINE });
      expect(vi.mocked(updateRoundStatus)).toHaveBeenCalledWith(R_ID, 'active', 'pending');
      expect(vi.mocked(updateRoundDeadline)).toHaveBeenCalledWith(R_ID, DEADLINE);
    });

    it.each([
      ['a date without a time', '2026-11-01'],
      ['a time without an offset', '2026-11-01T18:00:00'],
      ['free text', 'next friday'],
      ['an empty string', ''],
      ['a number', 1_792_000_000_000],
    ])('rejects %s with validation_failed and writes nothing', async (_label, deadline) => {
      const response = await patch({ deadline });
      const payload = await response.json() as { success: boolean; code?: string };

      expect(response.status).toBe(400);
      expect(payload.code).toBe('validation_failed');
      expect(vi.mocked(getRoundById)).not.toHaveBeenCalled();
      expect(vi.mocked(updateRoundDeadline)).not.toHaveBeenCalled();
      expect(vi.mocked(logAuditEvent)).not.toHaveBeenCalled();
      expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
    });

    it('runs the auth guard first: a denied admin writes and audits nothing', async () => {
      const { AuthError } = await import('@/lib/auth/helpers');
      vi.mocked(requireResourceAdmin).mockRejectedValueOnce(
        new (AuthError as unknown as new (m: string, s: number) => Error)('Forbidden', 403),
      );

      const response = await patch({ deadline: DEADLINE });

      expect(response.status).toBe(403);
      expect(vi.mocked(requireResourceAdmin)).toHaveBeenCalledWith('tournament', T_ID);
      expect(vi.mocked(getRoundById)).not.toHaveBeenCalled();
      expect(vi.mocked(updateRoundDeadline)).not.toHaveBeenCalled();
      expect(vi.mocked(logAuditEvent)).not.toHaveBeenCalled();
    });

    it('rejects a round of another tournament before writing the deadline', async () => {
      vi.mocked(getRoundById).mockResolvedValue(makeRound({ tournament_id: 'tournament-2' }));

      const response = await patch({ deadline: DEADLINE });
      const payload = await response.json() as { code?: string };

      expect(response.status).toBe(404);
      expect(payload.code).toBe('round_wrong_tournament');
      expect(vi.mocked(updateRoundDeadline)).not.toHaveBeenCalled();
    });

    it('answers a failed write with a safe 500 and no expiry or audit', async () => {
      vi.mocked(getRoundById).mockResolvedValue(makeRound());
      vi.mocked(updateRoundDeadline).mockRejectedValue(new Error('db password leaked'));

      const response = await patch({ deadline: DEADLINE });
      const payload = await response.json() as { success: boolean; error?: string };

      expect(response.status).toBe(500);
      expect(payload.error).toBe('Failed to update round');
      expect(JSON.stringify(payload)).not.toContain('leaked');
      expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
      expect(vi.mocked(logAuditEvent)).not.toHaveBeenCalled();
    });
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

describe('PATCH /api/tournaments/[id]/rounds/[rid]: the round_end event of a kit league', () => {
  const call = (body: Record<string, unknown>) =>
    PATCH(({ json: vi.fn().mockResolvedValue(body) }) as unknown as NextRequest, {
      params: Promise.resolve({ id: T_ID, rid: R_ID }),
    });
  const kit = { id: T_ID, name: 'Cup', season_id: 'season-1', season_format_type: 'custom' };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin One', isAdmin: false } as never);
    vi.mocked(getRoundById).mockResolvedValue(makeRound({ status: 'active', round_number: 2 }));
    vi.mocked(completeRound).mockResolvedValue(claimed(makeRound({ status: 'completed', round_number: 2 })));
    vi.mocked(getMatchesByRound).mockResolvedValue([makeMatchForRound()] as never);
    vi.mocked(getTournamentById).mockResolvedValue(kit as never);
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as never);
    vi.mocked(getParticipants).mockResolvedValue([] as never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue([] as never);
    vi.mocked(onRoundCompleted).mockResolvedValue(true);
  });

  it('fires the hook once for the call that completed the round, before the round recap is announced', async () => {
    const order: string[] = [];
    vi.mocked(onRoundCompleted).mockImplementation(async () => {
      order.push('hook');
      return true;
    });
    vi.mocked(emitDiscordEvent).mockImplementation((() => {
      order.push('discord');
    }) as never);

    const response = await call({ status: 'completed' });

    expect(response.status).toBe(200);
    expect(onRoundCompleted).toHaveBeenCalledTimes(1);
    expect(onRoundCompleted).toHaveBeenCalledWith({ tournament: kit, roundId: R_ID });
    expect(order).toEqual(['hook', 'discord']);
  });

  it('fires it for a forced completion as well', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValue([makeMatchForRound(), makeMatchForRound({ id: 'm-2', status: 'disputed' })] as never);
    vi.mocked(completeRound).mockResolvedValue(claimed(makeRound({ status: 'completed', round_number: 2 }), 1));

    const response = await call({ status: 'completed', force: true, reason: 'Opponent never showed up' });

    expect(response.status).toBe(200);
    expect(onRoundCompleted).toHaveBeenCalledTimes(1);
  });

  it('answers 200 with the completed round when the hook reports a failure: the completion stands and the cron fires the event', async () => {
    vi.mocked(onRoundCompleted).mockResolvedValue(false);

    const response = await call({ status: 'completed' });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.status).toBe('completed');
    expect(emitDiscordEvent).toHaveBeenCalledTimes(1);
  });

  it('does not fire it for a repeat, another status or a lost claim', async () => {
    // a repeat: the round is already completed
    vi.mocked(getRoundById).mockResolvedValue(makeRound({ status: 'completed', round_number: 2 }));
    await call({ status: 'completed' });
    // another status
    vi.mocked(getRoundById).mockResolvedValue(makeRound({ status: 'pending' }));
    vi.mocked(updateRoundStatus).mockResolvedValue(makeRound({ status: 'active' }));
    await call({ status: 'active' });
    // a lost claim: another call completed the round first
    vi.mocked(getRoundById).mockReset();
    vi.mocked(getRoundById).mockResolvedValueOnce(makeRound({ status: 'active' })).mockResolvedValue(makeRound({ status: 'completed' }));
    vi.mocked(completeRound).mockResolvedValue({ outcome: 'unchanged' });
    await call({ status: 'completed' });

    expect(onRoundCompleted).not.toHaveBeenCalled();
  });

  it('does not reach the hook module for a league that is no custom league', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ ...kit, season_format_type: 'swiss' } as never);

    const response = await call({ status: 'completed' });

    expect(response.status).toBe(200);
    expect(onRoundCompleted).not.toHaveBeenCalled();
  });

  it('refuses before the hook: a round with unfinished matches is not completed and fires nothing', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValue([makeMatchForRound({ id: 'm-2', status: 'disputed' })] as never);

    const response = await call({ status: 'completed' });

    expect(response.status).toBe(409);
    expect(onRoundCompleted).not.toHaveBeenCalled();
  });
});
