import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
  updateTournament: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
  createRound: vi.fn(),
  updateRoundByePlayers: vi.fn(),
  updateRoundStatus: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  createMatchBatch: vi.fn(),
  getMatchesByTournament: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: vi.fn(),
  createGroupBatch: vi.fn(),
  deleteGroupsByTournament: vi.fn(),
  addGroupMembersBatch: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/season-groups', () => ({
  getSeasonGroups: vi.fn(),
  seasonHasGroups: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

vi.mock('@/lib/tournament/round-robin', () => ({
  generateRoundRobinRound: vi.fn(),
  getRoundRobinTotalRounds: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { POST } from '@/app/api/tournaments/[id]/generate-all-rounds/route';
import { requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import {
  getTournamentById,
  getParticipants,
  updateTournament,
} from '@/lib/supabase/queries/tournaments';
import {
  getRoundsByTournament,
  createRound,
  updateRoundByePlayers,
  updateRoundStatus,
} from '@/lib/supabase/queries/rounds';
import { createMatchBatch, getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { revalidateTag } from 'next/cache';
import { logAuditEvent } from '@/lib/audit/log';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import {
  generateRoundRobinRound,
  getRoundRobinTotalRounds,
} from '@/lib/tournament/round-robin';

// ─── Helpers ────────────────────────────────────────────────────────

const ADMIN = { playerId: 'admin-1', name: 'Admin' };

const routeParams = { params: Promise.resolve({ id: 'a5cb20ac-a127-482d-855d-d802e29185bc' }) };

const mockTournament = {
  id: 'a5cb20ac-a127-482d-855d-d802e29185bc',
  bracket_type: 'round_robin',
  status: 'active',
  current_round: 0,
  best_of_default: 3,
  bo_overrides: {} as Record<string, number>,
};

// ─── Tests ──────────────────────────────────────────────────────────

describe('POST /api/tournaments/[id]/generate-all-rounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth error when not resource admin', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
  });

  it('returns 404 when tournament not found', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue(null);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Tournament not found');
    expect(json.code).toBe('tournament_not_found');
  });

  it('returns 400 for non-round_robin tournaments', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue({ ...mockTournament, bracket_type: 'single_elimination' } as never);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('only supported for round_robin');
    expect(json.code).toBe('rounds_round_robin_only');
  });

  it('returns 400 for completed tournaments', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue({ ...mockTournament, status: 'completed' } as never);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('already completed');
    expect(json.code).toBe('tournament_already_completed');
  });

  it('returns 400 when fewer than 2 participants', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1' }] as never);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('at least 2 participants');
    expect(json.code).toBe('tournament_participants_too_few');
  });

  it('returns 400 when all rounds already generated', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { id: 'r-1', round_number: 1 },
      { id: 'r-2', round_number: 2 },
      { id: 'r-3', round_number: 3 },
    ] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([
      { id: 'm-1', round_id: 'r-1' },
      { id: 'm-2', round_id: 'r-2' },
      { id: 'm-3', round_id: 'r-3' },
    ] as never);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(getRoundRobinTotalRounds).mockReturnValue(3);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('already been generated');
    expect(json.code).toBe('rounds_all_generated');
  });

  it('creates all missing rounds and returns 201', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue({ ...mockTournament, status: 'upcoming' } as never);
    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' },
    ] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(getRoundRobinTotalRounds).mockReturnValue(3);
    vi.mocked(generateRoundRobinRound).mockReturnValue({
      pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }],
      bye_player_ids: [],
    } as never);
    vi.mocked(createRound).mockImplementation(async (input) => ({
      id: `round-${input.round_number}`,
      ...input,
    }) as never);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(3);
    expect(createMatchBatch).toHaveBeenCalledTimes(3);
    expect(updateTournament).toHaveBeenCalledWith('a5cb20ac-a127-482d-855d-d802e29185bc', expect.objectContaining({ status: 'active' }));
    // D37: the new pairings show on the next view.
    expect(revalidateTag).toHaveBeenCalledWith('tournament:a5cb20ac-a127-482d-855d-d802e29185bc', { expire: 0 });
  });

  it('refills a round an interrupted call wrote without matches instead of skipping it', async () => {
    // Round 2 was written, its match batch failed, and current_round stayed at 1: the retry fills round 2 and
    // writes round 3, never leaving round 2 empty.
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue({ ...mockTournament, current_round: 1 } as never);
    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' },
    ] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { id: 'r-1', round_number: 1 },
      { id: 'r-2-empty', round_number: 2 },
    ] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([{ id: 'm-1', round_id: 'r-1' }] as never);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(getRoundRobinTotalRounds).mockReturnValue(3);
    vi.mocked(generateRoundRobinRound).mockImplementation((_ids, round) => ({
      round_number: round,
      round_name: `Round ${round}`,
      pairings: [{ player_1_id: 'p1', player_2_id: `p${round + 1}` }],
      bye_player_ids: [],
    }));
    vi.mocked(createRound).mockImplementation(async (input) => ({
      id: `round-${input.round_number}`,
      ...input,
    }) as never);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.map((round: { id: string }) => round.id)).toEqual(['r-2-empty', 'round-3']);
    expect(createRound).toHaveBeenCalledTimes(1);
    expect(createRound).toHaveBeenCalledWith(expect.objectContaining({ round_number: 3 }));
    expect(createMatchBatch).toHaveBeenCalledWith([
      { round_id: 'r-2-empty', tournament_id: mockTournament.id, player_1_id: 'p1', player_2_id: 'p3' },
    ]);
    expect(createMatchBatch).toHaveBeenCalledWith([
      { round_id: 'round-3', tournament_id: mockTournament.id, player_1_id: 'p1', player_2_id: 'p4' },
    ]);
    expect(updateTournament).toHaveBeenCalledWith(mockTournament.id, expect.objectContaining({ current_round: 3 }));
  });

  it('refills the last round when only it was left without matches (no rounds_all_generated dead end)', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue({ ...mockTournament, current_round: 2 } as never);
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { id: 'r-1', round_number: 1 },
      { id: 'r-2', round_number: 2 },
      { id: 'r-3-empty', round_number: 3 },
    ] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([
      { id: 'm-1', round_id: 'r-1' },
      { id: 'm-2', round_id: 'r-2' },
    ] as never);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(getRoundRobinTotalRounds).mockReturnValue(3);
    vi.mocked(generateRoundRobinRound).mockReturnValue({
      pairings: [{ player_1_id: 'p2', player_2_id: 'p3' }],
      bye_player_ids: [],
    } as never);

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
    expect(createRound).not.toHaveBeenCalled();
    expect(createMatchBatch).toHaveBeenCalledTimes(1);
    expect(createMatchBatch).toHaveBeenCalledWith([
      { round_id: 'r-3-empty', tournament_id: mockTournament.id, player_1_id: 'p2', player_2_id: 'p3' },
    ]);
    expect(updateTournament).toHaveBeenCalledWith(mockTournament.id, expect.objectContaining({ current_round: 3 }));
  });

  it('a standalone tournament with equal groups keeps the old rounds: every group round w in week w', async () => {
    // The week plan runs on the real circle method.
    const actual = await vi.importActual<typeof import('@/lib/tournament/round-robin')>('@/lib/tournament/round-robin');
    vi.mocked(generateRoundRobinRound).mockImplementation(actual.generateRoundRobinRound);
    vi.mocked(getRoundRobinTotalRounds).mockImplementation(actual.getRoundRobinTotalRounds);
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue({ ...mockTournament, season_id: null } as never);
    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' },
    ] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([
      { id: 'g1', group_number: 1, members: [{ player_id: 'p1', seed: 1 }, { player_id: 'p2', seed: 2 }] },
      { id: 'g2', group_number: 2, members: [{ player_id: 'p3', seed: 1 }, { player_id: 'p4', seed: 2 }] },
    ] as never);
    vi.mocked(createRound).mockResolvedValue({ id: 'round-1', round_number: 1 } as never);

    const res = await POST({} as NextRequest, routeParams);
    await res.json();

    expect(res.status).toBe(201);
    expect(getSeasonGroups).not.toHaveBeenCalled();
    expect(createRound).toHaveBeenCalledTimes(1);
    expect(createMatchBatch).toHaveBeenCalledWith([
      { round_id: 'round-1', tournament_id: mockTournament.id, player_1_id: 'p1', player_2_id: 'p2' },
      { round_id: 'round-1', tournament_id: mockTournament.id, player_1_id: 'p3', player_2_id: 'p4' },
    ]);
  });

  it("stores each round's bye on the round", async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(getRoundRobinTotalRounds).mockReturnValue(3);
    vi.mocked(generateRoundRobinRound).mockImplementation(
      (_ids, roundNumber) =>
        ({
          pairings: [],
          bye_player_ids: [['p1', 'p2', 'p3'][roundNumber - 1]],
        }) as never
    );
    vi.mocked(createRound).mockImplementation(async (input) => ({
      id: `round-${input.round_number}`,
      ...input,
    }) as never);

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
    const stored = vi.mocked(createRound).mock.calls.map((call) => call[0].bye_player_ids);
    expect(stored).toEqual([['p1'], ['p2'], ['p3']]);
    expect(revalidateTag).toHaveBeenCalledWith('tournament:a5cb20ac-a127-482d-855d-d802e29185bc', { expire: 0 });
  });

  it("writes the byes onto a round it reuses instead of inserting one", async () => {
    // Round 1 was written by an interrupted call (no byes stored, no matches): the retry reuses it and still stores
    // the bye, so the reused round matches a freshly inserted one.
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { id: 'r-1-empty', round_number: 1, bye_player_ids: [] },
    ] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(getRoundRobinTotalRounds).mockReturnValue(1);
    vi.mocked(generateRoundRobinRound).mockReturnValue({
      pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }],
      bye_player_ids: ['p3'],
    } as never);
    vi.mocked(updateRoundByePlayers).mockResolvedValue({ id: 'r-1-empty', round_number: 1, bye_player_ids: ['p3'] } as never);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(createRound).not.toHaveBeenCalled();
    expect(updateRoundByePlayers).toHaveBeenCalledWith('r-1-empty', ['p3']);
    expect(json.data[0].bye_player_ids).toEqual(['p3']);
    expect(createMatchBatch).toHaveBeenCalledWith([
      { round_id: 'r-1-empty', tournament_id: mockTournament.id, player_1_id: 'p1', player_2_id: 'p2' },
    ]);
  });

  it('leaves a reused round alone when its stored byes already match', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { id: 'r-1-empty', round_number: 1, bye_player_ids: ['p3'] },
    ] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(getRoundRobinTotalRounds).mockReturnValue(1);
    vi.mocked(generateRoundRobinRound).mockReturnValue({
      pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }],
      bye_player_ids: ['p3'],
    } as never);

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
    expect(createRound).not.toHaveBeenCalled();
    expect(updateRoundByePlayers).not.toHaveBeenCalled();
  });

  it('stores no bye on the weeks of a grouped phase (the week plan pairs a free trainer across groups)', async () => {
    const actual = await vi.importActual<typeof import('@/lib/tournament/round-robin')>('@/lib/tournament/round-robin');
    vi.mocked(generateRoundRobinRound).mockImplementation(actual.generateRoundRobinRound);
    vi.mocked(getRoundRobinTotalRounds).mockImplementation(actual.getRoundRobinTotalRounds);
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue({ ...mockTournament, season_id: null } as never);
    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }, { id: 'p5' }, { id: 'p6' },
    ] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([
      { id: 'g1', group_number: 1, members: [{ player_id: 'p1', seed: 1 }, { player_id: 'p2', seed: 2 }, { player_id: 'p3', seed: 3 }] },
      { id: 'g2', group_number: 2, members: [{ player_id: 'p4', seed: 1 }, { player_id: 'p5', seed: 2 }, { player_id: 'p6', seed: 3 }] },
    ] as never);
    vi.mocked(createRound).mockImplementation(async (input) => ({
      id: `round-${input.round_number}`,
      ...input,
    }) as never);

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
    expect(createRound).toHaveBeenCalled();
    for (const call of vi.mocked(createRound).mock.calls) {
      expect(call[0].bye_player_ids).toEqual([]);
    }
  });
});

