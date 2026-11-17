import { createSeasonReconciler } from '@/lib/reconcile/reconcile-season';
import { createEpbEvolutionRebuilder, diffEvolutionState } from '@/lib/reconcile/evolution-rebuild';
import { createMixedEpbRebuildStorage } from './epb-storage';
import { createMixedRatingStorage, mixedStreakStorage } from './rating-streak-streams';
import { getSeasonById, getSeasonParticipants, listAllSeasonIds } from '@/lib/supabase/queries/seasons';
import { getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { listSeasonCompletedMatchPlayerIds } from '@/lib/supabase/queries/ratings';
import { listPhaseSeasonCompletedMatchPlayerIds } from '@/lib/supabase/queries/phase-reconciliation';
import { loadAndComputeRatingCurve, planRatingRebuild, rebuildRatingsForPlayersWithStorage } from '@/lib/rating/updateRatings';
import { rebuildMixedAggregatesForScope } from '@/lib/match/aggregate-rebuild';
import { recomputeStreaksWithStorage } from '@/lib/gamification/streaks';
import type { PhaseAggregateOwner } from './phase-aggregate-storage';

export function createMixedSeasonReconciler(onPhaseRebuilt: (owner: PhaseAggregateOwner) => Promise<void>) {
  const ratings = createMixedRatingStorage('phase');
  const evolution = createEpbEvolutionRebuilder(createMixedEpbRebuildStorage());
  return createSeasonReconciler({
    getSeasonById: (...args) => getSeasonById(...args),
    getSeasonParticipants: (...args) => getSeasonParticipants(...args),
    getSeasonTrackers: (...args) => getSeasonTrackers(...args),
    listAllSeasonIds: (...args) => listAllSeasonIds(...args),
    listSeasonCompletedMatchPlayerIds: async (id) => {
      const [legacy, phases] = await Promise.all([
        listSeasonCompletedMatchPlayerIds(id), listPhaseSeasonCompletedMatchPlayerIds(id),
      ]);
      return [...new Set([...legacy, ...phases])];
    },
    computeSeasonEvolutionState: (id) => evolution.computeSeasonEvolutionState(id),
    diffEvolutionState: (...args) => diffEvolutionState(...args),
    repairSeasonEvolution: (id) => evolution.repairSeasonEvolution(id),
    loadAndComputeRatingCurve: (id, options) => loadAndComputeRatingCurve(id, { ...options, storage: ratings }),
    planRatingRebuild: (ids, options) => planRatingRebuild(ids, { ...options, storage: ratings }),
    rebuildRatingsForPlayers: (ids) => rebuildRatingsForPlayersWithStorage(ids, ratings),
    rebuildAggregatesForScope: (scope, id) => rebuildMixedAggregatesForScope(scope, id,
      (phase_id, season_id) => onPhaseRebuilt({ kind: 'phase', phase_id, season_id })),
    recomputeStreaks: (id) => recomputeStreaksWithStorage(id, mixedStreakStorage),
  });
}
