import type { BracketGenerationPersistence, BracketPersistence } from '@/lib/tournament/bracket-generate';
import { getRoundsByPhase, updatePhaseRoundStatus, writePhaseBracket, type PhaseBracketInputGuard } from '@/lib/supabase/queries/phase-rounds';
import type { Phase } from '@/types/league-phase';
import type { Season } from '@/types/season';
import { phaseMachine } from './phase-state';

type BracketResultsPersistence = Pick<BracketPersistence, 'getMatches' | 'getMatch' | 'resetMatch'>;

export function isInitialClassicPhaseBracket(
  phase: Pick<Phase, 'archived' | 'bracket_type' | 'current_round' | 'enrollment_source' | 'stage_spec' | 'status'>,
  season: Pick<Season, 'archived' | 'format_type' | 'status'>,
): boolean {
  return season.format_type !== 'custom' && !season.archived && (season.status === 'upcoming' || season.status === 'active')
    && phase.stage_spec === null && phase.status === 'upcoming' && !phase.archived
    && phase.current_round === 0 && phase.enrollment_source !== null
    && (phase.bracket_type === 'single_elim' || phase.bracket_type === 'double_elim');
}

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
