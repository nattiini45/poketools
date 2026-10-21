/**
 * The rating rebuild after a league's test-league flag is set
 * (src/lib/rating/test-league-rebuild.ts): whose curves it rewrites, the
 * further passes over every rebuilt player while a pass still changed one
 * (up to the cap, then `settled: false`), and the cache expiry even on failure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/ratings', () => ({
  listSeasonCompletedMatchPlayerIds: vi.fn(),
}));
vi.mock('@/lib/rating/updateRatings', () => ({
  rebuildRatingsForPlayers: vi.fn(),
}));
vi.mock('@/lib/revalidation', () => ({
  expireRatingReads: vi.fn(),
}));

import { MAX_PASSES, rebuildRatingsAfterTestFlagChange } from '../test-league-rebuild';
import { listSeasonCompletedMatchPlayerIds } from '@/lib/supabase/queries/ratings';
import { rebuildRatingsForPlayers, type RebuildRatingsResult } from '@/lib/rating/updateRatings';
import { expireRatingReads } from '@/lib/revalidation';

const mockPlayers = vi.mocked(listSeasonCompletedMatchPlayerIds);
const mockRebuild = vi.mocked(rebuildRatingsForPlayers);
const mockExpire = vi.mocked(expireRatingReads);

function result(
  playerId: string,
  { unratedMatchIds = [], addedToBatch = false, changed = true }: Partial<RebuildRatingsResult> = {}
): RebuildRatingsResult {
  return { playerId, addedToBatch, matchesReplayed: 3, ratingBefore: 1500, ratingAfter: 1520, unratedMatchIds, changed };
}

const unchanged = (playerId: string) => result(playerId, { changed: false });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rebuildRatingsAfterTestFlagChange', () => {
  it('flag ON: repeats the pass over every rebuilt player and stops when a pass changes nobody', async () => {
    mockPlayers.mockResolvedValue(['p1', 'p2']);
    mockRebuild
      .mockResolvedValueOnce([result('p1'), result('p2'), result('healed', { addedToBatch: true })])
      .mockResolvedValueOnce([unchanged('p1'), unchanged('p2'), unchanged('healed')]);

    const summary = await rebuildRatingsAfterTestFlagChange('s1', true);

    expect(mockPlayers).toHaveBeenCalledWith('s1');
    expect(mockRebuild.mock.calls).toEqual([[['p1', 'p2']], [['p1', 'p2', 'healed']]]);
    expect(summary).toEqual({
      seasonId: 's1',
      isTestSeason: true,
      playerIds: ['p1', 'p2'],
      rebuiltPlayerIds: ['p1', 'p2', 'healed'],
      passes: 2,
      settled: true,
      unratedMatches: 0,
    });
    expect(mockExpire).toHaveBeenCalledWith(['p1', 'p2', 'healed']);
  });

  it('flag OFF: pairs the never-rated league matches in a further pass over every rebuilt player', async () => {
    mockPlayers.mockResolvedValue(['p1', 'p2']);
    mockRebuild
      .mockResolvedValueOnce([result('p1', { unratedMatchIds: ['m1', 'm2'] }), result('p2', { unratedMatchIds: ['m1'] })])
      .mockResolvedValueOnce([unchanged('p1'), unchanged('p2')]);

    const summary = await rebuildRatingsAfterTestFlagChange('s1', false);

    expect(mockRebuild.mock.calls).toEqual([[['p1', 'p2']], [['p1', 'p2']]]);
    expect(summary).toMatchObject({ isTestSeason: false, passes: 2, settled: true, unratedMatches: 2 });
  });

  it('stops after the first pass when it changed nobody (the stored curves were already settled)', async () => {
    mockPlayers.mockResolvedValue(['p1', 'p2']);
    mockRebuild.mockResolvedValueOnce([unchanged('p1'), unchanged('p2')]);

    const summary = await rebuildRatingsAfterTestFlagChange('s1', true);

    expect(mockRebuild).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ passes: 1, settled: true });
  });

  it('runs a third pass when the second still changed a player, over everyone rewritten so far', async () => {
    mockPlayers.mockResolvedValue(['p1', 'p2']);
    mockRebuild
      .mockResolvedValueOnce([result('p1'), result('p2')])
      // One changed player is enough to replay everyone again; healing may add a player in any pass.
      .mockResolvedValueOnce([unchanged('p1'), result('p2'), result('late', { addedToBatch: true, changed: false })])
      .mockResolvedValueOnce([unchanged('p1'), unchanged('p2'), unchanged('late')]);

    const summary = await rebuildRatingsAfterTestFlagChange('s1', true);

    expect(mockRebuild.mock.calls).toEqual([[['p1', 'p2']], [['p1', 'p2']], [['p1', 'p2', 'late']]]);
    expect(summary).toMatchObject({ passes: 3, settled: true, rebuiltPlayerIds: ['p1', 'p2', 'late'] });
    expect(mockExpire).toHaveBeenCalledWith(['p1', 'p2', 'late']);
  });

  it('stops after the confirming pass past the cap and reports settled: false while every pass still changed a player', async () => {
    mockPlayers.mockResolvedValue(['p1', 'p2']);
    mockRebuild.mockResolvedValue([result('p1'), unchanged('p2')]);

    const summary = await rebuildRatingsAfterTestFlagChange('s1', true);

    expect(MAX_PASSES).toBe(8);
    expect(mockRebuild).toHaveBeenCalledTimes(MAX_PASSES + 1);
    expect(summary).toMatchObject({ passes: MAX_PASSES + 1, settled: false });
  });

  it('confirms a run that reaches the fixed point on its MAX_PASSES-th pass as settled', async () => {
    mockPlayers.mockResolvedValue(['p1', 'p2']);
    for (let pass = 1; pass <= MAX_PASSES; pass += 1) mockRebuild.mockResolvedValueOnce([result('p1'), unchanged('p2')]);
    mockRebuild.mockResolvedValueOnce([unchanged('p1'), unchanged('p2')]);

    const summary = await rebuildRatingsAfterTestFlagChange('s1', true);

    expect(mockRebuild).toHaveBeenCalledTimes(MAX_PASSES + 1);
    expect(summary).toMatchObject({ passes: MAX_PASSES + 1, settled: true });
  });

  it('does nothing for a league without completed matches', async () => {
    mockPlayers.mockResolvedValue([]);

    const summary = await rebuildRatingsAfterTestFlagChange('s1', true);

    expect(mockRebuild).not.toHaveBeenCalled();
    expect(mockExpire).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ passes: 0, settled: true, playerIds: [], rebuiltPlayerIds: [] });
  });

  it('throws a rebuild failure unchanged and still expires the rating reads of the league players', async () => {
    const error = new Error('gap cycle');
    mockPlayers.mockResolvedValue(['p1', 'p2']);
    mockRebuild.mockRejectedValue(error);

    await expect(rebuildRatingsAfterTestFlagChange('s1', true)).rejects.toBe(error);
    expect(mockExpire).toHaveBeenCalledWith(['p1', 'p2']);
  });

  it('expires every player of the first pass when the second pass fails', async () => {
    const error = new Error('second pass failed');
    mockPlayers.mockResolvedValue(['p1']);
    mockRebuild
      .mockResolvedValueOnce([result('p1', { unratedMatchIds: ['m1'] }), result('p9', { addedToBatch: true })])
      .mockRejectedValueOnce(error);

    await expect(rebuildRatingsAfterTestFlagChange('s1', false)).rejects.toBe(error);
    expect(mockExpire).toHaveBeenCalledWith(['p1', 'p9']);
  });

  it('throws a failed player listing unchanged, before any rebuild', async () => {
    const error = new Error('matches read failed');
    mockPlayers.mockRejectedValue(error);

    await expect(rebuildRatingsAfterTestFlagChange('s1', true)).rejects.toBe(error);
    expect(mockRebuild).not.toHaveBeenCalled();
  });
});
