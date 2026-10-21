import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Per-group advancement from a phase whose groups mirror league groups: the group tables count cross-group
 * matches (one table over the phase, split per group). Phase-only groups keep counting in-group matches only.
 */

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getStagesBySeasonId: vi.fn(),
  getParticipants: vi.fn(),
  replacePhaseParticipants: vi.fn(),
  setEnrollmentSource: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
  getSeasonParticipants: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getCompletedMatchRecords: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({ getGroupsByTournament: vi.fn() }));
vi.mock('@/lib/tournament/season-standings', async () => {
  const { computeStandings } = await import('@/lib/tournament/standings');
  return {
    computeStandingsForSeason: vi.fn(
      async (_season: string, ids: string[], names: Record<string, string>, matches: never[]) =>
        computeStandings(ids, names, matches),
    ),
  };
});

import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import {
  getParticipants,
  getStagesBySeasonId,
  getTournamentById,
  replacePhaseParticipants,
} from '@/lib/supabase/queries/tournaments';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';

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

// a2 beats a1 in the group, but a1 wins two cross matches: with cross matches a1 tops Gold.
const records = [
  { player_1_id: 'a1', player_2_id: 'a2', winner_id: 'a2', round_number: 1 },
  { player_1_id: 'a1', player_2_id: 'b1', winner_id: 'a1', round_number: 2 },
  { player_1_id: 'a1', player_2_id: 'b2', winner_id: 'a1', round_number: 3 },
  { player_1_id: 'b1', player_2_id: 'b2', winner_id: 'b1', round_number: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTournamentById).mockResolvedValue({
    id: 'playoffs',
    season_id: 's1',
    stage_order: 2,
    advancement_rule: { type: 'top_n', count: 1, per_group: true },
    enrollment_source: null,
  } as never);
  vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  vi.mocked(getSeasonById).mockResolvedValue({ id: 's1', name: 'League' } as never);
  vi.mocked(getStagesBySeasonId).mockResolvedValue([
    { id: 'phase-1', name: 'Regular', stage_order: 1 },
    { id: 'playoffs', name: 'Playoffs', stage_order: 2 },
  ] as never);
  vi.mocked(getParticipants).mockResolvedValue(
    ['a1', 'a2', 'b1', 'b2'].map((id) => ({ id, name: id, seed: null })) as never,
  );
  vi.mocked(getCompletedMatchRecords).mockResolvedValue(records);
});

describe('per-group advancement', () => {
  it('mirrored league groups: the group table counts cross matches', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([
      group('ga', 1, 'sg-a', ['a1', 'a2']),
      group('gb', 2, 'sg-b', ['b1', 'b2']),
    ]);
    await syncStandingsEnrollment('s1', 'playoffs');
    expect(vi.mocked(replacePhaseParticipants).mock.calls[0][1]).toEqual([
      { player_id: 'a1', seed: 1 },
      { player_id: 'b1', seed: 2 },
    ]);
  });

  it('phase-only groups: unchanged, only in-group matches count', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([
      group('ga', 1, null, ['a1', 'a2']),
      group('gb', 2, null, ['b1', 'b2']),
    ]);
    await syncStandingsEnrollment('s1', 'playoffs');
    expect(vi.mocked(replacePhaseParticipants).mock.calls[0][1]).toEqual([
      { player_id: 'a2', seed: 1 },
      { player_id: 'b1', seed: 2 },
    ]);
  });
});
