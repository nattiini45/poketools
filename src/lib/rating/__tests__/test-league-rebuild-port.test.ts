import { describe, expect, it, vi } from 'vitest';
import { createTestLeagueRatingRebuilder, MAX_PASSES, rebuildRatingsAfterTestFlagChange, rebuildRatingsSettled, type TestLeagueRatingRebuildStorage } from '../test-league-rebuild';
import type { RebuildRatingsResult } from '../updateRatings';

vi.mock('@/lib/supabase/queries/ratings', () => ({}));
vi.mock('@/lib/rating/updateRatings', () => ({}));
vi.mock('@/lib/gamification/streaks', () => ({}));
vi.mock('@/lib/revalidation', () => ({}));

function result(playerId: string, changed: boolean): RebuildRatingsResult {
  return { playerId, changed, addedToBatch: false, matchesReplayed: 1, ratingBefore: 1500, ratingAfter: 1510, unratedMatchIds: ['match'] };
}

function storage() {
  return {
    listSeasonCompletedMatchPlayerIds: vi.fn<TestLeagueRatingRebuildStorage['listSeasonCompletedMatchPlayerIds']>().mockResolvedValue(['one', 'two']),
    rebuildRatingsForPlayers: vi.fn<TestLeagueRatingRebuildStorage['rebuildRatingsForPlayers']>(),
    recomputeStreaks: vi.fn<TestLeagueRatingRebuildStorage['recomputeStreaks']>().mockResolvedValue({ win_streak: { before: 0, after: 1 }, loss_streak: { before: 0, after: 0 }, ko_streak: { before: 0, after: 0 }, flawless_streak: { before: 0, after: 0 }, new_records: [] }),
    expireRatingReads: vi.fn<TestLeagueRatingRebuildStorage['expireRatingReads']>(),
  };
}

describe('test-league rating rebuilder storage factory', () => {
  it('settles every rewritten player, including additions, solely through the supplied port', async () => {
    const port = storage();
    port.rebuildRatingsForPlayers.mockResolvedValueOnce([result('one', true), result('added', true)]).mockResolvedValueOnce([result('one', false), result('added', false)]);
    const rebuilt = await createTestLeagueRatingRebuilder(port).rebuildRatingsSettled(['one']);
    expect(rebuilt).toEqual({ rebuiltPlayerIds: ['one', 'added'], passes: 2, settled: true, unratedMatches: 1 });
    expect(port.rebuildRatingsForPlayers.mock.calls).toEqual([[['one']], [['one', 'added']]]);
    expect(port.expireRatingReads).toHaveBeenCalledWith(['one', 'added']);
    expect(port.listSeasonCompletedMatchPlayerIds).not.toHaveBeenCalled();
    expect(port.recomputeStreaks).not.toHaveBeenCalled();
  });

  it('uses supplied season discovery and rebuilds streaks only after ratings settle', async () => {
    const port = storage();
    const order: string[] = [];
    port.rebuildRatingsForPlayers.mockImplementation(async () => { order.push('ratings'); return [result('one', false), result('two', false)]; });
    port.recomputeStreaks.mockImplementation(async (id) => { order.push(id); return { win_streak: { before: 0, after: 1 }, loss_streak: { before: 0, after: 0 }, ko_streak: { before: 0, after: 0 }, flawless_streak: { before: 0, after: 0 }, new_records: [] }; });
    const summary = await createTestLeagueRatingRebuilder(port).rebuildRatingsAfterTestFlagChange('season', true);
    expect(order).toEqual(['ratings', 'one', 'two']);
    expect(port.listSeasonCompletedMatchPlayerIds).toHaveBeenCalledWith('season');
    expect(summary).toMatchObject({ seasonId: 'season', isTestSeason: true, playerIds: ['one', 'two'], streaksRebuilt: 2, settled: true });
  });

  it('keeps the pass cap and expires all known players after a later failure', async () => {
    const port = storage();
    port.rebuildRatingsForPlayers.mockResolvedValue([result('one', true)]);
    expect((await createTestLeagueRatingRebuilder(port).rebuildRatingsSettled(['one'])).settled).toBe(false);
    expect(port.rebuildRatingsForPlayers).toHaveBeenCalledTimes(MAX_PASSES + 1);
    port.rebuildRatingsForPlayers.mockReset().mockResolvedValueOnce([result('one', true), result('added', true)]).mockRejectedValueOnce(new Error('retry failed'));
    await expect(createTestLeagueRatingRebuilder(port).rebuildRatingsSettled(['one'])).rejects.toThrow('retry failed');
    expect(port.expireRatingReads).toHaveBeenLastCalledWith(['one', 'added']);
  });

  it('keeps legacy export arity and does not touch lazy dependencies for an empty settle', async () => {
    expect(rebuildRatingsSettled.length).toBe(1);
    expect(rebuildRatingsAfterTestFlagChange.length).toBe(2);
    expect(await rebuildRatingsSettled([])).toEqual({ rebuiltPlayerIds: [], passes: 0, settled: true, unratedMatches: 0 });
  });
});
