import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/tournaments', () => ({ getStagesBySeasonId: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({ getGroupsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getCompletedMatchRecords: vi.fn() }));
vi.mock('@/lib/tournament/season-standings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tournament/season-standings')>();
  return { ...actual, loadSeasonStandingsContext: vi.fn(async () => ({ formatType: 'singles' })) };
});

import { getGroupFirstHalfTables, getGroupedPhaseWeekPlan } from '@/lib/tournament/group-first-half';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';

const group = (id: string, n: number, seasonGroupId: string | null, members: string[]) => ({
  id,
  tournament_id: 'phase-1',
  name: `Group ${n}`,
  group_number: n,
  season_group_id: seasonGroupId,
  created_at: '',
  updated_at: '',
  members: members.map((player_id, i) => ({ player_id, player_name: player_id, seed: i + 1, gym_type: null })),
});

const A = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
const B = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStagesBySeasonId).mockResolvedValue([{ id: 'phase-1' }, { id: 'playoffs' }] as never);
});

describe('getGroupFirstHalfTables', () => {
  it('per league group: the table over the Hinrunde weeks, cross matches included, later weeks left out', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('pa', 1, 'sg-a', A), group('pb', 2, 'sg-b', B)]);
    // 6+6: 9 weeks, Hinrunde = weeks 1..4.
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([
      { player_1_id: 'a6', player_2_id: 'b1', winner_id: 'a6', round_number: 3 }, // cross, in the Hinrunde
      { player_1_id: 'a1', player_2_id: 'a2', winner_id: 'a1', round_number: 5 }, // after the Hinrunde
      { player_1_id: 'b2', player_2_id: 'b3', winner_id: 'b3', round_number: 1 },
    ]);
    const result = await getGroupFirstHalfTables('season-1');
    expect(result).not.toBeNull();
    expect(result!.tournamentId).toBe('phase-1');
    expect(result!.totalWeeks).toBe(9);
    expect(result!.firstHalfLastWeek).toBe(4);
    expect([...result!.tables.keys()]).toEqual(['sg-a', 'sg-b']);
    expect(result!.tables.get('sg-a')![0].player_id).toBe('a6');
    expect(result!.tables.get('sg-a')!.find((r) => r.player_id === 'a1')!.wins).toBe(0);
    expect(result!.tables.get('sg-b')![0].player_id).toBe('b3');
    expect(result!.tables.get('sg-b')!.find((r) => r.player_id === 'b1')!.losses).toBe(1); // the cross loss
  });

  it('null for a league whose primary phase has no league-mirrored groups (season-wide table stays)', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('pa', 1, null, A)]);
    await expect(getGroupFirstHalfTables('season-1')).resolves.toBeNull();
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    await expect(getGroupFirstHalfTables('season-1')).resolves.toBeNull();
    vi.mocked(getStagesBySeasonId).mockResolvedValue([]);
    await expect(getGroupFirstHalfTables('season-1')).resolves.toBeNull();
  });
});

describe('getGroupedPhaseWeekPlan', () => {
  it('the planned weeks of a grouped phase, independent of the rounds written so far', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('pa', 1, 'sg-a', [...A, 'a7']), group('pb', 2, 'sg-b', [...B, 'b7'])]);
    await expect(getGroupedPhaseWeekPlan('phase-1')).resolves.toEqual({ totalWeeks: 11, firstHalfLastWeek: 5 });
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('pa', 1, null, A)]);
    await expect(getGroupedPhaseWeekPlan('phase-1')).resolves.toBeNull();
  });
});
