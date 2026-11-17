import { UserFacingError } from '@/lib/api/user-facing-error';
import { MatchReopenDownstreamPlayedError, MatchStateChangedError } from './state-errors';
import { canReopenMatch } from '@/lib/tournament/match-state';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import type { MatchWithPlayers } from '@/types/match';
import type { Tournament } from '@/types/tournament';
import type { GamePipelineParticipant } from '@/lib/league-phase/game-pipeline-types';
import type { ReopenMatchResult, ReopenStep } from '@/lib/admin/match-detail';
import type { StageEndedWarning } from './stage-ended-warning';

export type ReopenMatch = Pick<MatchWithPlayers, 'id' | 'status' | 'round_id' | 'player_1_id' | 'player_2_id'>;
export type ReopenCompetition = Pick<Tournament, 'id' | 'season_id' | 'season_format_type'>;

export interface MatchReopenStorage<M extends ReopenMatch, C extends ReopenCompetition> {
  competitionId(match: M): string;
  getMatchById(id: string): Promise<M | null>;
  getCompetitionById(id: string): Promise<C | null>;
  competitionNotFound: string;
  validateTransition(match: M, adminId: string): void;
  getParticipants(id: string): Promise<GamePipelineParticipant[]>;
  preflightUncompleteRebuild(match: M): Promise<void>;
  collectPlayedDownstreamMatches(match: M, competition: C, participants: GamePipelineParticipant[]): Promise<readonly unknown[]>;
  readOutcomeMark(id: string): Promise<string | null>;
  transitionToInProgress(id: string, from: M['status']): Promise<object | null>;
  deleteMarkedOutcome(id: string, mark: string | null): Promise<void>;
  revertFormatCompletion(match: M, competition: C): Promise<void>;
  revertRoundIfCompleted(id: string): Promise<void>;
  unpropagateBracketOnMatchReset(match: M, competition: C, participants: GamePipelineParticipant[]): Promise<string[]>;
  deleteMatchAnalysis(id: string): Promise<void>;
  deleteMatchPrepAnalyses(id: string): Promise<void>;
  deleteMatchSnapshots(id: string): Promise<void>;
  clearMatchSocialImage(id: string): Promise<void>;
  rebuildGamificationAfterUncomplete(wasCompleted: boolean, after: string, p1: string, p2: string): Promise<string[]>;
  repairSeasonEvolution(id: string): Promise<unknown>;
  recheckEvolutions(seasonId: string | null, p1: string, p2: string): Promise<{ failed: boolean }>;
  loadStageEndedWarning(competition: C, takenBack: boolean): Promise<StageEndedWarning | null>;
}

export function createMatchReopener<M extends ReopenMatch, C extends ReopenCompetition>(storage: MatchReopenStorage<M, C>) {
  return async function reopenMatch(matchId: string, adminId: string): Promise<ReopenMatchResult> {
    const match = await storage.getMatchById(matchId);
    if (!match) throw new Error('Match not found');
    const competitionId = storage.competitionId(match);
    const competition = await storage.getCompetitionById(competitionId);
    if (!competition) throw new Error(storage.competitionNotFound);
    const fromStatus = match.status;
    if (!canReopenMatch(fromStatus)) {
      throw new UserFacingError(`Invalid transition: ${String(fromStatus)} → in_progress`, {
        code: 'match_transition_invalid',
        params: { from: String(fromStatus), to: 'in_progress' },
        status: 400,
      });
    }
    storage.validateTransition(match, adminId);

    const wasCompleted = fromStatus === 'completed';
    let participants: GamePipelineParticipant[] = [];
    if (wasCompleted) {
      participants = await storage.getParticipants(competitionId);
      await storage.preflightUncompleteRebuild(match);
      const downstream = await storage.collectPlayedDownstreamMatches(match, competition, participants);
      if (downstream.length) throw new MatchReopenDownstreamPlayedError(downstream.length);
    }

    const outcomeMark = await storage.readOutcomeMark(matchId);
    const reopened = await storage.transitionToInProgress(matchId, fromStatus);
    if (!reopened) {
      const current = await storage.getMatchById(matchId).catch(() => null);
      throw new MatchStateChangedError(current?.status);
    }
    const result: ReopenMatchResult = {
      from_status: fromStatus,
      ratings_rebuilt_players: 0,
      bracket_matches_removed: 0,
      failed_steps: [],
    };
    const runStep = async <T>(step: ReopenStep, run: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await run();
      } catch (err) {
        console.error(`[reopenMatch] match ${matchId}: step "${step}" failed after the reopen was saved:`, err);
        result.failed_steps.push(step);
        return undefined;
      }
    };

    await runStep('outcome', () => storage.deleteMarkedOutcome(matchId, outcomeMark));
    if (wasCompleted || fromStatus === 'disputed') {
      await runStep('format', () => storage.revertFormatCompletion(match, competition));
    }
    if (!wasCompleted) return result;

    await runStep('round', () => storage.revertRoundIfCompleted(match.round_id));
    const removed = await runStep('bracket', () => storage.unpropagateBracketOnMatchReset(match, competition, participants));
    result.bracket_matches_removed = removed?.length ?? 0;
    await runStep('cleanup', async () => {
      await Promise.all([storage.deleteMatchAnalysis(matchId), storage.deleteMatchPrepAnalyses(matchId)]);
      await storage.deleteMatchSnapshots(matchId);
      await storage.clearMatchSocialImage(matchId);
    });
    const rebuilt = await runStep('ratings', () => storage.rebuildGamificationAfterUncomplete(
      true, 'in_progress', match.player_1_id, match.player_2_id,
    ));
    result.ratings_rebuilt_players = rebuilt?.length ?? 0;
    await runStep('evolution', async () => {
      if (competition.season_id && isEvolutionPointBuy(competition.season_format_type ?? '')) {
        await storage.repairSeasonEvolution(competition.season_id);
        return;
      }
      const recheck = await storage.recheckEvolutions(competition.season_id, match.player_1_id, match.player_2_id);
      if (recheck.failed) throw new Error('Evolution recheck reported a failure');
    });
    const warning = await storage.loadStageEndedWarning(competition, true);
    if (warning) result.stage_already_ended = warning;
    return result;
  };
}
