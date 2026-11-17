import { createTestLeagueRatingRebuilder } from '@/lib/rating/test-league-rebuild';
import { rebuildRatingsForPlayersWithStorage } from '@/lib/rating/updateRatings';
import { recomputeStreaksWithStorage } from '@/lib/gamification/streaks';
import { expireRatingReads } from '@/lib/revalidation';
import { listSeasonCompletedMatchPlayerIds } from '@/lib/supabase/queries/ratings';
import { listPhaseSeasonCompletedMatchPlayerIds } from '@/lib/supabase/queries/phase-reconciliation';
import { createMixedRatingStorage, mixedStreakStorage } from './rating-streak-streams';

export function createMixedTestLeagueRatingRebuilder() {
  const ratings = createMixedRatingStorage('phase');
  return createTestLeagueRatingRebuilder({
    listSeasonCompletedMatchPlayerIds: async (id) => {
      const [legacyPlayers, phasePlayers] = await Promise.all([
        listSeasonCompletedMatchPlayerIds(id),
        listPhaseSeasonCompletedMatchPlayerIds(id),
      ]);
      return [...new Set([...legacyPlayers, ...phasePlayers])];
    },
    rebuildRatingsForPlayers: (ids) => rebuildRatingsForPlayersWithStorage(ids, ratings),
    recomputeStreaks: (id) => recomputeStreaksWithStorage(id, mixedStreakStorage),
    expireRatingReads: (ids) => expireRatingReads(ids),
  });
}
