import type { EnrollmentPersistence } from '@/lib/tournament/enrollment-sync';
import { getPhaseById, getPhasesBySeasonId, getPhaseParticipants, replacePhaseEnrollment } from '@/lib/supabase/queries/league-phases';
import { getGroupsByPhase } from '@/lib/supabase/queries/phase-groups';
import { getRoundsByPhase } from '@/lib/supabase/queries/phase-rounds';

export function createNativeEnrollmentPersistence(
  results: Pick<EnrollmentPersistence, 'getCompletedMatches' | 'computeStandings' | 'computeSourceStandings' | 'kitAdvancingPlayers'>,
): EnrollmentPersistence {
  return {
    getPhase: getPhaseById,
    listPhases: getPhasesBySeasonId,
    getParticipants: getPhaseParticipants,
    getGroups: getGroupsByPhase,
    getRounds: getRoundsByPhase,
    replaceEnrollment: replacePhaseEnrollment,
    ...results,
  };
}
