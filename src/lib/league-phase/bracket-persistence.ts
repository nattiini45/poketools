import type { BracketGenerationPersistence, BracketPersistence } from '@/lib/tournament/bracket-generate';
import { getRoundsByPhase, updatePhaseRoundStatus, writePhaseBracket, type PhaseBracketInputGuard } from '@/lib/supabase/queries/phase-rounds';
import { phaseMachine } from './phase-state';

type BracketResultsPersistence = Pick<BracketPersistence, 'getMatches' | 'getMatch' | 'resetMatch'>;

export function createNativeBracketPersistence(results?: undefined, guard?: PhaseBracketInputGuard): BracketGenerationPersistence;
export function createNativeBracketPersistence(results: BracketResultsPersistence, guard?: PhaseBracketInputGuard): BracketPersistence;
export function createNativeBracketPersistence(results?: BracketResultsPersistence, guard?: PhaseBracketInputGuard): BracketGenerationPersistence {
  return {
    getRounds: getRoundsByPhase,
    updateRoundStatus: updatePhaseRoundStatus,
    write: ({ competition_id, ...input }) => writePhaseBracket({ phase_id: competition_id, ...input, ...(guard ? { guard } : {}) }),
    machine: phaseMachine,
    ...results,
  };
}
