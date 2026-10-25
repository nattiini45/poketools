import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

// --------------- mocks ---------------

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

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
  updateSeason: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
  createRound: vi.fn(),
  updateRoundByePlayers: vi.fn(),
  updateRoundStatus: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  createMatchBatch: vi.fn(),
  getCompletedMatchRecords: vi.fn(),
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

vi.mock('@/lib/tournament', () => ({
  generateRound: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

vi.mock('@/lib/discord/notify', () => ({
  emitDiscordEvent: vi.fn(),
}));

vi.mock('@/lib/social/notify', () => ({
  emitSocialEvent: vi.fn(),
}));

vi.mock('@/lib/ai/trigger', () => ({
  triggerTournamentReport: vi.fn(),
}));

vi.mock('@/lib/feature-flags', () => ({
  ENABLE_KALE_CABBAGE: false,
}));

// --------------- imports (after mocks) ---------------

import { POST } from '@/app/api/generate-round/[tid]/route';
import { requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import {
  getTournamentById,
  getParticipants,
  updateTournament,
} from '@/lib/supabase/queries/tournaments';
import { getSeasonById, updateSeason } from '@/lib/supabase/queries/seasons';
import {
  getRoundsByTournament,
  createRound,
  updateRoundByePlayers,
  updateRoundStatus,
} from '@/lib/supabase/queries/rounds';
import {
  createMatchBatch,
  getCompletedMatchRecords,
  getMatchesByTournament,
} from '@/lib/supabase/queries/matches';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { planGroupSchedule } from '@/lib/tournament/group-schedule';
import { generateRound } from '@/lib/tournament';
import { revalidateTag } from 'next/cache';
import { logAuditEvent } from '@/lib/audit/log';

// --------------- helpers ---------------

const ADMIN = { playerId: 'admin-1', name: 'Admin' };

const routeParams = (tid: string) => ({ params: Promise.resolve({ tid }) });

const baseTournament = {
  id: 'ae13bc20-d43b-42b5-8de0-4944cb4025e3',
  name: 'Weekly #5',
  status: 'active' as const,
  season_id: 's-1',
  bracket_type: 'swiss' as const,
  current_round: 1,
  best_of_default: 3,
  bo_overrides: {} as Record<string, number>,
};

const participants = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Carol' },
  { id: 'p4', name: 'Dave' },
];

// --------------- tests ---------------

describe('POST /api/generate-round/[tid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: auth passes
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    // Happy-path defaults
    vi.mocked(getTournamentById).mockResolvedValue(baseTournament as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'completed', bye_player_ids: [] },
    ] as never);
    vi.mocked(getParticipants).mockResolvedValue(participants as never);
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as never);
    vi.mocked(getGroupsByTournament).mockResolvedValue([] as never);
    // A league without groups: the phase keeps its own groups (none here).
    vi.mocked(getSeasonGroups).mockResolvedValue([]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([]);
    vi.mocked(generateRound).mockReturnValue({
      pairings: [
        { player_1_id: 'p1', player_2_id: 'p2' },
        { player_1_id: 'p3', player_2_id: 'p4' },
      ],
      round_name: 'Round 2',
      bye_player_ids: [],
    } as never);
    vi.mocked(createRound).mockResolvedValue({
      id: 'r-2',
      tournament_id: 'ae13bc20-d43b-42b5-8de0-4944cb4025e3',
      name: 'Round 2',
      round_number: 2,
      best_of: 3,
      status: 'pending',
    } as never);
  });

  // ---- auth ----

  it('returns auth error when not a resource admin', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new AuthError('Forbidden', 403));

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('ae13bc20-d43b-42b5-8de0-4944cb4025e3'));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
  });

  // ---- validation ----

  it('returns 404 when tournament does not exist', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(null as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('503eabb7-d451-4fa4-80d5-7b4e5c39c2fb'));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toContain('not found');
    expect(payload.code).toBe('tournament_not_found');
  });

  it('returns 400 when tournament is already completed', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      status: 'completed',
    } as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('ae13bc20-d43b-42b5-8de0-4944cb4025e3'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('already completed');
    expect(payload.code).toBe('tournament_already_completed');
  });

  it('returns 400 when current round is not completed (non-round-robin)', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'active', bye_player_ids: [] },
    ] as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('ae13bc20-d43b-42b5-8de0-4944cb4025e3'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('not yet completed');
    expect(payload.code).toBe('tournament_current_round_incomplete');
  });

  it('allows generating ahead for round_robin even if current round is not completed', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      bracket_type: 'round_robin',
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'active', bye_player_ids: [] },
    ] as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('ae13bc20-d43b-42b5-8de0-4944cb4025e3'));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
  });

  it('returns 400 when fewer than 2 participants', async () => {
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1', name: 'Solo' }] as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('ae13bc20-d43b-42b5-8de0-4944cb4025e3'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('at least 2');
    expect(payload.code).toBe('tournament_participants_too_few');
  });

  // ---- happy path ----

  it('generates the next round and returns 201', async () => {
    const request = {} as NextRequest;
    const response = await POST(request, routeParams('ae13bc20-d43b-42b5-8de0-4944cb4025e3'));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.data.id).toBe('r-2');

    expect(requireResourceAdmin).toHaveBeenCalledWith('tournament', 'ae13bc20-d43b-42b5-8de0-4944cb4025e3');
    expect(createRound).toHaveBeenCalledWith(
      expect.objectContaining({
        tournament_id: 'ae13bc20-d43b-42b5-8de0-4944cb4025e3',
        round_number: 2,
        best_of: 3,
      })
    );
    expect(createMatchBatch).toHaveBeenCalledWith([
      expect.objectContaining({ round_id: 'r-2', player_1_id: 'p1', player_2_id: 'p2' }),
      expect.objectContaining({ round_id: 'r-2', player_1_id: 'p3', player_2_id: 'p4' }),
    ]);
    expect(updateTournament).toHaveBeenCalledWith('ae13bc20-d43b-42b5-8de0-4944cb4025e3', { current_round: 2 });
    // D37: the pairings show on the tournament and league pages' next view.
    expect(revalidateTag).toHaveBeenCalledWith('tournament:ae13bc20-d43b-42b5-8de0-4944cb4025e3', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith('season:s-1', { expire: 0 });
  });

  it('uses bo_overrides when the round name matches', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      bo_overrides: { 'Round 2': 5 },
    } as never);

    const request = {} as NextRequest;
    await POST(request, routeParams('ae13bc20-d43b-42b5-8de0-4944cb4025e3'));

    expect(createRound).toHaveBeenCalledWith(
      expect.objectContaining({ best_of: 5 })
    );
  });

  it('transitions upcoming tournament to active on first round', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      status: 'upcoming',
      current_round: 0,
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);

    const request = {} as NextRequest;
    await POST(request, routeParams('ae13bc20-d43b-42b5-8de0-4944cb4025e3'));

    expect(updateTournament).toHaveBeenCalledWith('ae13bc20-d43b-42b5-8de0-4944cb4025e3', {
      status: 'active',
      current_round: 1,
    });
  });

  it('bubbles up season status from upcoming to active', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      status: 'upcoming',
      current_round: 0,
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);
    vi.mocked(getSeasonById).mockResolvedValue({
      id: 's-1',
      status: 'upcoming',
    } as never);

    const request = {} as NextRequest;
    await POST(request, routeParams('ae13bc20-d43b-42b5-8de0-4944cb4025e3'));

    expect(updateSeason).toHaveBeenCalledWith('s-1', { status: 'active' });
  });

  it('does NOT update season when season is already active', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      status: 'upcoming',
      current_round: 0,
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);
    vi.mocked(getSeasonById).mockResolvedValue({
      id: 's-1',
      status: 'active',
    } as never);

    const request = {} as NextRequest;
    await POST(request, routeParams('ae13bc20-d43b-42b5-8de0-4944cb4025e3'));

    expect(updateSeason).not.toHaveBeenCalled();
  });

  it('handles group-scoped pairings', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([
      {
        id: 'g-1',
        name: 'Group A',
        members: [
          { player_id: 'p1', player_name: 'Alice' },
          { player_id: 'p2', player_name: 'Bob' },
        ],
      },
      {
        id: 'g-2',
        name: 'Group B',
        members: [
          { player_id: 'p3', player_name: 'Carol' },
          { player_id: 'p4', player_name: 'Dave' },
        ],
      },
    ] as never);

    vi.mocked(generateRound).mockReturnValue({
      pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }],
      round_name: 'Round 2',
      bye_player_ids: [],
    } as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('ae13bc20-d43b-42b5-8de0-4944cb4025e3'));

    expect(response.status).toBe(201);
    // generateRound should be called once per group
    expect(generateRound).toHaveBeenCalledTimes(2);
  });

  // ---- league groups (group-schedule.ts) ----

  describe('grouped round robin', () => {
    const A = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const B = ['b1', 'b2', 'b3', 'b4', 'b5'];
    const groupRow = (id: string, n: number, seasonGroupId: string | null, members: string[]) => ({
      id,
      tournament_id: baseTournament.id,
      name: `Group ${n}`,
      group_number: n,
      season_group_id: seasonGroupId,
      created_at: '',
      updated_at: '',
      members: members.map((player_id, i) => ({ player_id, player_name: player_id, seed: i + 1, gym_type: null })),
    });
    const mirrored = [groupRow('g-a', 1, 'sg-a', A), groupRow('g-b', 2, 'sg-b', B)];
    const plan = planGroupSchedule(
      [
        { id: 'g-a', memberIds: A },
        { id: 'g-b', memberIds: B },
      ],
      { crossGroup: true },
    );

    /** Weeks 1..n written, each with a (completed) match; `openFirst`: week 1's match still open. */
    function written(weeks: number, openFirst = false) {
      const rounds = Array.from({ length: weeks }, (_, i) => ({ id: `r-${i + 1}`, round_number: i + 1, status: 'completed', bye_player_ids: [] }));
      vi.mocked(getRoundsByTournament).mockResolvedValue(rounds as never);
      vi.mocked(getMatchesByTournament).mockResolvedValue(
        rounds.map((round, i) => ({
          id: `m-${i + 1}`,
          round_id: round.id,
          player_1_id: 'a1',
          player_2_id: 'a2',
          winner_id: openFirst && i === 0 ? null : 'a1',
          status: openFirst && i === 0 ? 'scheduled' : 'completed',
        })) as never,
      );
    }

    beforeEach(() => {
      vi.mocked(getParticipants).mockResolvedValue([...A, ...B].map((id) => ({ id, name: id })) as never);
      vi.mocked(getGroupsByTournament).mockResolvedValue(mirrored as never);
      // The phase already has rounds: its mirrored groups stay as they are.
      vi.mocked(getSeasonGroups).mockResolvedValue([
        { id: 'sg-a', season_id: 's-1', name: 'Group 1', sort_order: 1, player_ids: A },
        { id: 'sg-b', season_id: 's-1', name: 'Group 2', sort_order: 2, player_ids: B },
      ]);
    });

    it('writes the planned week: in-group pairings plus the cross-group bye pairing', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({
        ...baseTournament,
        bracket_type: 'round_robin',
        current_round: 1,
      } as never);
      written(1);
      const response = await POST({} as NextRequest, routeParams(baseTournament.id));
      expect(response.status).toBe(201);
      const week2 = plan.weeks[1];
      expect(vi.mocked(createRound)).toHaveBeenCalledWith(expect.objectContaining({ round_number: 2, name: 'Round 2' }));
      expect(vi.mocked(createMatchBatch).mock.calls[0][0].map((m) => [m.player_1_id, m.player_2_id])).toEqual(
        [...week2.groupPairings, ...week2.crossPairings].map((p) => [p.player_1_id, p.player_2_id]),
      );
      expect(week2.crossPairings).toHaveLength(1);
      expect(generateRound).not.toHaveBeenCalled();
    });

    it('fills the week round an interrupted call wrote without matches instead of writing a second one', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({
        ...baseTournament,
        bracket_type: 'round_robin',
        current_round: 1,
      } as never);
      const week1 = plan.weeks[0];
      vi.mocked(getRoundsByTournament).mockResolvedValue([
        { id: 'r-1', round_number: 1, status: 'completed', bye_player_ids: [] },
        { id: 'r-2', round_number: 2, status: 'active', bye_player_ids: [] },
      ] as never);
      vi.mocked(getMatchesByTournament).mockResolvedValue(
        [...week1.groupPairings, ...week1.crossPairings].map((p, i) => ({
          id: `m-${i}`,
          round_id: 'r-1',
          player_1_id: p.player_1_id,
          player_2_id: p.player_2_id,
          winner_id: p.player_1_id,
          status: 'completed',
        })) as never,
      );
      const response = await POST({} as NextRequest, routeParams(baseTournament.id));
      expect(response.status).toBe(201);
      expect(createRound).not.toHaveBeenCalled();
      const week2 = plan.weeks[1];
      const batch = vi.mocked(createMatchBatch).mock.calls[0][0];
      expect(batch.every((m) => m.round_id === 'r-2')).toBe(true);
      expect(batch).toHaveLength(week2.groupPairings.length + week2.crossPairings.length);
    });

    it('refuses the placement week while a match before it is open (409, nothing written)', async () => {
      const placement = plan.weeks.find((w) => w.kind === 'placement')!;
      vi.mocked(getTournamentById).mockResolvedValue({
        ...baseTournament,
        bracket_type: 'round_robin',
        current_round: placement.week - 1,
      } as never);
      written(placement.week - 1, true);
      const response = await POST({} as NextRequest, routeParams(baseTournament.id));
      const json = await response.json();
      expect(response.status).toBe(409);
      expect(json.code).toBe('rounds_group_placement_not_ready');
      expect(createRound).not.toHaveBeenCalled();
    });

    it('answers rounds_all_generated past the last planned week', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({
        ...baseTournament,
        bracket_type: 'round_robin',
        current_round: plan.totalWeeks,
      } as never);
      written(plan.totalWeeks);
      const response = await POST({} as NextRequest, routeParams(baseTournament.id));
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('rounds_all_generated');
      expect(createRound).not.toHaveBeenCalled();
    });

    it('phase-only groups of different sizes: the smaller group rests instead of failing', async () => {
      const small = [groupRow('g-a', 1, null, A), groupRow('g-b', 2, null, B.slice(0, 4))];
      vi.mocked(getGroupsByTournament).mockResolvedValue(small as never);
      vi.mocked(getSeasonGroups).mockResolvedValue([]);
      vi.mocked(getTournamentById).mockResolvedValue({
        ...baseTournament,
        bracket_type: 'round_robin',
        current_round: 4,
      } as never);
      written(4);
      const response = await POST({} as NextRequest, routeParams(baseTournament.id));
      expect(response.status).toBe(201);
      const batch = vi.mocked(createMatchBatch).mock.calls[0][0];
      // Round 5: the 5-group plays (2 matches, one bye); the 4-group (3 rounds) rests; no cross match.
      expect(batch).toHaveLength(2);
      expect(batch.every((m) => m.player_1_id.startsWith('a') && m.player_2_id.startsWith('a'))).toBe(true);
    });

    it('takes the week from the plan, not from a stale current_round (an interrupted generate-all-rounds)', async () => {
      // generate-all-rounds wrote weeks 1-3 but stopped before updating current_round (still 1).
      vi.mocked(getTournamentById).mockResolvedValue({
        ...baseTournament,
        bracket_type: 'round_robin',
        current_round: 1,
      } as never);
      written(3);
      const response = await POST({} as NextRequest, routeParams(baseTournament.id));
      expect(response.status).toBe(201);
      expect(vi.mocked(createRound)).toHaveBeenCalledWith(expect.objectContaining({ round_number: 4 }));
      expect(vi.mocked(createRound)).not.toHaveBeenCalledWith(expect.objectContaining({ round_number: 2 }));
      expect(vi.mocked(updateTournament)).toHaveBeenCalledWith(baseTournament.id, expect.objectContaining({ current_round: 4 }));
    });
  });

  describe('retry after an interrupted call (round written, current_round not moved)', () => {
    const tid = 'ae13bc20-d43b-42b5-8de0-4944cb4025e3';

    it('fills the round the interrupted call wrote without matches instead of writing a second round 2', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({ ...baseTournament, bracket_type: 'round_robin' } as never);
      vi.mocked(getRoundsByTournament).mockResolvedValue([
        { id: 'r-1', name: 'Round 1', round_number: 1, status: 'completed', bye_player_ids: [] },
        { id: 'r-2-empty', name: 'Round 2', round_number: 2, status: 'pending', bye_player_ids: [] },
      ] as never);
      vi.mocked(getMatchesByTournament).mockResolvedValue([{ id: 'm-1', round_id: 'r-1' }] as never);

      const response = await POST({} as NextRequest, routeParams(tid));
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.data.id).toBe('r-2-empty');
      expect(createRound).not.toHaveBeenCalled();
      expect(createMatchBatch).toHaveBeenCalledWith([
        expect.objectContaining({ round_id: 'r-2-empty', player_1_id: 'p1', player_2_id: 'p2' }),
        expect.objectContaining({ round_id: 'r-2-empty', player_1_id: 'p3', player_2_id: 'p4' }),
      ]);
      expect(updateTournament).toHaveBeenCalledWith(tid, { current_round: 2 });
    });

    it('refuses (409, nothing written) when the round at that number already has its matches', async () => {
      vi.mocked(getRoundsByTournament).mockResolvedValue([
        { id: 'r-1', name: 'Round 1', round_number: 1, status: 'completed', bye_player_ids: [] },
        { id: 'r-2', name: 'Round 2', round_number: 2, status: 'pending', bye_player_ids: [] },
      ] as never);
      vi.mocked(getMatchesByTournament).mockResolvedValue([
        { id: 'm-1', round_id: 'r-1' },
        { id: 'm-2', round_id: 'r-2' },
      ] as never);

      const response = await POST({} as NextRequest, routeParams(tid));
      const payload = await response.json();

      expect(response.status).toBe(409);
      expect(payload.code).toBe('rounds_round_already_written');
      expect(payload.params).toEqual({ round: 'Round 2' });
      expect(createRound).not.toHaveBeenCalled();
      expect(createMatchBatch).not.toHaveBeenCalled();
      expect(updateTournament).not.toHaveBeenCalled();
    });
  });

  it('returns 400 with BRACKET_V2_MANAGED for structure-generated elim brackets', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      bracket_type: 'single_elim',
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'completed', bracket_side: 'winners', bye_player_ids: [] },
    ] as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('ae13bc20-d43b-42b5-8de0-4944cb4025e3'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.code).toBe('BRACKET_V2_MANAGED');
    expect(generateRound).not.toHaveBeenCalled();
  });

  it('allows generate-round for legacy elim brackets without bracket_side', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      bracket_type: 'single_elim',
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'completed', bracket_side: null, bye_player_ids: [] },
    ] as never);
    vi.mocked(generateRound).mockReturnValue({
      pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }],
      round_name: 'Semifinals',
      bye_player_ids: [],
    } as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('ae13bc20-d43b-42b5-8de0-4944cb4025e3'));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(generateRound).toHaveBeenCalled();
  });

  // ---- byes ----

  describe('byes', () => {
    const fiveParticipants = [...participants, { id: 'p5', name: 'Erin' }];

    it('stores the bye of a Swiss round on the round', async () => {
      vi.mocked(getParticipants).mockResolvedValue(fiveParticipants as never);
      vi.mocked(generateRound).mockReturnValue({
        pairings: [
          { player_1_id: 'p1', player_2_id: 'p2' },
          { player_1_id: 'p3', player_2_id: 'p4' },
        ],
        round_name: 'Round 2',
        bye_player_ids: ['p5'],
      } as never);

      const response = await POST({} as NextRequest, routeParams(baseTournament.id));

      expect(response.status).toBe(201);
      expect(createRound).toHaveBeenCalledWith(
        expect.objectContaining({ round_number: 2, bye_player_ids: ['p5'] })
      );
      // The round (and its bye) shows on the next public view.
      expect(revalidateTag).toHaveBeenCalledWith(`tournament:${baseTournament.id}`, { expire: 0 });
    });

    it('hands the byes stored on earlier rounds to the pairing engine', async () => {
      vi.mocked(getParticipants).mockResolvedValue(fiveParticipants as never);
      vi.mocked(getRoundsByTournament).mockResolvedValue([
        { round_number: 1, status: 'completed', bye_player_ids: ['p5'] },
      ] as never);

      await POST({} as NextRequest, routeParams(baseTournament.id));

      expect(generateRound).toHaveBeenCalledWith(
        'swiss',
        expect.any(Array),
        expect.any(Object),
        expect.any(Array),
        2,
        expect.objectContaining({ byeHistory: [{ player_id: 'p5', round_number: 1 }] })
      );
    });

    it('stores a round robin bye too', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({
        ...baseTournament,
        bracket_type: 'round_robin',
      } as never);
      vi.mocked(generateRound).mockReturnValue({
        pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }],
        round_name: 'Round 2',
        bye_player_ids: ['p3'],
      } as never);

      await POST({} as NextRequest, routeParams(baseTournament.id));

      expect(createRound).toHaveBeenCalledWith(expect.objectContaining({ bye_player_ids: ['p3'] }));
    });

    it('does not store an elimination bye (it is structural)', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({
        ...baseTournament,
        bracket_type: 'single_elim',
      } as never);
      vi.mocked(getRoundsByTournament).mockResolvedValue([
        { round_number: 1, status: 'completed', bracket_side: null, bye_player_ids: [] },
      ] as never);
      vi.mocked(generateRound).mockReturnValue({
        pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }],
        round_name: 'Semifinals',
        bye_player_ids: ['p3'],
      } as never);

      await POST({} as NextRequest, routeParams(baseTournament.id));

      const input = vi.mocked(createRound).mock.calls[0][0];
      expect('bye_player_ids' in input).toBe(false);
    });

    it('writes the bye onto a round it reuses and keeps that round out of its own bye history', async () => {
      // Round 2 was written by an interrupted call (a stale bye for p4, no matches): the retry reuses it, stores
      // this call's bye, and does not count the stale bye as history of the round it is regenerating.
      vi.mocked(getParticipants).mockResolvedValue(fiveParticipants as never);
      vi.mocked(getRoundsByTournament).mockResolvedValue([
        { id: 'r-1', name: 'Round 1', round_number: 1, status: 'completed', bye_player_ids: ['p5'] },
        { id: 'r-2-empty', name: 'Round 2', round_number: 2, status: 'pending', bye_player_ids: ['p4'] },
      ] as never);
      vi.mocked(getMatchesByTournament).mockResolvedValue([{ id: 'm-1', round_id: 'r-1' }] as never);
      vi.mocked(generateRound).mockReturnValue({
        pairings: [
          { player_1_id: 'p1', player_2_id: 'p2' },
          { player_1_id: 'p3', player_2_id: 'p4' },
        ],
        round_name: 'Round 2',
        bye_player_ids: ['p1'],
      } as never);
      vi.mocked(updateRoundByePlayers).mockResolvedValue({
        id: 'r-2-empty',
        name: 'Round 2',
        round_number: 2,
        bye_player_ids: ['p1'],
      } as never);

      const response = await POST({} as NextRequest, routeParams(baseTournament.id));

      expect(response.status).toBe(201);
      expect(createRound).not.toHaveBeenCalled();
      expect(updateRoundByePlayers).toHaveBeenCalledWith('r-2-empty', ['p1']);
      expect(vi.mocked(generateRound).mock.calls[0][5]).toEqual(
        expect.objectContaining({ byeHistory: [{ player_id: 'p5', round_number: 1 }] })
      );
      expect(createMatchBatch).toHaveBeenCalledWith([
        expect.objectContaining({ round_id: 'r-2-empty', player_1_id: 'p1', player_2_id: 'p2' }),
        expect.objectContaining({ round_id: 'r-2-empty', player_1_id: 'p3', player_2_id: 'p4' }),
      ]);
    });

    it('does not rewrite a reused round whose stored byes already match', async () => {
      vi.mocked(getRoundsByTournament).mockResolvedValue([
        { id: 'r-1', name: 'Round 1', round_number: 1, status: 'completed', bye_player_ids: [] },
        { id: 'r-2-empty', name: 'Round 2', round_number: 2, status: 'pending', bye_player_ids: [] },
      ] as never);
      vi.mocked(getMatchesByTournament).mockResolvedValue([{ id: 'm-1', round_id: 'r-1' }] as never);

      const response = await POST({} as NextRequest, routeParams(baseTournament.id));

      expect(response.status).toBe(201);
      expect(updateRoundByePlayers).not.toHaveBeenCalled();
    });

    it('collects the byes of every group and scopes the bye history to each group', async () => {
      vi.mocked(getRoundsByTournament).mockResolvedValue([
        { round_number: 1, status: 'completed', bye_player_ids: ['p1', 'p3'] },
      ] as never);
      vi.mocked(getGroupsByTournament).mockResolvedValue([
        {
          id: 'g-1',
          name: 'Group A',
          members: [
            { player_id: 'p1', player_name: 'Alice' },
            { player_id: 'p2', player_name: 'Bob' },
          ],
        },
        {
          id: 'g-2',
          name: 'Group B',
          members: [
            { player_id: 'p3', player_name: 'Carol' },
            { player_id: 'p4', player_name: 'Dave' },
          ],
        },
      ] as never);
      vi.mocked(generateRound)
        .mockReturnValueOnce({
          pairings: [],
          round_name: 'Round 2',
          bye_player_ids: ['p2'],
        } as never)
        .mockReturnValueOnce({
          pairings: [],
          round_name: 'Round 2',
          bye_player_ids: ['p4'],
        } as never);

      await POST({} as NextRequest, routeParams(baseTournament.id));

      const optionsOf = (call: number) => vi.mocked(generateRound).mock.calls[call][5];
      expect(optionsOf(0)?.byeHistory).toEqual([{ player_id: 'p1', round_number: 1 }]);
      expect(optionsOf(1)?.byeHistory).toEqual([{ player_id: 'p3', round_number: 1 }]);
      expect(createRound).toHaveBeenCalledWith(
        expect.objectContaining({ bye_player_ids: ['p2', 'p4'] })
      );
    });
  });

  // ---- round robin past its last round ----

  describe('round robin past the last round', () => {
    const rr = (currentRound: number) => ({
      ...baseTournament,
      bracket_type: 'round_robin' as const,
      current_round: currentRound,
    });
    const completedRounds = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `r-${i + 1}`,
        name: `Round ${i + 1}`,
        round_number: i + 1,
        status: 'completed',
        bye_player_ids: [],
      }));

    it('answers rounds_all_generated (400) and writes nothing once every circle-method round exists', async () => {
      // 4 participants play 3 rounds.
      vi.mocked(getTournamentById).mockResolvedValue(rr(3) as never);
      vi.mocked(getRoundsByTournament).mockResolvedValue(completedRounds(3) as never);

      const response = await POST({} as NextRequest, routeParams(baseTournament.id));
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error).toBe('All rounds have already been generated');
      expect(payload.code).toBe('rounds_all_generated');
      expect(generateRound).not.toHaveBeenCalled();
      expect(createRound).not.toHaveBeenCalled();
      expect(createMatchBatch).not.toHaveBeenCalled();
      expect(updateTournament).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('counts an odd field correctly (5 participants play 5 rounds)', async () => {
      vi.mocked(getParticipants).mockResolvedValue([...participants, { id: 'p5', name: 'Erin' }] as never);
      vi.mocked(getTournamentById).mockResolvedValue(rr(4) as never);
      vi.mocked(getRoundsByTournament).mockResolvedValue(completedRounds(4) as never);

      const response = await POST({} as NextRequest, routeParams(baseTournament.id));

      expect(response.status).toBe(201);
      expect(createRound).toHaveBeenCalledWith(expect.objectContaining({ round_number: 5 }));
    });

    it('still generates below the last round', async () => {
      vi.mocked(getTournamentById).mockResolvedValue(rr(2) as never);
      vi.mocked(getRoundsByTournament).mockResolvedValue(completedRounds(2) as never);

      const response = await POST({} as NextRequest, routeParams(baseTournament.id));

      expect(response.status).toBe(201);
      expect(createRound).toHaveBeenCalledWith(expect.objectContaining({ round_number: 3 }));
    });
  });

  // ---- optional start_round body ----

  describe('start_round', () => {
    const bodyRequest = (body: unknown) => ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;
    const startedRound = {
      id: 'r-2',
      tournament_id: baseTournament.id,
      name: 'Round 2',
      round_number: 2,
      best_of: 3,
      status: 'active',
    };

    it('starts the new round after its matches are written and returns it active', async () => {
      vi.mocked(updateRoundStatus).mockResolvedValue(startedRound as never);

      const response = await POST(bodyRequest({ start_round: true }), routeParams(baseTournament.id));
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(updateRoundStatus).toHaveBeenCalledTimes(1);
      expect(updateRoundStatus).toHaveBeenCalledWith('r-2', 'active');
      expect(payload.data.status).toBe('active');
      expect(vi.mocked(createMatchBatch).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(updateRoundStatus).mock.invocationCallOrder[0]
      );
    });

    it('starts a reused round (an interrupted call wrote it without matches) too', async () => {
      vi.mocked(getRoundsByTournament).mockResolvedValue([
        { id: 'r-1', name: 'Round 1', round_number: 1, status: 'completed', bye_player_ids: [] },
        { id: 'r-2-empty', name: 'Round 2', round_number: 2, status: 'pending', bye_player_ids: [] },
      ] as never);
      vi.mocked(getMatchesByTournament).mockResolvedValue([{ id: 'm-1', round_id: 'r-1' }] as never);
      vi.mocked(updateRoundStatus).mockResolvedValue({ ...startedRound, id: 'r-2-empty' } as never);

      const response = await POST(bodyRequest({ start_round: true }), routeParams(baseTournament.id));

      expect(response.status).toBe(201);
      expect(updateRoundStatus).toHaveBeenCalledWith('r-2-empty', 'active');
    });

    it.each([
      ['no body', {} as NextRequest],
      ['an empty body', bodyRequest({})],
      ['start_round false', bodyRequest({ start_round: false })],
      [
        'an unparsable body',
        { json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')) } as unknown as NextRequest,
      ],
    ])('leaves the round pending with %s', async (_label, request) => {
      const response = await POST(request, routeParams(baseTournament.id));
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(updateRoundStatus).not.toHaveBeenCalled();
      expect(payload.data.status).toBe('pending');
    });

    it('returns the created round still pending (201) when the start fails', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(updateRoundStatus).mockRejectedValue(new Error('db down'));

      const response = await POST(bodyRequest({ start_round: true }), routeParams(baseTournament.id));
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.data.id).toBe('r-2');
      expect(payload.data.status).toBe('pending');
      expect(logged).toHaveBeenCalled();
      expect(updateTournament).toHaveBeenCalled();
      expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({ started: false });
      logged.mockRestore();
    });

    it.each([
      ['a non-boolean start_round', { start_round: 'yes' }],
      ['an unknown key', { foo: 1 }],
    ])('rejects %s with 400 validation_failed and writes nothing', async (_label, body) => {
      const response = await POST(bodyRequest(body), routeParams(baseTournament.id));
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.code).toBe('validation_failed');
      expect(getTournamentById).not.toHaveBeenCalled();
      expect(createRound).not.toHaveBeenCalled();
      expect(createMatchBatch).not.toHaveBeenCalled();
      expect(updateTournament).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('checks the resource admin before it reads the body', async () => {
      vi.mocked(requireResourceAdmin).mockRejectedValue(new AuthError('Forbidden', 403));
      const json = vi.fn(async () => ({ start_round: true }));

      const response = await POST({ json } as unknown as NextRequest, routeParams(baseTournament.id));

      expect(response.status).toBe(403);
      expect(json).not.toHaveBeenCalled();
    });
  });

  // ---- audit ----

  describe('audit', () => {
    it('records one round.generate event after the write, with who, what and whether it started', async () => {
      vi.mocked(getParticipants).mockResolvedValue([...participants, { id: 'p5', name: 'Erin' }] as never);
      vi.mocked(generateRound).mockReturnValue({
        pairings: [
          { player_1_id: 'p1', player_2_id: 'p2' },
          { player_1_id: 'p3', player_2_id: 'p4' },
        ],
        round_name: 'Round 2',
        bye_player_ids: ['p5'],
      } as never);

      const response = await POST({} as NextRequest, routeParams(baseTournament.id));

      expect(response.status).toBe(201);
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
      expect(logAuditEvent).toHaveBeenCalledWith({
        actor_id: 'admin-1',
        actor_name: 'Admin',
        action: 'round.generate',
        resource_type: 'round',
        resource_id: 'r-2',
        resource_name: 'Round 2',
        metadata: { tournament_id: baseTournament.id, round_number: 2, matches: 2, byes: 1, started: false },
      });
    });

    it('marks the event as started when start_round succeeded', async () => {
      vi.mocked(updateRoundStatus).mockResolvedValue({ id: 'r-2', name: 'Round 2', round_number: 2, status: 'active' } as never);

      await POST(
        { json: () => Promise.resolve({ start_round: true }) } as unknown as NextRequest,
        routeParams(baseTournament.id)
      );

      expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({ started: true });
    });

    it('records nothing when the call is refused', async () => {
      vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1', name: 'Solo' }] as never);

      const response = await POST({} as NextRequest, routeParams(baseTournament.id));

      expect(response.status).toBe(400);
      expect(logAuditEvent).not.toHaveBeenCalled();
    });
  });

  // ---- error handling ----

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getParticipants).mockRejectedValue(new Error('db'));

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('ae13bc20-d43b-42b5-8de0-4944cb4025e3'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBe(false);
  });
});
