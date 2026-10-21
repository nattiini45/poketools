/**
 * The Hinrunde boundary (one definition for the redraft gate and the Comeback Token earn window,
 * tokens are earned in the first half only): rounds 1..floor(rounds / 2) of the primary (lowest stage_order) stage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getStagesBySeasonId: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getCompletedMatchRecords: vi.fn() }));
vi.mock('@/lib/tournament/phase-week-plan', () => ({ getGroupedPhaseWeekPlan: vi.fn() }));

import { getEpbPhaseStatus, getHinrundeScope, hinrundeLastRound } from '../epb-phase';
import { supabase } from '@/lib/supabase/client';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getGroupedPhaseWeekPlan } from '@/lib/tournament/phase-week-plan';

const rounds = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, round_number: i + 1 })) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGroupedPhaseWeekPlan).mockResolvedValue(null);
  vi.mocked(getCompletedMatchRecords).mockResolvedValue([]);
});

/** `n` written rounds, each `completed` (or not), with `perRound` matches each. */
function writtenRounds(n: number, completedThrough: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i + 1}`,
    round_number: i + 1,
    status: i + 1 <= completedThrough ? 'completed' : 'active',
  }));
}

/** The matches read (`from('matches').select().eq().in()`): one finished match per requested round id. */
function mockMatchesRead(roundsById: Map<string, number>, completedThrough: number) {
  const inFn = vi.fn(async (_col: string, ids: string[]) => ({
    data: ids.map((id) => ({
      id: `m-${id}`,
      round_id: id,
      status: (roundsById.get(id) ?? 0) <= completedThrough ? 'completed' : 'pending',
      rounds: { round_number: roundsById.get(id) },
    })),
    error: null,
  }));
  const eq = vi.fn(() => ({ in: inFn }));
  const select = vi.fn(() => ({ eq }));
  vi.mocked(supabase.from).mockReturnValue({ select } as never);
  return inFn;
}

describe('hinrundeLastRound', () => {
  it.each([
    [18, 9],
    [9, 4],
    [8, 4],
    [2, 1],
    [1, 0],
    [0, 0],
  ])('%i rounds → Hinrunde ends after round %i', (total, last) => {
    expect(hinrundeLastRound(total)).toBe(last);
  });
});

describe('getHinrundeScope', () => {
  it('uses the primary stage (first by stage_order) and its round count', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([{ id: 'stage-1' }, { id: 'playoffs' }] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue(rounds(9));

    expect(await getHinrundeScope('s1')).toEqual({ tournament_id: 'stage-1', last_round: 4 });
    expect(getRoundsByTournament).toHaveBeenCalledWith('stage-1');
  });

  it('is null without a stage, and null while the primary stage has no rounds', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([]);
    expect(await getHinrundeScope('s1')).toBeNull();
    expect(getRoundsByTournament).not.toHaveBeenCalled();

    vi.mocked(getStagesBySeasonId).mockResolvedValue([{ id: 'stage-1' }] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    expect(await getHinrundeScope('s1')).toBeNull();
  });

  it('propagates a failed read', async () => {
    const failure = new Error('stages read failed');
    vi.mocked(getStagesBySeasonId).mockRejectedValue(failure);
    await expect(getHinrundeScope('s1')).rejects.toBe(failure);
  });
});

describe('Hinrunde of a phase whose groups mirror league groups (planned weeks, not written rounds)', () => {
  // 7+7: 11 planned weeks, Hinrunde = weeks 1..5 (week 5 is the placement week that closes the first half).
  const plan77 = { totalWeeks: 11, firstHalfLastWeek: 5 };

  function setup(written: number, completedThrough: number) {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([{ id: 'phase-1' }] as never);
    const rs = writtenRounds(written, completedThrough);
    vi.mocked(getRoundsByTournament).mockResolvedValue(rs as never);
    vi.mocked(getGroupedPhaseWeekPlan).mockResolvedValue(plan77);
    return mockMatchesRead(new Map(rs.map((r) => [r.id, r.round_number])), completedThrough);
  }

  it('after weeks 1-2 of 2 written: Hinrunde is weeks 1..5, not complete', async () => {
    setup(2, 2);
    const status = await getEpbPhaseStatus('s1');
    expect(status.total_rounds).toBe(11);
    expect(status.hinrunde_round_numbers).toEqual([1, 2, 3, 4, 5]);
    expect(status.has_first_half_matches).toBe(true);
    expect(status.hinrunde_complete).toBe(false);
  });

  it('after weeks 1-4 written and completed (placement week 5 not generated yet): still not complete', async () => {
    setup(4, 4);
    const status = await getEpbPhaseStatus('s1');
    expect(status.hinrunde_round_numbers).toEqual([1, 2, 3, 4, 5]);
    expect(status.hinrunde_complete).toBe(false);
  });

  it('week 5 written but open: not complete; week 5 completed: complete', async () => {
    setup(5, 4);
    expect((await getEpbPhaseStatus('s1')).hinrunde_complete).toBe(false);
    setup(6, 5);
    const status = await getEpbPhaseStatus('s1');
    expect(status.hinrunde_complete).toBe(true);
    expect(Object.keys(status.completed_matches_by_round)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('getHinrundeScope takes the planned boundary (week 5), not half of the 4 written rounds', async () => {
    setup(4, 4);
    expect(await getHinrundeScope('s1')).toEqual({ tournament_id: 'phase-1', last_round: 5 });
  });

  it('a stage without league groups keeps the written-rounds rule (regression)', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([{ id: 'phase-1' }] as never);
    const rs = writtenRounds(4, 2);
    vi.mocked(getRoundsByTournament).mockResolvedValue(rs as never);
    mockMatchesRead(new Map(rs.map((r) => [r.id, r.round_number])), 2);
    const status = await getEpbPhaseStatus('s1');
    expect(status.total_rounds).toBe(4);
    expect(status.hinrunde_round_numbers).toEqual([1, 2]);
    expect(status.hinrunde_complete).toBe(true);
    expect(await getHinrundeScope('s1')).toEqual({ tournament_id: 'phase-1', last_round: 2 });
  });
});
