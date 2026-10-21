import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock('@/lib/supabase/queries/season-groups', () => ({
  getSeasonGroups: vi.fn(),
  seasonHasGroups: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getParticipants: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByTournament: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: vi.fn(),
  createGroupBatch: vi.fn(),
  deleteGroupsByTournament: vi.fn(),
  addGroupMembersBatch: vi.fn(),
}));
vi.mock('@/lib/tournament/season-standings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tournament/season-standings')>();
  return { ...actual, loadSeasonStandingsContext: vi.fn() };
});

import {
  assertPhaseGroupsEditable,
  ensurePhaseGroupsFromLeague,
  mirrorsLeagueGroups,
  pendingWeeks,
  planPhaseWeeks,
  resolveWeekPairings,
  type PhaseWeekContext,
} from '@/lib/tournament/group-rounds';
import { getSeasonGroups, seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import { getParticipants } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import {
  addGroupMembersBatch,
  createGroupBatch,
  deleteGroupsByTournament,
  getGroupsByTournament,
} from '@/lib/supabase/queries/tournament-groups';
import { loadSeasonStandingsContext } from '@/lib/tournament/season-standings';
import { computeStandings } from '@/lib/tournament/standings';
import { pairPlacementWeek } from '@/lib/tournament/group-schedule';
import type { TournamentGroupWithMembers } from '@/types/season';
import type { MatchWithPlayers } from '@/types/match';
import type { Round } from '@/types/round';

const PHASE = { id: 'phase-1', bracket_type: 'round_robin' as const };

function phaseGroup(
  id: string,
  number: number,
  seasonGroupId: string | null,
  members: string[],
): TournamentGroupWithMembers {
  return {
    id,
    tournament_id: PHASE.id,
    name: `Group ${number}`,
    group_number: number,
    season_group_id: seasonGroupId,
    created_at: '',
    updated_at: '',
    members: members.map((player_id, i) => ({ player_id, player_name: player_id, seed: i + 1, gym_type: null })),
  };
}

describe('ensurePhaseGroupsFromLeague', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  });

  it('a league without groups writes nothing and returns the phase groups as they are', async () => {
    const own = [phaseGroup('pg', 1, null, ['p1', 'p2'])];
    vi.mocked(getSeasonGroups).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValue(own);
    await expect(ensurePhaseGroupsFromLeague('s1', PHASE)).resolves.toBe(own);
    expect(deleteGroupsByTournament).not.toHaveBeenCalled();
    expect(createGroupBatch).not.toHaveBeenCalled();
    expect(getRoundsByTournament).not.toHaveBeenCalled();
  });

  it('builds the phase groups from the league groups (enrollment order, season_group_id set)', async () => {
    vi.mocked(getSeasonGroups).mockResolvedValue([
      { id: 'sg-gold', season_id: 's1', name: 'Gold', sort_order: 1, player_ids: ['p3', 'p1'] },
      { id: 'sg-silver', season_id: 's1', name: 'Silver', sort_order: 2, player_ids: ['p2', 'p4'] },
    ]);
    vi.mocked(getGroupsByTournament).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    vi.mocked(getParticipants).mockResolvedValue(
      ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({ id, seed: i + 1 })) as never,
    );
    vi.mocked(createGroupBatch).mockResolvedValue([
      { id: 'pg-1', tournament_id: PHASE.id, name: 'Gold', group_number: 1, season_group_id: 'sg-gold', created_at: '', updated_at: '' },
      { id: 'pg-2', tournament_id: PHASE.id, name: 'Silver', group_number: 2, season_group_id: 'sg-silver', created_at: '', updated_at: '' },
    ]);

    await ensurePhaseGroupsFromLeague('s1', PHASE);

    expect(deleteGroupsByTournament).toHaveBeenCalledWith(PHASE.id);
    expect(createGroupBatch).toHaveBeenCalledWith([
      { tournament_id: PHASE.id, name: 'Gold', group_number: 1, season_group_id: 'sg-gold' },
      { tournament_id: PHASE.id, name: 'Silver', group_number: 2, season_group_id: 'sg-silver' },
    ]);
    // Members in phase enrollment (seed) order, not league-group order.
    expect(addGroupMembersBatch).toHaveBeenCalledWith([
      { group_id: 'pg-1', player_id: 'p1', seed: 1 },
      { group_id: 'pg-1', player_id: 'p3', seed: 2 },
      { group_id: 'pg-2', player_id: 'p2', seed: 1 },
      { group_id: 'pg-2', player_id: 'p4', seed: 2 },
    ]);
  });

  it('is idempotent: phase groups that already mirror the league are not rewritten', async () => {
    vi.mocked(getSeasonGroups).mockResolvedValue([
      { id: 'sg-gold', season_id: 's1', name: 'Gold', sort_order: 1, player_ids: ['p1', 'p2'] },
    ]);
    const mirrored = [{ ...phaseGroup('pg-1', 1, 'sg-gold', ['p1', 'p2']), name: 'Gold' }];
    vi.mocked(getGroupsByTournament).mockResolvedValue(mirrored);
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1', seed: 1 }, { id: 'p2', seed: 2 }] as never);
    await expect(ensurePhaseGroupsFromLeague('s1', PHASE)).resolves.toBe(mirrored);
    expect(deleteGroupsByTournament).not.toHaveBeenCalled();
  });

  it('never rewrites the groups of a phase that already has rounds', async () => {
    vi.mocked(getSeasonGroups).mockResolvedValue([
      { id: 'sg-gold', season_id: 's1', name: 'Gold', sort_order: 1, player_ids: ['p1', 'p2'] },
    ]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r1' }] as never);
    await ensurePhaseGroupsFromLeague('s1', PHASE);
    expect(deleteGroupsByTournament).not.toHaveBeenCalled();
    expect(getParticipants).not.toHaveBeenCalled();
  });

  it('refuses an enrolled trainer in no league group (409, nothing written)', async () => {
    vi.mocked(getSeasonGroups).mockResolvedValue([
      { id: 'sg-gold', season_id: 's1', name: 'Gold', sort_order: 1, player_ids: ['p1'] },
    ]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1', seed: 1 }, { id: 'p2', seed: 2 }] as never);
    await expect(ensurePhaseGroupsFromLeague('s1', PHASE)).rejects.toMatchObject({
      code: 'PHASE_PLAYER_WITHOUT_LEAGUE_GROUP',
      statusCode: 409,
      params: { count: 1 },
    });
    expect(deleteGroupsByTournament).not.toHaveBeenCalled();
  });

  it('validates the layout before rewriting: a refused layout leaves the old phase groups (nothing deleted)', async () => {
    vi.mocked(getSeasonGroups).mockResolvedValue([
      { id: 'sg-gold', season_id: 's1', name: 'Gold', sort_order: 1, player_ids: ['p1'] },
    ]);
    // Stale mirror rows from an earlier layout; nobody is enrolled now, so the new layout has no group.
    vi.mocked(getGroupsByTournament).mockResolvedValue([
      {
        id: 'old',
        tournament_id: PHASE.id,
        name: 'Gold',
        group_number: 1,
        season_group_id: 'sg-gold',
        created_at: '',
        updated_at: '',
        members: [{ player_id: 'p1', player_name: 'p1', seed: 1, gym_type: null }],
      },
    ] as never);
    vi.mocked(getParticipants).mockResolvedValue([]);
    await expect(ensurePhaseGroupsFromLeague('s1', PHASE)).rejects.toMatchObject({
      code: 'rounds_group_layout_invalid',
      statusCode: 400,
    });
    expect(deleteGroupsByTournament).not.toHaveBeenCalled();
    expect(createGroupBatch).not.toHaveBeenCalled();
  });

  it('leaves an elimination phase alone', async () => {
    vi.mocked(getSeasonGroups).mockResolvedValue([
      { id: 'sg-gold', season_id: 's1', name: 'Gold', sort_order: 1, player_ids: ['p1'] },
    ]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    await ensurePhaseGroupsFromLeague('s1', { id: PHASE.id, bracket_type: 'single_elim' });
    expect(getRoundsByTournament).not.toHaveBeenCalled();
    expect(createGroupBatch).not.toHaveBeenCalled();
  });
});

describe('assertPhaseGroupsEditable', () => {
  it('refuses the phase group editor in a league with groups', async () => {
    vi.mocked(seasonHasGroups).mockResolvedValue(true);
    await expect(assertPhaseGroupsEditable('s1')).rejects.toMatchObject({
      code: 'PHASE_GROUPS_LEAGUE_MANAGED',
      statusCode: 409,
    });
    vi.mocked(seasonHasGroups).mockResolvedValue(false);
    await expect(assertPhaseGroupsEditable('s1')).resolves.toBeUndefined();
  });
});

describe('planned weeks of a phase', () => {
  const A = ['a1', 'a2', 'a3', 'a4'];
  const B = ['b1', 'b2', 'b3', 'b4'];
  const mirrored = [phaseGroup('ga', 1, 'sg-a', A), phaseGroup('gb', 2, 'sg-b', B)];

  function round(week: number): Round {
    return { id: `r${week}`, round_number: week } as Round;
  }
  function match(week: number, p1: string, p2: string, winner: string | null, status = 'completed'): MatchWithPlayers {
    return {
      id: `m-${week}-${p1}-${p2}`,
      round_id: `r${week}`,
      player_1_id: p1,
      player_2_id: p2,
      winner_id: winner,
      status,
    } as MatchWithPlayers;
  }

  beforeEach(() => {
    vi.mocked(loadSeasonStandingsContext).mockResolvedValue({ formatType: 'singles' });
  });

  it('mirrors league groups only when every phase group carries a league group', () => {
    expect(mirrorsLeagueGroups(mirrored)).toBe(true);
    expect(mirrorsLeagueGroups([phaseGroup('ga', 1, null, A)])).toBe(false);
    expect(mirrorsLeagueGroups([])).toBe(false);
  });

  it('refuses the placement week while a match before it is open (409)', async () => {
    const context: PhaseWeekContext = {
      groups: mirrored,
      rounds: [round(1), round(2)],
      matches: [match(1, 'a1', 'a4', 'a1'), match(2, 'a1', 'b4', null, 'scheduled')],
    };
    const plan = planPhaseWeeks(context);
    const placement = plan.weeks.find((w) => w.kind === 'placement')!;
    await expect(resolveWeekPairings('s1', context, [placement.week])).rejects.toMatchObject({
      code: 'rounds_group_placement_not_ready',
      statusCode: 409,
      params: { week: placement.week },
    });
  });

  it('pairs the placement week by the group tables after the week before (cross matches count)', async () => {
    const plan = planPhaseWeeks({ groups: mirrored, rounds: [], matches: [] });
    const placement = plan.weeks.find((w) => w.kind === 'placement')!;
    // Every week before the placement week, played: in group A the last seed wins everything it plays,
    // in group B the first seed does.
    const rounds: Round[] = [];
    const matches: MatchWithPlayers[] = [];
    for (const week of plan.weeks.filter((w) => w.week < placement.week)) {
      rounds.push(round(week.week));
      for (const p of [...week.groupPairings, ...week.crossPairings]) {
        const rank = (id: string) => (id.startsWith('a') ? -Number(id.slice(1)) : Number(id.slice(1)) + 10);
        const winner = rank(p.player_1_id) < rank(p.player_2_id) ? p.player_1_id : p.player_2_id;
        matches.push(match(week.week, p.player_1_id, p.player_2_id, winner));
      }
    }
    const { resolved } = await resolveWeekPairings('s1', { groups: mirrored, rounds, matches }, [placement.week]);
    // The expected tables: one generic table over all eight trainers (cross matches count), split per group.
    const table = computeStandings(
      [...A, ...B],
      {},
      matches.map((m) => ({ player_1_id: m.player_1_id, player_2_id: m.player_2_id, winner_id: m.winner_id, round_number: 0 })),
    ).map((row) => row.player_id);
    const expected = pairPlacementWeek([table.filter((id) => A.includes(id)), table.filter((id) => B.includes(id))]);
    expect(resolved[0].week.kind).toBe('placement');
    expect(resolved[0].pairings).toEqual(expected);
    expect(resolved[0].pairings).toHaveLength(4);
    // B's leader beat every B trainer and lost only cross matches: it still tops B's table.
    expect(table.filter((id) => B.includes(id))[0]).toBe('b1');
  });

  it('later weeks use the stored placement pairings (deterministic re-plan)', () => {
    const skeleton = planPhaseWeeks({ groups: mirrored, rounds: [], matches: [] });
    const placement = skeleton.weeks.find((w) => w.kind === 'placement')!;
    const stored = [
      match(placement.week, 'a1', 'b2', null, 'scheduled'),
      match(placement.week, 'a2', 'b1', null, 'scheduled'),
      match(placement.week, 'a3', 'b4', null, 'scheduled'),
      match(placement.week, 'a4', 'b3', null, 'scheduled'),
    ];
    const plan = planPhaseWeeks({ groups: mirrored, rounds: [round(placement.week)], matches: stored });
    const week = plan.weeks.find((w) => w.week === placement.week)!;
    expect(week.awaitingTables).toBe(false);
    expect(week.crossPairings).toHaveLength(4);
  });

  it('pendingWeeks: unwritten weeks and written weeks without matches, in week order', () => {
    const skeleton = planPhaseWeeks({ groups: mirrored, rounds: [], matches: [] });
    expect(pendingWeeks({ groups: mirrored, rounds: [], matches: [] }, skeleton).map((w) => w.week)).toEqual(
      skeleton.weeks.map((w) => w.week),
    );
    // Weeks 1 and 3 written with matches, week 2 written without (an interrupted write): 2 comes first.
    const context: PhaseWeekContext = {
      groups: mirrored,
      rounds: [round(1), round(2), round(3)],
      matches: [match(1, 'a1', 'a4', 'a1'), match(3, 'a1', 'a2', 'a1')],
    };
    const pending = pendingWeeks(context, planPhaseWeeks(context)).map((w) => w.week);
    expect(pending[0]).toBe(2);
    expect(pending).not.toContain(1);
    expect(pending).not.toContain(3);
  });

  it('a planner balance failure keeps its own code (rounds_group_schedule_unbalanced), never a generic 500', async () => {
    vi.resetModules();
    vi.doMock('@/lib/tournament/group-schedule', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/tournament/group-schedule')>();
      return {
        ...actual,
        planGroupSchedule: () => {
          throw new actual.GroupScheduleError('no_balance', 'no split balances the halves');
        },
      };
    });
    const fresh = await import('@/lib/tournament/group-rounds');
    expect(() => fresh.planPhaseWeeks({ groups: mirrored, rounds: [], matches: [] })).toThrow(
      expect.objectContaining({ code: 'rounds_group_schedule_unbalanced', statusCode: 400 }),
    );
    vi.doUnmock('@/lib/tournament/group-schedule');
    vi.resetModules();
  });

  it('maps a layout the planner refuses to a user-facing 400', () => {
    const broken = [phaseGroup('ga', 1, 'sg-a', ['p1']), phaseGroup('gb', 2, 'sg-b', ['p1'])];
    expect(() => planPhaseWeeks({ groups: broken, rounds: [], matches: [] })).toThrow(
      expect.objectContaining({ code: 'rounds_group_layout_invalid', statusCode: 400 }),
    );
  });
});