describe('POST /api/tournaments/[id]/generate-all-rounds — start_round and audit', () => {
  const bodyRequest = (body: unknown) => ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue({ ...mockTournament, name: 'Spring Open', status: 'upcoming' } as never);
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(getRoundRobinTotalRounds).mockReturnValue(3);
    vi.mocked(generateRoundRobinRound).mockReturnValue({
      pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }],
      bye_player_ids: [],
    } as never);
    vi.mocked(createRound).mockImplementation(async (input) => ({
      id: `round-${input.round_number}`,
      status: 'pending',
      ...input,
    }) as never);
    vi.mocked(updateRoundStatus).mockImplementation(
      async (id, status) => ({ id, status, round_number: Number(id.replace('round-', '')) }) as never,
    );
  });

  it('starts only the lowest created round and swaps it into the response', async () => {
    const res = await POST(bodyRequest({ start_round: true }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(updateRoundStatus).toHaveBeenCalledTimes(1);
    expect(updateRoundStatus).toHaveBeenCalledWith('round-1', 'active');
    expect(json.data).toHaveLength(3);
    expect(json.data.map((round: { status: string }) => round.status)).toEqual(['active', 'pending', 'pending']);
    // The start comes after every round and its matches are written.
    expect(vi.mocked(createMatchBatch).mock.invocationCallOrder.at(-1)!).toBeLessThan(
      vi.mocked(updateRoundStatus).mock.invocationCallOrder[0]
    );
  });

  it('starts the lowest round this call created, not round 1 when that already exists', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ ...mockTournament, current_round: 1 } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { id: 'r-1', round_number: 1, status: 'completed', bye_player_ids: [] },
    ] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([{ id: 'm-1', round_id: 'r-1' }] as never);

    const res = await POST(bodyRequest({ start_round: true }), routeParams);

    expect(res.status).toBe(201);
    expect(updateRoundStatus).toHaveBeenCalledTimes(1);
    expect(updateRoundStatus).toHaveBeenCalledWith('round-2', 'active');
  });

  it('leaves every round pending without a body, with start_round false and with an unparsable body', async () => {
    for (const request of [
      {} as NextRequest,
      bodyRequest({ start_round: false }),
      { json: () => Promise.reject(new SyntaxError('bad json')) } as unknown as NextRequest,
    ]) {
      vi.clearAllMocks();
      vi.mocked(createRound).mockImplementation(async (input) => ({ id: `round-${input.round_number}`, status: 'pending', ...input }) as never);
      vi.mocked(getTournamentById).mockResolvedValue({ ...mockTournament, status: 'upcoming' } as never);
      vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }] as never);
      vi.mocked(getRoundsByTournament).mockResolvedValue([]);
      vi.mocked(getMatchesByTournament).mockResolvedValue([]);
      vi.mocked(getGroupsByTournament).mockResolvedValue([]);
      vi.mocked(getRoundRobinTotalRounds).mockReturnValue(3);
      vi.mocked(generateRoundRobinRound).mockReturnValue({ pairings: [], bye_player_ids: [] } as never);

      const res = await POST(request, routeParams);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(updateRoundStatus).not.toHaveBeenCalled();
      expect(json.data.every((round: { status: string }) => round.status === 'pending')).toBe(true);
    }
  });

  it('keeps the rounds pending (201) when the start fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(updateRoundStatus).mockRejectedValue(new Error('db down'));

    const res = await POST(bodyRequest({ start_round: true }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.map((round: { status: string }) => round.status)).toEqual(['pending', 'pending', 'pending']);
    expect(logged).toHaveBeenCalled();
    expect(updateTournament).toHaveBeenCalled();
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({ started_round_number: null });
    logged.mockRestore();
  });

  it('rejects a malformed body with 400 validation_failed before anything is read or written', async () => {
    const res = await POST(bodyRequest({ start_round: 'yes' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(getTournamentById).not.toHaveBeenCalled();
    expect(createRound).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('records one round.generate event for the whole call', async () => {
    const res = await POST(bodyRequest({ start_round: true }), routeParams);

    expect(res.status).toBe(201);
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith({
      actor_id: 'admin-1',
      actor_name: 'Admin',
      action: 'round.generate',
      resource_type: 'tournament',
      resource_id: mockTournament.id,
      resource_name: 'Spring Open',
      metadata: { rounds_created: 3, round_numbers: [1, 2, 3], started_round_number: 1 },
    });
  });

  it('records started_round_number null by default, and nothing when the call is refused', async () => {
    await POST({} as NextRequest, routeParams);
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toEqual({
      rounds_created: 3,
      round_numbers: [1, 2, 3],
      started_round_number: null,
    });

    vi.mocked(logAuditEvent).mockClear();
    vi.mocked(getRoundsByTournament).mockResolvedValue([1, 2, 3].map((n) => ({ id: `r-${n}`, round_number: n })) as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([1, 2, 3].map((n) => ({ id: `m-${n}`, round_id: `r-${n}` })) as never);
    const refused = await POST({} as NextRequest, routeParams);
    expect(refused.status).toBe(400);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
