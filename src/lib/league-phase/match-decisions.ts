import { createMatchDecisionHandler } from '@/lib/match/match-decisions-core';
import { getPhaseMatchById, updatePhaseMatchStatus } from '@/lib/supabase/queries/phase-matches';
import type { createPhaseMatchFinalizer } from './finalization';
import type { MatchDecisionPlayer } from '@/lib/match/match-decisions-core';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';

export interface NativeMatchDecisionEffects {
  finalizer: Pick<ReturnType<typeof createPhaseMatchFinalizer>, 'finalizeMatchCompletion'>;
  canAdminister(player: MatchDecisionPlayer, phaseId: string): Promise<boolean>;
  revalidate(phaseId: string, matchId: string): Promise<void>;
  announceDispute(input: { match: PhaseMatchWithPlayers; player: MatchDecisionPlayer }): Promise<void>;
}

export function createNativeMatchDecisionHandler(effects: NativeMatchDecisionEffects) {
  for (const name of ['canAdminister', 'revalidate', 'announceDispute'] as const) {
    if (typeof effects?.[name] !== 'function') throw new Error(`Native phase match decisions require ${name}`);
  }
  if (typeof effects.finalizer?.finalizeMatchCompletion !== 'function') {
    throw new Error('Native phase match decisions require a configured finalizer');
  }
  return createMatchDecisionHandler<PhaseMatchWithPlayers>({
    competitionId: (match) => match.phase_id,
    getMatchById: (id) => getPhaseMatchById(id),
    canAdminister: (player, id) => effects.canAdminister(player, id),
    updateMatchStatus: (id, status, winnerId, submitterId, notes, expectedStatus, asAdmin) =>
      updatePhaseMatchStatus(id, status, winnerId, submitterId, notes, expectedStatus, asAdmin ? 'admin' : 'player'),
    finalizeMatchCompletion: (input) => effects.finalizer.finalizeMatchCompletion(input),
    resourceType: 'phase_match',
    auditOwner: (match) => ({ phase_id: match.phase_id }),
    revalidate: (phaseId, matchId) => effects.revalidate(phaseId, matchId),
    announceDispute: (input) => effects.announceDispute(input),
  });
}
