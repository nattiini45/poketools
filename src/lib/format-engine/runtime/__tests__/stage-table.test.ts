import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/queries/format-engine', () => ({ getOutcomesByPhases: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getCompletedMatchRecords: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('../../load', () => ({ loadSeedsAndRatings: vi.fn(), stageOf: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime', () => ({ getFormatRuntime: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-formats', () => ({ getSeasonFormat: vi.fn() }));

import { getOutcomesByPhases } from '@/lib/supabase/queries/format-engine';
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
  return { seasonId: 's', seed: SEED, def, state, tunableIssues: [], phases };
}

const swiss: Pairing = { kind: 'swiss', rounds: 'auto', avoid_repeats: true };
const roundRobin: Pairing = { kind: 'round_robin', legs: 1, mirror_legs: true };
const match = (id: string, p1: string, p2: string, winner: string) => ({ match_id: id, player_1_id: p1, player_2_id: p2, winner_id: winner, round_number: 1 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOutcomesByPhases).mockResolvedValue([]);
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
