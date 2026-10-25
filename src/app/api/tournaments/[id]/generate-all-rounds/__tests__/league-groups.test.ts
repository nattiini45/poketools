import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * League groups in generate-all-rounds: the phase mirrors the league groups, the week plan (group-schedule.ts)
 * is written up to the next placement week, the placement week waits for the tables, and every week is
 * planned before the first write. The planner and the circle method run for real.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
  updateTournament: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
  createRound: vi.fn(),
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
vi.mock('@/lib/tournament/season-standings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tournament/season-standings')>();
  return { ...actual, loadSeasonStandingsContext: vi.fn(async () => ({ formatType: 'singles' })) };
});

import { requireResourceAdmin } from '@/lib/auth/helpers';
import { logAuditEvent } from '@/lib/audit/log';
import { POST } from '@/app/api/tournaments/[id]/generate-all-rounds/route';
import { getParticipants, getTournamentById, updateTournament } from '@/lib/supabase/queries/tournaments';
import { createRound, getRoundsByTournament, updateRoundStatus } from '@/lib/supabase/queries/rounds';
import { createMatchBatch, getMatchesByTournament } from '@/lib/supabase/queries/matches';
import {
  addGroupMembersBatch,
  createGroupBatch,
  deleteGroupsByTournament,
  getGroupsByTournament,
} from '@/lib/supabase/queries/tournament-groups';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { planGroupSchedule } from '@/lib/tournament/group-schedule';
import type { TournamentGroupWithMembers } from '@/types/season';

const PHASE_ID = '0b9f1a43-6c55-4d2e-9a0e-0d9b7c3c9f11';
const params = { params: Promise.resolve({ id: PHASE_ID }) };
const A = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];
const B = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'];

function phaseGroup(id: string, n: number, seasonGroupId: string, members: string[]): TournamentGroupWithMembers {
  return {
    id,
    tournament_id: PHASE_ID,
    name: n === 1 ? 'Gold' : 'Silver',
    group_number: n,
    season_group_id: seasonGroupId,
    created_at: '',
    updated_at: '',
    members: members.map((player_id, i) => ({ player_id, player_name: player_id, seed: i + 1, gym_type: null })),
  };
}

const mirrored = [phaseGroup('pg-a', 1, 'sg-a', A), phaseGroup('pg-b', 2, 'sg-b', B)];
const plan = planGroupSchedule(
  [
    { id: 'pg-a', memberIds: A },
    { id: 'pg-b', memberIds: B },
  ],
  { crossGroup: true },
);
const firstPlacement = plan.weeks.find((w) => w.kind === 'placement')!.week;

let roundSeq = 0;

beforeEach(() => {
  vi.clearAllMocks();
  roundSeq = 0;
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
  vi.mocked(getTournamentById).mockResolvedValue({
    id: PHASE_ID,
    name: 'Season stage',
    season_id: 'season-1',
    bracket_type: 'round_robin',
    status: 'upcoming',
    current_round: 0,
    best_of_default: 3,
    bo_overrides: {},
  } as never);
  vi.mocked(getParticipants).mockResolvedValue([...A, ...B].map((id, i) => ({ id, name: id, seed: i + 1 })) as never);
  vi.mocked(getSeasonGroups).mockResolvedValue([
    { id: 'sg-a', season_id: 'season-1', name: 'Gold', sort_order: 1, player_ids: A },
    { id: 'sg-b', season_id: 'season-1', name: 'Silver', sort_order: 2, player_ids: B },
  ]);
  vi.mocked(getMatchesByTournament).mockResolvedValue([]);
  vi.mocked(createRound).mockImplementation(async (input) => {
    roundSeq += 1;
    return { id: `new-${roundSeq}`, round_number: input.round_number } as never;
  });
});

