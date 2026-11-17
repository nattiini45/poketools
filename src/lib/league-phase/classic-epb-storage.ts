import { getPhasesBySeasonId } from '@/lib/supabase/queries/league-phases';
import { getRoundsByPhase } from '@/lib/supabase/queries/phase-rounds';
import type { EpbPhaseStoragePort } from '@/lib/season/epb-phase';

export function createNativeEpbPhaseStorage(callbacks: Pick<EpbPhaseStoragePort, 'weekPlan' | 'matches' | 'completedRecords'>): EpbPhaseStoragePort & { kind: 'phase' } {
  return { kind: 'phase', stages: getPhasesBySeasonId, rounds: getRoundsByPhase, ...callbacks };
}
