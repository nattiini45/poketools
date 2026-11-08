import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/queries/format-engine', () => ({ getOutcomesByPhases: vi.fn(), getPhaseGameCounts: vi.fn() }));
vi.mock('@/lib/supabase/queries/games', () => ({ getPhaseKillTallies: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({ getGroupsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getCompletedMatchRecords: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('../../load', () => ({ loadSeedsAndRatings: vi.fn(), stageOf: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime', () => ({ getFormatRuntime: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-formats', () => ({ getSeasonFormat: vi.fn() }));

import { getOutcomesByPhases, getPhaseGameCounts } from '@/lib/supabase/queries/format-engine';
import { getPhaseKillTallies } from '@/lib/supabase/queries/games';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import type { Pairing, Stage } from '@/lib/format-kit/types';
import { loadSeedsAndRatings } from '../../load';
import type { KitContext } from '../load';
import { loadStageRows, loadStageTable } from '../stage-table';
import { SEED, stateFor, wichtelDef } from './helpers';

const def = wichtelDef();

function stage(key: string, pairing: Pairing): Stage {
  return { ...def.stages[0], key, pairing, scoring: { win: 3, loss: 0, bye: 2 }, rank: [{ kind: 'metric', metric: 'points', direction: 'desc' }] };
}

function context(phases: KitContext['phases'], state = stateFor(def)): KitContext {
  return { seasonId: 's', seed: SEED, revision: 1, def, state, tunableIssues: [], phases };
}

const swiss: Pairing = { kind: 'swiss', rounds: 'auto', avoid_repeats: true };
const roundRobin: Pairing = { kind: 'round_robin', legs: 1, mirror_legs: true };
const match = (id: string, p1: string, p2: string, winner: string) => ({ match_id: id, player_1_id: p1, player_2_id: p2, winner_id: winner, round_number: 1 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOutcomesByPhases).mockResolvedValue([]);
  vi.mocked(getPhaseGameCounts).mockResolvedValue({});
  vi.mocked(getPhaseKillTallies).mockResolvedValue({});
  vi.mocked(getGroupsByTournament).mockResolvedValue([]);
  vi.mocked(getCompletedMatchRecords).mockResolvedValue([]);
  vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 1, bye_player_ids: ['c'] }] as never);
  vi.mocked(loadSeedsAndRatings).mockResolvedValue({});
});

describe('loadStageTable byes', () => {
  it('scores a Swiss bye, like the public table', async () => {
    const ctx = context([{ id: 'ph', stage: stage('swiss', swiss), members: ['a', 'b', 'c'] }]);
    const table = await loadStageTable(ctx, 'ph');
    expect(table?.find((row) => row.player_id === 'c')).toMatchObject({ wins: 1, points: 2 });
  });

  it.each([
    ['a round robin', roundRobin],
    ['a single elimination bracket', { kind: 'single_elim', third_place: false } as Pairing],
  ])('does not score the bye of %s', async (_name, pairing) => {
    const ctx = context([{ id: 'ph', stage: stage('cup', pairing), members: ['a', 'b', 'c'] }]);
    const table = await loadStageTable(ctx, 'ph');
    expect(table?.find((row) => row.player_id === 'c')).toMatchObject({ wins: 0, points: 0 });
  });
});

describe('loadStageTable extras', () => {
  it('ranks by the seeds and ratings it loads for the stage', async () => {
    vi.mocked(loadSeedsAndRatings).mockResolvedValue({ seeds: { ph: { a: 3, b: 1, c: 2 } }, ratings: { a: 1, b: 2, c: 3 } });
    const ranked = { ...stage('swiss', swiss), rank: [{ kind: 'metric', metric: 'seed', direction: 'asc' }] } as Stage;
    const table = await loadStageTable(context([{ id: 'ph', stage: ranked, members: ['a', 'b', 'c'] }]), 'ph');
    expect(table?.map((row) => row.player_id)).toEqual(['b', 'c', 'a']);
  });
});

describe('loadStageTable games', () => {
  it('counts the games of the completed matches, so games_played and a games_played rank step are real', async () => {
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([match('m1', 'a', 'b', 'a'), match('m2', 'b', 'c', 'c')]);
    vi.mocked(getPhaseGameCounts).mockResolvedValue({ m1: 1, m2: 3 });
    const ranked = { ...stage('swiss', swiss), rank: [{ kind: 'metric', metric: 'games_played', direction: 'desc' }] } as Stage;
    const table = await loadStageTable(context([{ id: 'ph', stage: ranked, members: ['a', 'b', 'c'] }]), 'ph');
    expect(getPhaseGameCounts).toHaveBeenCalledWith(['ph']);
    expect(Object.fromEntries((table ?? []).map((row) => [row.player_id, row.games_played]))).toEqual({ a: 1, b: 4, c: 3 });
    expect(table?.map((row) => row.player_id)).toEqual(['b', 'c', 'a']);
  });

  it('hands games_played to the advancement rows an event target reads', async () => {
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([match('m1', 'a', 'b', 'a')]);
    vi.mocked(getPhaseGameCounts).mockResolvedValue({ m1: 2 });
    const rows = await loadStageRows(context([{ id: 'ph', stage: stage('swiss', swiss), members: ['a', 'b'] }]), 'swiss');
    expect(rows?.a.games_played).toBe(2);
    expect(rows?.b.games_played).toBe(2);
  });
});

describe('loadStageTable kills', () => {
  const killRanked = (pairing: Pairing) =>
    ({ ...stage('league', pairing), rank: [{ kind: 'metric', metric: 'kill_differential', direction: 'desc' }] }) as Stage;

  it('counts the kills of a round robin stage from the kill tallies, like the public table', async () => {
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([match('m1', 'a', 'b', 'a'), match('m2', 'b', 'c', 'b')]);
    vi.mocked(getPhaseKillTallies).mockResolvedValue({ m1: { a: 3, b: -1 }, m2: { b: 2 } });
    const table = await loadStageTable(context([{ id: 'ph', stage: killRanked(roundRobin), members: ['a', 'b', 'c'] }]), 'ph');
    expect(getPhaseKillTallies).toHaveBeenCalledWith(['ph']);
    expect(Object.fromEntries((table ?? []).map((row) => [row.player_id, row.kill_differential]))).toEqual({ a: 3, b: 1, c: 0 });
    expect(table?.map((row) => row.player_id)).toEqual(['a', 'b', 'c']);
  });

  it('counts the kills of a match the table scores only', async () => {
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([match('m1', 'a', 'b', 'a')]);
    // m2 is not a completed match of the table (open, or outside it): its kills add nothing.
    vi.mocked(getPhaseKillTallies).mockResolvedValue({ m1: { a: 1 }, m2: { a: 5, b: 5 } });
    const table = await loadStageTable(context([{ id: 'ph', stage: killRanked(roundRobin), members: ['a', 'b'] }]), 'ph');
    expect(Object.fromEntries((table ?? []).map((row) => [row.player_id, row.kill_differential]))).toEqual({ a: 1, b: 0 });
  });

  it('hands kill_differential to the advancement rows an event target reads', async () => {
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([match('m1', 'a', 'b', 'a')]);
    vi.mocked(getPhaseKillTallies).mockResolvedValue({ m1: { a: 4, b: -1 } });
    const rows = await loadStageRows(context([{ id: 'ph', stage: killRanked(roundRobin), members: ['a', 'b'] }]), 'league');
    expect(rows?.a.kill_differential).toBe(4);
    expect(rows?.b.kill_differential).toBe(-1);
  });

  it('reads no kills for a Swiss stage, which the public table does not count either', async () => {
    const table = await loadStageTable(context([{ id: 'ph', stage: killRanked(swiss), members: ['a', 'b'] }]), 'ph');
    expect(getPhaseKillTallies).not.toHaveBeenCalled();
    expect(table?.every((row) => row.kill_differential === 0)).toBe(true);
  });
});

describe('loadStageTable groups', () => {
  const group = (id: string, ids: string[]) => ({ id, members: ids.map((player_id) => ({ player_id })) }) as never;

  it('sets group_rank to the place inside the own group, while rank stays the place in the phase', async () => {
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([match('m1', 'a', 'c', 'a'), match('m2', 'b', 'd', 'b'), match('m3', 'a', 'd', 'a')]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('g1', ['a', 'd']), group('g2', ['b', 'c'])]);
    const rows = await loadStageRows(context([{ id: 'ph', stage: stage('league', roundRobin), members: ['a', 'b', 'c', 'd'] }]), 'league');
    // Phase order: a (6), b (3), then c and d (0, canonical order c, d).
    expect(rows?.a).toMatchObject({ rank: 1, group_rank: 1 });
    expect(rows?.b).toMatchObject({ rank: 2, group_rank: 1 });
    expect(rows?.c).toMatchObject({ rank: 3, group_rank: 2 });
    expect(rows?.d).toMatchObject({ rank: 4, group_rank: 2 });
  });

  it('reads group_rank as the phase rank when the phase has no groups', async () => {
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([match('m1', 'a', 'b', 'b')]);
    const rows = await loadStageRows(context([{ id: 'ph', stage: stage('league', roundRobin), members: ['a', 'b'] }]), 'league');
    expect(rows?.b).toMatchObject({ rank: 1, group_rank: 1 });
    expect(rows?.a).toMatchObject({ rank: 2, group_rank: 2 });
  });
});

describe('loadStageRows', () => {
  const groups: KitContext['phases'] = [
    { id: 'g1', stage: stage('finals', roundRobin), members: ['a', 'b'] },
    { id: 'g2', stage: stage('finals', roundRobin), members: ['c', 'd'] },
  ];

  it('reads the row of every group of a foreach_group stage, not the first group only', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getCompletedMatchRecords).mockImplementation(async (phaseId: string) =>
      phaseId === 'g1' ? [match('m1', 'a', 'b', 'a')] : [match('m2', 'c', 'd', 'd')],
    );
    const rows = await loadStageRows(context(groups), 'finals');
    expect(Object.keys(rows ?? {}).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(rows?.a).toMatchObject({ wins: 1, rank: 1 });
    expect(rows?.d).toMatchObject({ wins: 1, rank: 1 });
    expect(rows?.c).toMatchObject({ wins: 0, rank: 2 });
  });

  it('is undefined for a stage the league has not, and the first phase answers an event without a stage', async () => {
    expect(await loadStageRows(context(groups), 'nope')).toBeUndefined();
    const rows = await loadStageRows(context(groups), undefined);
    expect(Object.keys(rows ?? {}).sort()).toEqual(['a', 'b']);
  });
});
