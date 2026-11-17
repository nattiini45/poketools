import 'server-only';
import { syncStandingsEnrollment, type SyncStandingsOptions } from '@/lib/tournament/enrollment-sync';
import { computeStandingsFromContext } from '@/lib/tournament/season-standings';
import { kitAdvancingPlayers } from '@/lib/format-engine/advance';
import { kitForPhase, ranksWithKit } from '@/lib/format-engine/context';
import { effectiveMatchPoints, roundRobinMatchPoints } from '@/lib/tournament/standings-rules';
import { playoffStandingsOptions } from '@/lib/tournament/league-placings';
import { formatScoresByes } from '@/lib/tournament/byes';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getPhaseStandingsBattleStats } from '@/lib/supabase/queries/phase-games';
import { getNativeKitCompletedRecords, getNativeKitOutcomes, getNativeKitMatchIds, getNativeKitGameCounts, getNativeKitKills } from '@/lib/supabase/queries/phase-format-runtime';
import { createNativeEnrollmentPersistence } from './enrollment-persistence';
import { loadNativeSeasonStandingsContext } from './standings-context';
import { nativeKitReadStorage } from './kit-storage';

export function createNativePhaseEnrollment() {
  const kitStorage = nativeKitReadStorage({
    outcomes: getNativeKitOutcomes, matchIds: getNativeKitMatchIds,
    gameCounts: getNativeKitGameCounts, kills: getNativeKitKills,
  });
  const persistence = createNativeEnrollmentPersistence({
    getCompletedMatches: id => getNativeKitCompletedRecords(id),
    kitAdvancingPlayers: input => kitAdvancingPlayers(input, kitStorage),
    computeStandings: async (seasonId, ...args) => {
      if (!seasonId) throw new Error('Native enrollment requires a league');
      return computeStandingsFromContext(await loadNativeSeasonStandingsContext(seasonId), ...args);
    },
    computeSourceStandings: async (phaseId, seasonId, ids, names, matches, avatars, options = {}, gymTypes) => {
      if (!seasonId) throw new Error('Native enrollment requires a league');
      const phase = await getPhaseById(phaseId);
      if (!phase || phase.season_id !== seasonId) throw new Error('Native enrollment source league mismatch');
      const loaded = await loadNativeSeasonStandingsContext(seasonId);
      const kit = kitForPhase(loaded.kit, phaseId);
      if (loaded.kit && !kit) throw new Error('Native enrollment source has no attached kit stage');
      const context = { ...loaded, ...(kit ? { kit } : {}) };
      const battleStats = ranksWithKit(context.formatType, kit) ? undefined : await getPhaseStandingsBattleStats(phaseId);
      const points = effectiveMatchPoints(context.formatType, phase.bracket_type === 'round_robin'
        ? roundRobinMatchPoints(context.formatType) : {});
      return computeStandingsFromContext(context, ids, names, matches, avatars, {
        ...options, ...points, ...playoffStandingsOptions(phase, ids.length), battleStats,
        byes: formatScoresByes(context.formatType) ? options.byes : [],
      }, gymTypes);
    },
  });
  const sync = (seasonId: string, phaseId: string, options: SyncStandingsOptions = {}) =>
    syncStandingsEnrollment(seasonId, phaseId, options, persistence);
  return {
    sync,
    enroll: (seasonId: string, targetId: string, sourceId: string) => sync(seasonId, targetId, { source_phase_id: sourceId }),
  };
}
