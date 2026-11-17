import 'server-only';
import { listPhaseTeamsForPinImpact } from '@/lib/supabase/queries/phase-teams';
import { listTeamsForPinImpact } from '@/lib/supabase/queries/teams';
import { computePinImpactWithStorage, type PinImpactInput } from './pin-impact.server';
import { loadMoveTargetsWithPhases, type NativePinKind, type NativePinState, type NativePinTarget } from './phase-pins';

export async function computePinImpactWithPhases(
  input: Omit<PinImpactInput, 'targets'> & { targets: readonly NativePinTarget[] },
) {
  return computePinImpactWithStorage<NativePinKind, NativePinState>(input, {
    targets: (...args) => loadMoveTargetsWithPhases(...args),
    teams: (state, budget) => state.kind === 'phase'
      ? listPhaseTeamsForPinImpact(state.id, budget)
      : listTeamsForPinImpact({ kind: state.kind, id: state.id }, budget),
  });
}
