import { createAutoConfirmHandler, type AutoConfirmStorage } from '@/lib/match/auto-confirm';
import { phaseMatchMachine } from './phase-match-state';
import {
  getPhaseMatchById,
  listPhaseMatchesNeedingFinalize,
  listPhaseMatchesReadyForAutoConfirm,
  updatePhaseMatchStatus,
} from '@/lib/supabase/queries/phase-matches';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';

type PhaseFinalizer = Pick<AutoConfirmStorage<PhaseMatchWithPlayers>,
  'finalizeMatchCompletion' | 'healMatchFinalization' | 'findMatchesNeedingAdmin'>;

export function createPhaseAutoConfirmHandler(finalizer: PhaseFinalizer) {
  return createAutoConfirmHandler<PhaseMatchWithPlayers>({
    ...finalizer,
    machine: phaseMatchMachine,
    resourceType: 'phase_match',
    auditOwner: (match) => ({ phase_id: match.phase_id }),
    getMatchById: (...args) => getPhaseMatchById(...args),
    listMatchesNeedingFinalize: (...args) => listPhaseMatchesNeedingFinalize(...args),
    listMatchesReadyForAutoConfirm: (...args) => listPhaseMatchesReadyForAutoConfirm(...args),
    updateMatchStatus: (...args) => updatePhaseMatchStatus(...args),
  });
}
