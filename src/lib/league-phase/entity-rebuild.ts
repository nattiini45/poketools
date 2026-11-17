import { createEntityDeleteRebuilder } from '@/lib/reconcile/entity-delete-rebuild';
import { clearAggregatesForScope } from '@/lib/supabase/queries/aggregates';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { drainAllPendingAggregateJobs, rebuildMixedAggregatesForScope } from '@/lib/match/aggregate-rebuild';
import { countAllFailedIncrementJobsForSeason, requeueAllFailedIncrementJobsForSeason } from '@/lib/match/aggregate-queue';
import { createEpbEvolutionRebuilder } from '@/lib/reconcile/evolution-rebuild';
import { rebuildRatingsForPlayersWithStorage } from '@/lib/rating/updateRatings';
import { recomputeStreaksWithStorage } from '@/lib/gamification/streaks';
import { createMixedRatingStorage, mixedStreakStorage } from './rating-streak-streams';
import { createMixedEpbRebuildStorage } from './epb-storage';
import { createMixedTestLeagueRatingRebuilder } from './test-league-rating-rebuild';
import type { PhaseAggregateOwner } from './phase-aggregate-storage';

export function createMixedEntityDeleteRebuilder(onPhaseApplied: (owner: PhaseAggregateOwner) => Promise<void>) {
  const ratings = createMixedRatingStorage('phase');
  const evolution = createEpbEvolutionRebuilder(createMixedEpbRebuildStorage());
  const settled = createMixedTestLeagueRatingRebuilder();
  return createEntityDeleteRebuilder({
    clearAggregatesForScope: (...args) => clearAggregatesForScope(...args),
    clearPhaseAggregates: (id) => clearAggregatesForScope('phase', id),
    getSeasonById: (...args) => getSeasonById(...args),
    drainPendingAggregateJobs: (options) => drainAllPendingAggregateJobs(options, onPhaseApplied),
    rebuildAggregatesForScope: (scope, id) => rebuildMixedAggregatesForScope(scope, id,
      (phase_id, season_id) => onPhaseApplied({ kind: 'phase', phase_id, season_id })),
    countFailedIncrementJobsForSeason: (...args) => countAllFailedIncrementJobsForSeason(...args),
    requeueFailedIncrementJobsForSeason: (...args) => requeueAllFailedIncrementJobsForSeason(...args),
    rebuildRatingsForPlayers: (ids) => rebuildRatingsForPlayersWithStorage(ids, ratings),
    rebuildRatingsSettled: (ids) => settled.rebuildRatingsSettled(ids),
    recomputeStreaks: (id) => recomputeStreaksWithStorage(id, mixedStreakStorage),
    repairSeasonEvolution: (id) => evolution.repairSeasonEvolution(id),
  });
}
