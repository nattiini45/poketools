import { createMatchReopener } from '@/lib/match/reopen-core';
import { createOutcomeTakeback } from '@/lib/match/outcome-takeback';
import { createBracketPropagation } from '@/lib/tournament/bracket-propagation';
import { createNativeBracketPropagationStorage } from './game-pipeline-storage';
import { phaseMatchMachine } from './phase-match-state';
import { getPhaseById, getPhaseParticipants } from '@/lib/supabase/queries/league-phases';
import {
  getPhaseMatchById, transitionPhaseMatchStatus, clearPhaseMatchSocialImage,
} from '@/lib/supabase/queries/phase-matches';
import { getPhaseMatchOutcome, deletePhaseMatchOutcome } from '@/lib/supabase/queries/phase-match-outcomes';
import { deletePhaseMatchAnalyses, deletePhaseMatchPrepAnalyses } from '@/lib/supabase/queries/phase-match-children';
import { deletePhaseMatchSnapshots } from '@/lib/supabase/queries/phase-match-snapshots';
import type { createNativeGamePipeline } from './game-pipeline-storage';
import type { PhaseMatchChildrenEffects } from '@/lib/supabase/queries/phase-match-children';
import type { Phase } from '@/types/league-phase';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';
import type { StageEndedWarning } from '@/lib/match/stage-ended-warning';

type NativePipeline = ReturnType<typeof createNativeGamePipeline>;

export interface NativeMatchReopenEffects extends PhaseMatchChildrenEffects {
  pipeline: Pick<NativePipeline, 'preflightUncompleteRebuild' | 'collectPlayedDownstreamMatches' |
    'rebuildGamificationAfterUncomplete' | 'recheckEvolutions' | 'revertRoundIfCompleted'>;
  revertFormatCompletion(match: PhaseMatchWithPlayers, phase: Phase): Promise<boolean>;
  repairSeasonEvolution(seasonId: string): Promise<unknown>;
  loadStageEndedWarning(phase: Phase, takenBack: boolean): Promise<StageEndedWarning | null>;
}

export function createNativeOutcomeTakeback() {
  return createOutcomeTakeback({
    getMatchOutcome: (id) => getPhaseMatchOutcome(id),
    deleteMatchOutcome: (id, options) => deletePhaseMatchOutcome(id, options),
  });
}

export function createNativeMatchReopener(effects: NativeMatchReopenEffects) {
  const outcome = createNativeOutcomeTakeback();
  const bracket = createBracketPropagation(createNativeBracketPropagationStorage({
    releaseTeams: (id) => effects.releaseTeams(id),
  }));
  return createMatchReopener<PhaseMatchWithPlayers, Phase>({
    competitionId: (match) => match.phase_id,
    getMatchById: (id) => getPhaseMatchById(id),
    getCompetitionById: (id) => getPhaseById(id),
    competitionNotFound: 'Phase not found',
    validateTransition: (match) => phaseMatchMachine.assertTransition(match.status, 'in_progress', 'admin'),
    getParticipants: (id) => getPhaseParticipants(id),
    preflightUncompleteRebuild: (match) => effects.pipeline.preflightUncompleteRebuild(match),
    collectPlayedDownstreamMatches: (...args) => effects.pipeline.collectPlayedDownstreamMatches(...args),
    readOutcomeMark: (id) => outcome.readOutcomeMark(id),
    transitionToInProgress: (id, from) => transitionPhaseMatchStatus(id, {
      expectedStatus: from, status: 'in_progress', winnerId: null,
    }, 'admin'),
    deleteMarkedOutcome: (id, mark) => outcome.deleteMarkedOutcome(id, mark),
    revertFormatCompletion: async (match, phase) => {
      if (!(await effects.revertFormatCompletion(match, phase))) {
        throw new Error('The format runtime could not take back the effects of the completion');
      }
    },
    revertRoundIfCompleted: (id) => effects.pipeline.revertRoundIfCompleted(id),
    unpropagateBracketOnMatchReset: (...args) => bracket.unpropagateBracketOnMatchReset(...args),
    deleteMatchAnalysis: (id) => deletePhaseMatchAnalyses(id),
    deleteMatchPrepAnalyses: (id) => deletePhaseMatchPrepAnalyses(id),
    deleteMatchSnapshots: (id) => deletePhaseMatchSnapshots(id),
    clearMatchSocialImage: (id) => clearPhaseMatchSocialImage(id),
    rebuildGamificationAfterUncomplete: (...args) => effects.pipeline.rebuildGamificationAfterUncomplete(...args),
    repairSeasonEvolution: (id) => effects.repairSeasonEvolution(id),
    recheckEvolutions: (...args) => effects.pipeline.recheckEvolutions(...args),
    loadStageEndedWarning: (phase, takenBack) => effects.loadStageEndedWarning(phase, takenBack),
  });
}
