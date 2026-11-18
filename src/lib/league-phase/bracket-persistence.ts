import type { BracketGenerationPersistence, BracketPersistence } from '@/lib/tournament/bracket-generate';
import { getRoundsByPhase, updatePhaseRoundStatus, writePhaseBracket } from '@/lib/supabase/queries/phase-rounds';
import { phaseMachine } from './phase-state';

type BracketResultsPersistence = Pick<BracketPersistence, 'getMatches' | 'getMatch' | 'resetMatch'>;

export function createNativeBracketPersistence(): BracketGenerationPersistence;
export function createNativeBracketPersistence(results: BracketResultsPersistence): BracketPersistence;
export function createNativeBracketPersistence(results?: BracketResultsPersistence): BracketGenerationPersistence {
  return {
    getRounds: getRoundsByPhase,
    updateRoundStatus: updatePhaseRoundStatus,
    write: ({ competition_id, ...input }) => writePhaseBracket({ phase_id: competition_id, ...input }),
    machine: phaseMachine,
    ...results,
  };
}
