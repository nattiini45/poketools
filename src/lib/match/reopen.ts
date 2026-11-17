import { UserFacingError } from '@/lib/api/user-facing-error';
import { MatchReopenDownstreamPlayedError, MatchStateChangedError } from '@/lib/match/state-errors';
import { clearMatchSocialImage, getMatchById, transitionMatchStatus } from '@/lib/supabase/queries/matches';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { deleteMatchAnalysis } from '@/lib/supabase/queries/match-analyses';
import { deleteMatchPrepAnalysesByMatch } from '@/lib/supabase/queries/match-prep-analyses';
import { deleteMatchSnapshots } from '@/lib/supabase/queries/match-snapshots';
import { deleteMarkedOutcome, readOutcomeMark } from '@/lib/match/outcome-takeback';
import { unpropagateBracketOnMatchReset } from '@/lib/tournament/bracket-propagation';
import { validateTransition } from '@/lib/tournament/match-state';
import {
  collectPlayedDownstreamMatches, preflightUncompleteRebuild, rebuildGamificationAfterUncomplete,
  recheckEvolutions, revertRoundIfCompleted,
} from '@/lib/pkmn/game-pipeline';
import { isKitCandidate } from '@/lib/format-engine/kit-candidate';
import { loadStageEndedWarning } from '@/lib/match/stage-ended';
import { repairSeasonEvolution } from '@/lib/reconcile/evolution-rebuild';
import { createMatchReopener } from './reopen-core';
import type { MatchWithPlayers } from '@/types/match';
import type { Tournament } from '@/types/tournament';
import type { ReopenMatchResult } from '@/lib/admin/match-detail';

export { MatchReopenDownstreamPlayedError, MatchStateChangedError };
export { createMatchReopener } from './reopen-core';
export type { MatchReopenStorage } from './reopen-core';

const legacyReopen = createMatchReopener<MatchWithPlayers, Tournament>({
  competitionId: (match) => match.tournament_id,
  getMatchById: (id) => getMatchById(id),
  getCompetitionById: (id) => getTournamentById(id),
  competitionNotFound: 'Tournament not found',
  validateTransition: (match, adminId) => {
    const transition = validateTransition(match.status, 'in_progress', {
      actor_id: adminId,
      is_admin: true,
      player_1_id: match.player_1_id,
      player_2_id: match.player_2_id,
    });
    if (!transition.valid) {
      throw new UserFacingError(transition.error ?? 'Invalid transition', {
        code: transition.code, params: transition.params, status: 400,
      });
    }
  },
  getParticipants: (id) => getParticipants(id),
  preflightUncompleteRebuild: (match) => preflightUncompleteRebuild(match),
  collectPlayedDownstreamMatches: (match, competition, participants) => collectPlayedDownstreamMatches(match, competition, participants),
  readOutcomeMark: (id) => readOutcomeMark(id),
  transitionToInProgress: (id, from) => transitionMatchStatus(id, {
    expectedStatus: from, status: 'in_progress', winnerId: null,
  }),
  deleteMarkedOutcome: (id, mark) => deleteMarkedOutcome(id, mark),
  revertFormatCompletion: async (match, competition) => {
    if (!isKitCandidate(competition)) return;
    const { revertMatchCompletion } = await import('@/lib/format-engine/runtime/hooks');
    if (!(await revertMatchCompletion({ tournamentId: competition.id, matchId: match.id }))) {
      throw new Error('The format runtime could not take back the effects of the completion');
    }
  },
  revertRoundIfCompleted: (id) => revertRoundIfCompleted(id),
  unpropagateBracketOnMatchReset: (match, competition, participants) => unpropagateBracketOnMatchReset(match, competition, participants),
  deleteMatchAnalysis: (id) => deleteMatchAnalysis(id),
  deleteMatchPrepAnalyses: (id) => deleteMatchPrepAnalysesByMatch(id),
  deleteMatchSnapshots: (id) => deleteMatchSnapshots(id),
  clearMatchSocialImage: (id) => clearMatchSocialImage(id),
  rebuildGamificationAfterUncomplete: (...args) => rebuildGamificationAfterUncomplete(...args),
  repairSeasonEvolution: (id) => repairSeasonEvolution(id),
  recheckEvolutions: (...args) => recheckEvolutions(...args),
  loadStageEndedWarning: (competition, takenBack) => loadStageEndedWarning(competition, takenBack),
});

export async function reopenMatch(matchId: string, adminId: string): Promise<ReopenMatchResult> {
  return legacyReopen(matchId, adminId);
}
