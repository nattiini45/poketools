import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Per-group advancement from a phase whose groups mirror league groups: the group tables count cross-group
 * matches (one table over the phase, split per group). Phase-only groups keep counting in-group matches only.
 * Also pins the top-N cut, the bye scoring of a Swiss source and the group-row substitution behaviour of
 * `syncStandingsEnrollment`, with the real standings underneath.
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
      async (
        _season: string,
        ids: string[],
        names: Record<string, string>,
        matches: never[],
        avatars: Record<string, string | null> = {},
        options: Record<string, unknown> = {},
      ) => computeStandings(ids, names, matches, avatars, options),
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

const enrolled = (ids: string[]) => ids.map((id) => ({ id, name: id.toUpperCase(), seed: null }));

describe('top-N advancement over the whole phase', () => {
  // p1 beats everyone, p2 beats p3 and p4, p3 beats p4: a strict ranking p1 > p2 > p3 > p4.
  const ranked = [
    { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', round_number: 1 },
    { player_1_id: 'p1', player_2_id: 'p3', winner_id: 'p1', round_number: 2 },
    { player_1_id: 'p1', player_2_id: 'p4', winner_id: 'p1', round_number: 3 },
    { player_1_id: 'p2', player_2_id: 'p3', winner_id: 'p2', round_number: 1 },
    { player_1_id: 'p2', player_2_id: 'p4', winner_id: 'p2', round_number: 2 },
    { player_1_id: 'p3', player_2_id: 'p4', winner_id: 'p3', round_number: 1 },
  ];

  function arrange(count: number, perGroup = false) {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'playoffs',
      season_id: 's1',
      stage_order: 2,
      advancement_rule: { type: 'top_n', count, per_group: perGroup },
      enrollment_source: null,
    } as never);
    vi.mocked(getParticipants).mockResolvedValue(enrolled(['p1', 'p2', 'p3', 'p4']) as never);
    vi.mocked(getCompletedMatchRecords).mockResolvedValue(ranked);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
  }

  const enrolledSeeds = () => vi.mocked(replacePhaseParticipants).mock.calls[0][1];

  it('enrols the top N by standings, seeded by placement', async () => {
    arrange(2);
    await syncStandingsEnrollment('s1', 'playoffs');
    expect(enrolledSeeds()).toEqual([
      { player_id: 'p1', seed: 1 },
      { player_id: 'p2', seed: 2 },
    ]);
  });

  it('enrols the whole field when the count equals the field size', async () => {
    arrange(4);
    await syncStandingsEnrollment('s1', 'playoffs');
    expect(enrolledSeeds().map((e) => e.player_id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('enrols the whole field when the count is larger than the field', async () => {
    arrange(10);
    await syncStandingsEnrollment('s1', 'playoffs');
    expect(enrolledSeeds().map((e) => e.player_id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('enrols a single player for a top-1 cut', async () => {
    arrange(1);
    await syncStandingsEnrollment('s1', 'playoffs');
    expect(enrolledSeeds()).toEqual([{ player_id: 'p1', seed: 1 }]);
  });

  it('falls back to the overall table when a per-group rule meets a phase without groups', async () => {
    arrange(2, true);
    await syncStandingsEnrollment('s1', 'playoffs');
    expect(enrolledSeeds().map((e) => e.player_id)).toEqual(['p1', 'p2']);
  });
});

describe('advancement from a Swiss source with stored byes', () => {
  // a beat b, c beat d; e sat out round 1 with a bye.
  const matches = [
    { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
    { player_1_id: 'c', player_2_id: 'd', winner_id: 'c', round_number: 1 },
  ];

  function arrange(bracketType: 'swiss' | 'round_robin', rule: { count: number; per_group: boolean }) {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'playoffs',
      season_id: 's1',
      stage_order: 2,
      advancement_rule: { type: 'top_n', ...rule },
      enrollment_source: null,
    } as never);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([
      { id: 'phase-1', name: 'Regular', stage_order: 1, bracket_type: bracketType },
      { id: 'playoffs', name: 'Playoffs', stage_order: 2, bracket_type: 'single_elim' },
    ] as never);
    vi.mocked(getParticipants).mockResolvedValue(enrolled(['a', 'b', 'c', 'd', 'e']) as never);
    vi.mocked(getCompletedMatchRecords).mockResolvedValue(matches);
    vi.mocked(getRoundsByTournament).mockImplementation(async (id) =>
      id === 'phase-1' ? ([{ round_number: 1, bye_player_ids: ['e'] }] as never) : ([] as never),
    );
  }

  const advanced = () => vi.mocked(replacePhaseParticipants).mock.calls[0][1].map((e) => e.player_id);

  it('lets a bye win count toward the top N, as in the stage table', async () => {
    arrange('swiss', { count: 3, per_group: false });
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    await syncStandingsEnrollment('s1', 'playoffs');
    // a, c and e each have one win: with the bye e is in the top 3.
    expect(advanced()).toContain('e');
  });

  it('does not score the byes of a round robin source', async () => {
    arrange('round_robin', { count: 3, per_group: false });
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    await syncStandingsEnrollment('s1', 'playoffs');
    expect(advanced()).not.toContain('e');
  });

  it('applies the byes inside a group table too', async () => {
    arrange('swiss', { count: 2, per_group: true });
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('ga', 1, null, ['a', 'b', 'e'])]);
    await syncStandingsEnrollment('s1', 'playoffs');
    expect([...advanced()].sort()).toEqual(['a', 'e']);
  });
});

/**
 * Why the group row has to move with the enrollment: per-group advancement builds each group's standings from
 * its member rows and only counts matches between two members. A substitution moves the enrollment and the
 * fixtures to the substitute, so the group row has to follow, or the substitute's matches vanish.
 */
describe('per-group advancement follows the group member rows (substitution regression)', () => {
  // The phase enrollment already names the substitute ('in') in both scenarios.
  const A2 = 'group-a-2';
  const A3 = 'group-a-3';
  const B1 = 'group-b-1';
  const B2 = 'group-b-2';

  // Round 1 A2 beat A3; the substitute then won both repaired fixtures.
  const substitutionMatches = [
    { player_1_id: A2, player_2_id: A3, winner_id: A2, round_number: 1 },
    { player_1_id: 'in', player_2_id: A2, winner_id: 'in', round_number: 2 },
    { player_1_id: A3, player_2_id: 'in', winner_id: 'in', round_number: 3 },
    { player_1_id: B1, player_2_id: B2, winner_id: B1, round_number: 1 },
  ];

  beforeEach(() => {
    vi.mocked(getParticipants).mockResolvedValue(enrolled(['in', A2, A3, B1, B2]) as never);
    vi.mocked(getCompletedMatchRecords).mockResolvedValue(substitutionMatches);
  });

  const advanced = () => vi.mocked(replacePhaseParticipants).mock.calls[0][1].map((e) => e.player_id);

  it("counts the substitute's matches when the group row moved to them", async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([
      group('ga', 1, null, ['in', A2, A3]),
      group('gb', 2, null, [B1, B2]),
    ]);
    await syncStandingsEnrollment('s1', 'playoffs');
    expect(advanced()).toEqual(['in', B1]);
  });

  it("ignores the substitute's matches when the departed player still holds the group row", async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([
      group('ga', 1, null, ['out', A2, A3]),
      group('gb', 2, null, [B1, B2]),
    ]);
    await syncStandingsEnrollment('s1', 'playoffs');
    // The substitute's two wins vanish: A2 tops the group on a single win.
    expect(advanced()).toEqual([A2, B1]);
    expect(advanced()).not.toContain('in');
  });
});
