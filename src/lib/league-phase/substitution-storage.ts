import { getPhasesBySeasonId, getPhaseParticipants, swapPhaseParticipant } from '@/lib/supabase/queries/league-phases';
import { getGroupMembershipsInPhase } from '@/lib/supabase/queries/phase-groups';
import type { NativeSubstituteAffectedMatch, SubstitutionStoragePort } from '@/lib/season/substitute';

export interface NativeSubstitutionCallbacks {
  matches: (phases: Array<{ id: string; name: string }>, playerId: string) => Promise<NativeSubstituteAffectedMatch[]>;
  cancelProposals: SubstitutionStoragePort['cancelProposals'];
  repairMatch: SubstitutionStoragePort['repairMatch'];
  moveSeat: SubstitutionStoragePort['moveSeat'];
}

export function createNativeSubstitutionStorage(callbacks: NativeSubstitutionCallbacks): Extract<SubstitutionStoragePort, { kind: 'phase' }> {
  return {
    kind: 'phase',
    stages: getPhasesBySeasonId,
    participants: getPhaseParticipants,
    memberships: getGroupMembershipsInPhase,
    swapEnrollment: swapPhaseParticipant,
    ...callbacks,
  };
}