/** Rows of weeks 1..last as stored, every match completed (the first trainer wins). */
function storedWeeks(last: number) {
  const rounds = plan.weeks
    .filter((w) => w.week <= last)
    .map((w) => ({ id: `r${w.week}`, round_number: w.week, status: 'completed' }));
  const matches = plan.weeks
    .filter((w) => w.week <= last && !w.awaitingTables)
    .flatMap((w) =>
      [...w.groupPairings, ...w.crossPairings].map((p, i) => ({
        id: `m${w.week}-${i}`,
        round_id: `r${w.week}`,
        player_1_id: p.player_1_id,
        player_2_id: p.player_2_id,
        winner_id: p.player_1_id as string | null,
        status: 'completed',
      })),
    );
  return { rounds, matches };
}

describe('generate-all-rounds — league groups', () => {
  it('first call: mirrors the league groups, then writes every week up to the first placement week', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValueOnce([]).mockResolvedValue(mirrored);
    vi.mocked(createGroupBatch).mockResolvedValue([
      { ...mirrored[0], members: undefined } as never,
      { ...mirrored[1], members: undefined } as never,
    ]);

    const res = await POST({} as NextRequest, params);
    expect(res.status).toBe(201);

    expect(deleteGroupsByTournament).toHaveBeenCalledWith(PHASE_ID);
    expect(createGroupBatch).toHaveBeenCalledWith([
      { tournament_id: PHASE_ID, name: 'Gold', group_number: 1, season_group_id: 'sg-a' },
      { tournament_id: PHASE_ID, name: 'Silver', group_number: 2, season_group_id: 'sg-b' },
    ]);
    expect(vi.mocked(addGroupMembersBatch).mock.calls[0][0]).toHaveLength(14);

    const written = vi.mocked(createRound).mock.calls.map(([input]) => input.round_number);
    expect(written).toEqual(Array.from({ length: firstPlacement - 1 }, (_, i) => i + 1));
    // Week 1: 3 + 3 in-group matches and the two byes meet across groups.
    expect(vi.mocked(createMatchBatch).mock.calls[0][0]).toHaveLength(7);
    expect(updateTournament).toHaveBeenCalledWith(PHASE_ID, { current_round: firstPlacement - 1, status: 'active' });
  });

  it('refuses the placement week while a match before it is open: 409, nothing written', async () => {
    const { rounds, matches } = storedWeeks(firstPlacement - 1);
    matches[0] = { ...matches[0], winner_id: null, status: 'scheduled' };
    vi.mocked(getRoundsByTournament).mockResolvedValue(rounds as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue(matches as never);
    vi.mocked(getGroupsByTournament).mockResolvedValue(mirrored);

    const res = await POST({} as NextRequest, params);
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.code).toBe('rounds_group_placement_not_ready');
    expect(json.params).toEqual({ week: firstPlacement });
    expect(createRound).not.toHaveBeenCalled();
    expect(createMatchBatch).not.toHaveBeenCalled();
  });

  it('once the weeks before it are played: the placement week from the tables, then on to the next one', async () => {
    const { rounds, matches } = storedWeeks(firstPlacement - 1);
    vi.mocked(getRoundsByTournament).mockResolvedValue(rounds as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue(matches as never);
    vi.mocked(getGroupsByTournament).mockResolvedValue(mirrored);

    const res = await POST({} as NextRequest, params);
    expect(res.status).toBe(201);
    const written = vi.mocked(createRound).mock.calls.map(([input]) => input.round_number);
    // The placement week and every week after it up to (not including) the second placement week.
    expect(written).toEqual(
      Array.from({ length: plan.totalWeeks - firstPlacement }, (_, i) => firstPlacement + i),
    );
    // The placement week pairs all 14 trainers across groups.
    const placementMatches = vi.mocked(createMatchBatch).mock.calls[0][0];
    expect(placementMatches).toHaveLength(7);
    for (const m of placementMatches) expect(m.player_1_id[0]).not.toBe(m.player_2_id[0]);
    // The group tables are untouched once the phase has rounds.
    expect(deleteGroupsByTournament).not.toHaveBeenCalled();
  });

  it('a written week an interrupted call left without matches is filled into its round, not skipped', async () => {
    // Week 2 was written, but its matches never were (round and matches are two writes).
    const { rounds, matches } = storedWeeks(2);
    vi.mocked(getRoundsByTournament).mockResolvedValue(rounds as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue(matches.filter((m) => m.round_id !== 'r2') as never);
    vi.mocked(getGroupsByTournament).mockResolvedValue(mirrored);

    const res = await POST({} as NextRequest, params);
    expect(res.status).toBe(201);
    // Week 2 reuses its round (no second round 2); weeks 3.. up to the placement week get new rounds.
    expect(vi.mocked(createRound).mock.calls.map(([input]) => input.round_number)).toEqual(
      Array.from({ length: firstPlacement - 3 }, (_, i) => i + 3),
    );
    const week2 = plan.weeks.find((w) => w.week === 2)!;
    const firstBatch = vi.mocked(createMatchBatch).mock.calls[0][0];
    expect(firstBatch.every((m) => m.round_id === 'r2')).toBe(true);
    expect(firstBatch).toHaveLength(week2.groupPairings.length + week2.crossPairings.length);
  });

  it('a trainer of the phase in no league group is refused before anything is written', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(getParticipants).mockResolvedValue(
      [...A, ...B, 'late-joiner'].map((id, i) => ({ id, name: id, seed: i + 1 })) as never,
    );
    const res = await POST({} as NextRequest, params);
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.code).toBe('PHASE_PLAYER_WITHOUT_LEAGUE_GROUP');
    expect(deleteGroupsByTournament).not.toHaveBeenCalled();
    expect(createRound).not.toHaveBeenCalled();
  });

  it('7+6 never throws half-way: every group its own round count, rest weeks for the smaller one', async () => {
    const small = [phaseGroup('pg-a', 1, 'sg-a', A), phaseGroup('pg-b', 2, 'sg-b', B.slice(0, 6))];
    vi.mocked(getParticipants).mockResolvedValue(
      [...A, ...B.slice(0, 6)].map((id, i) => ({ id, name: id, seed: i + 1 })) as never,
    );
    vi.mocked(getSeasonGroups).mockResolvedValue([
      { id: 'sg-a', season_id: 'season-1', name: 'Gold', sort_order: 1, player_ids: A },
      { id: 'sg-b', season_id: 'season-1', name: 'Silver', sort_order: 2, player_ids: B.slice(0, 6) },
    ]);
    vi.mocked(getGroupsByTournament).mockResolvedValue(small);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);

    const res = await POST({} as NextRequest, params);
    expect(res.status).toBe(201);
    const smallPlan = planGroupSchedule(
      [
        { id: 'pg-a', memberIds: A },
        { id: 'pg-b', memberIds: B.slice(0, 6) },
      ],
      { crossGroup: true },
    );
    const placement = smallPlan.weeks.find((w) => w.kind === 'placement')!.week;
    expect(vi.mocked(createRound).mock.calls.map(([input]) => input.round_number)).toEqual(
      Array.from({ length: placement - 1 }, (_, i) => i + 1),
    );
  });

  it('start_round starts only week 1 of the grouped phase; the other weeks stay pending', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValue(mirrored);
    vi.mocked(updateRoundStatus).mockImplementation(async (id, status) => ({ id, status, round_number: 1 }) as never);

    const res = await POST(
      { json: () => Promise.resolve({ start_round: true }) } as unknown as NextRequest,
      params,
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(vi.mocked(createRound).mock.calls.length).toBeGreaterThan(1);
    expect(updateRoundStatus).toHaveBeenCalledTimes(1);
    expect(updateRoundStatus).toHaveBeenCalledWith('new-1', 'active');
    expect(json.data[0].status).toBe('active');
    expect(json.data.slice(1).every((round: { status?: string }) => round.status === undefined)).toBe(true);
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({ started_round_number: 1 });
  });

  it('without a body no round is started', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValue(mirrored);

    const res = await POST({} as NextRequest, params);

    expect(res.status).toBe(201);
    expect(updateRoundStatus).not.toHaveBeenCalled();
  });
});
