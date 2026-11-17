import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMixedTestLeagueRatingRebuilder } from '../test-league-rating-rebuild';
import { createMixedRatingStorage, mixedStreakStorage } from '../rating-streak-streams';
import { rebuildRatingsForPlayersWithStorage } from '@/lib/rating/updateRatings';
import { recomputeStreaksWithStorage } from '@/lib/gamification/streaks';
import { listSeasonCompletedMatchPlayerIds } from '@/lib/supabase/queries/ratings';
import { listPhaseSeasonCompletedMatchPlayerIds } from '@/lib/supabase/queries/phase-reconciliation';

vi.mock('../rating-streak-streams', () => ({ createMixedRatingStorage: vi.fn(() => ({ source: 'mixed' })), mixedStreakStorage: { source: 'mixed-streaks' } }));
vi.mock('@/lib/rating/updateRatings', () => ({
  rebuildRatingsForPlayers: () => { throw new Error('Legacy rebuild must not run'); },
  rebuildRatingsForPlayersWithStorage: vi.fn(async (ids: string[]) => ids.map((playerId) => ({ playerId, changed: false, addedToBatch: false, matchesReplayed: 1, ratingBefore: 1500, ratingAfter: 1500, unratedMatchIds: [] }))),
}));
vi.mock('@/lib/gamification/streaks', () => ({
  recomputeStreaks: () => { throw new Error('Legacy streak rebuild must not run'); },
  recomputeStreaksWithStorage: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/supabase/queries/ratings', () => ({ listSeasonCompletedMatchPlayerIds: vi.fn().mockResolvedValue(['legacy-player', 'shared-player']) }));
vi.mock('@/lib/supabase/queries/phase-reconciliation', () => ({ listPhaseSeasonCompletedMatchPlayerIds: vi.fn().mockResolvedValue(['shared-player', 'phase-player']) }));
vi.mock('@/lib/revalidation', () => ({ expireRatingReads: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe('mixed test-league rating adapter', () => {
  it('unions season players and uses mixed rating/streak projections without a legacy rebuild', async () => {
    const summary = await createMixedTestLeagueRatingRebuilder().rebuildRatingsAfterTestFlagChange('season', false);
    expect(summary.playerIds).toEqual(['legacy-player', 'shared-player', 'phase-player']);
    expect(listSeasonCompletedMatchPlayerIds).toHaveBeenCalledWith('season');
    expect(listPhaseSeasonCompletedMatchPlayerIds).toHaveBeenCalledWith('season');
    const ratings = vi.mocked(createMixedRatingStorage).mock.results[0].value;
    expect(createMixedRatingStorage).toHaveBeenCalledWith('phase');
    expect(rebuildRatingsForPlayersWithStorage).toHaveBeenCalledWith(summary.playerIds, ratings);
    expect(vi.mocked(recomputeStreaksWithStorage).mock.calls).toEqual(summary.playerIds.map((id) => [id, mixedStreakStorage]));
  });

  it('exposes the mixed settle callback directly for delete/restore without querying season membership', async () => {
    await createMixedTestLeagueRatingRebuilder().rebuildRatingsSettled(['restored-player']);
    expect(rebuildRatingsForPlayersWithStorage).toHaveBeenCalledWith(['restored-player'], expect.any(Object));
    expect(listSeasonCompletedMatchPlayerIds).not.toHaveBeenCalled();
    expect(listPhaseSeasonCompletedMatchPlayerIds).not.toHaveBeenCalled();
    expect(recomputeStreaksWithStorage).not.toHaveBeenCalled();
  });
});
