import { createNativeGamePipeline } from './game-pipeline-storage';
import { createNativeEpbGameEditRechecker } from './epb-game-edit';
import { createPhaseMatchFinalizer, type PhaseFinalizationEffects } from './finalization';
import { createNativeMatchReopener, createNativeOutcomeTakeback } from './reopen';
import { createPhaseAutoConfirmHandler } from './match-maintenance';
import { createNativeMatchDecisionHandler, type NativeMatchDecisionEffects } from './match-decisions';
import { createNativeKitMatchEffects, type NativeKitMatchCallbacks } from './kit-match-effects';
import { createMixedRatingStorage, mixedStreakStorage } from './rating-streak-streams';
import { createMixedEpbRebuildStorage } from './epb-storage';
import {
  enqueuePhaseAggregateJob,
  cancelPhaseAggregateJobsForGame,
  applyPhaseGameAggregatesNow,
  rollbackPhaseGameAggregates,
} from './phase-aggregate-storage';
import { createEpbEvolutionRebuilder } from '@/lib/reconcile/evolution-rebuild';
import { planRatingRebuild, rebuildRatingsForPlayersWithStorage } from '@/lib/rating/updateRatings';
import { recomputeStreaksWithStorage } from '@/lib/gamification/streaks';
import { updateSignatures } from '@/lib/gamification/signatures';
import { phaseEvolutionChecker } from './evolution-checker';
import { shouldExcludeFromAllTime } from '@/lib/supabase/queries/test-accounts';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { buildGameAggregateDeltas } from '@/lib/supabase/queries/aggregates';
import { isKitCandidate } from '@/lib/format-engine/kit-candidate';
import { logAuditEvent } from '@/lib/audit/log';
import { logger } from '@/lib/logger';
import type { CompetitionOwner } from '@/types/competition-owner';
import type { Phase } from '@/types/league-phase';

export interface PhaseMatchServiceEffects
  extends Pick<PhaseFinalizationEffects, 'announcements' | 'revalidate' | 'releaseTeams'>,
    Pick<NativeMatchDecisionEffects, 'canAdminister' | 'announceDispute'> {
  kit: NativeKitMatchCallbacks;
}

function phaseOwner(owner: CompetitionOwner) {
  if (owner.kind !== 'phase') throw new Error('Native match services require a phase aggregate owner');
  return owner;
}

export function createPhaseMatchServices(effects: PhaseMatchServiceEffects) {
  const kit = createNativeKitMatchEffects(effects.kit);
  const ratings = createMixedRatingStorage('phase');
  const evolution = createEpbEvolutionRebuilder(createMixedEpbRebuildStorage());
  const outcome = createNativeOutcomeTakeback();
  const revert = async (match: { id: string }, phase: Phase) => {
    if (!isKitCandidate(phase)) return true;
    try {
      return await kit.reverted({ phase, matchId: match.id });
    } catch (error) {
      logger.error('match/native-format-revert', 'native format runtime could not take back a match completion', {
        matchId: match.id, phaseId: phase.id, error,
      });
      return false;
    }
  };

  const pipeline = createNativeGamePipeline({
    shouldExcludeFromAllTime: (...args) => shouldExcludeFromAllTime(...args),
    checkPlayerEvolutions: (...args) => phaseEvolutionChecker.checkPlayerEvolutions(...args),
    planRatingRebuild: (ids, options) => planRatingRebuild(ids, { ...options, storage: ratings }),
    rebuildRatingsForPlayers: (ids) => rebuildRatingsForPlayersWithStorage(ids, ratings),
    recomputeStreaks: (id) => recomputeStreaksWithStorage(id, mixedStreakStorage),
    updateSignatures: (...args) => updateSignatures(...args),
    repairSeasonEvolution: (id) => evolution.repairSeasonEvolution(id),
    recheckEpbAfterEdit: createNativeEpbGameEditRechecker(),
    readOutcomeMark: (...args) => outcome.readOutcomeMark(...args),
    takeBackMarkedOutcome: (...args) => outcome.takeBackMarkedOutcome(...args),
    releaseTeams: (id) => effects.releaseTeams(id),
    revalidateMatchPages: async (...args) => effects.revalidate(...args),
    loadStageEndedWarning: (...args) => kit.stageEndedWarning(...args),
    revertFormatCompletion: (match, phase, before, after) => {
      if ((before !== 'completed' && !(before === 'disputed' && after !== 'disputed')) || after === 'completed') {
        return Promise.resolve(true);
      }
      return revert(match, phase);
    },
    openUnresolvedCheck: async (match) => {
      const phase = await getPhaseById(match.phase_id);
      if (!phase) throw new Error('Native unresolved match phase not found');
      if (!isKitCandidate(phase)) return;
      await kit.unresolved({ phase, matchId: match.id, player1Id: match.player_1_id, player2Id: match.player_2_id });
    },
    auditUnresolved: (match, input, outcomeRecorded) => logAuditEvent({
      actor_id: null,
      actor_name: 'System',
      action: 'match.replay_unresolved',
      resource_type: 'phase_match',
      resource_id: match.id,
      resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
      changes: { status: { before: match.status, after: 'disputed' } },
      metadata: {
        phase_id: match.phase_id,
        replay_url: input.replay.url,
        submitter_id: input.submitter_id,
        reason: 'replay_engine_tie',
        ...(outcomeRecorded ? {} : { outcome_recorded: false }),
      },
    }),
  }, {
    enqueueAggregateJob: (id, owner) => enqueuePhaseAggregateJob(id, phaseOwner(owner)),
    cancelAggregateJobsForGame: (id) => cancelPhaseAggregateJobsForGame(id),
    buildGameAggregateDeltas: (stats, owner, options) => buildGameAggregateDeltas(stats, phaseOwner(owner), options),
    applyGameAggregatesNow: (id, owner, deltas) => applyPhaseGameAggregatesNow(id, phaseOwner(owner), deltas),
    rollbackGameAggregates: (id, marker, deltas, owner) => {
      phaseOwner(owner);
      return rollbackPhaseGameAggregates(id, marker, deltas);
    },
  });
  const finalizer = createPhaseMatchFinalizer({
    releaseTeams: (id) => effects.releaseTeams(id),
    announcements: (input) => effects.announcements(input),
    revalidate: (...args) => effects.revalidate(...args),
    formatHook: async (match, winnerId, phase, confirmedAt) => {
      const applied = await kit.completed({
        phase, matchId: match.id, roundId: match.round_id,
        player1Id: match.player_1_id, player2Id: match.player_2_id, winnerId, confirmedAt,
      });
      if (!applied) throw new Error('Native format completion effects did not apply');
    },
  });
  const reopenMatch = createNativeMatchReopener({
    pipeline,
    releaseTeams: (id) => effects.releaseTeams(id),
    revertFormatCompletion: (match, phase) => revert(match, phase),
    repairSeasonEvolution: (id) => evolution.repairSeasonEvolution(id),
    loadStageEndedWarning: (...args) => kit.stageEndedWarning(...args),
  });
  return {
    ...pipeline,
    ...finalizer,
    kit,
    reopenMatch,
    autoConfirm: createPhaseAutoConfirmHandler(finalizer),
    decide: createNativeMatchDecisionHandler({
      finalizer,
      canAdminister: (...args) => effects.canAdminister(...args),
      revalidate: async (...args) => effects.revalidate(...args),
      announceDispute: (input) => effects.announceDispute(input),
    }),
  };
}
