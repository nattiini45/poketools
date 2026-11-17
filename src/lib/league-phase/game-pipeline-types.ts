import type { CompetitionOwner } from '@/types/competition-owner';
import type { MatchWithPlayers } from '@/types/match';
import type { Round } from '@/types/round';
import type { Tournament } from '@/types/tournament';
import type { Game, BattleStat } from '@/types/game';
import type { EvolutionEvent } from '@/types/evolution';
import type { ReplayGameInput } from '@/lib/pkmn/game-pipeline';
import type { StageEndedWarning } from '@/lib/match/stage-ended-warning';
import type { BracketStructureParticipant } from '@/lib/tournament/bracket-structure';
import type { matchMachine } from '@/lib/tournament/match-state';

export type GamePipelineMatch = Pick<MatchWithPlayers,
  'id' | 'round_id' | 'player_1_id' | 'player_2_id' | 'winner_id' | 'status' |
  'player_1_name' | 'player_2_name' | 'bracket_side' | 'bracket_pos' | 'games'>;
export type GamePipelineRound = Pick<Round, 'id' | 'round_number' | 'name' | 'best_of' | 'status'>;
export type GamePipelineCompetition = Pick<Tournament,
  'id' | 'name' | 'season_id' | 'season_format_type' | 'status' | 'bracket_type'>;
export type GamePipelineParticipant = BracketStructureParticipant & { id: string };
export type GamePipelineMatchActor = (typeof matchMachine.spec.actors)[number];
export interface EvolutionRecheckResult {
  events: EvolutionEvent[];
  failed: boolean;
}
export interface EpbGameEditRecheck {
  seasonId: string;
  matchId: string;
  matchday: number;
  playerIds: readonly [string, string];
  game: Game;
  oldStats: BattleStat[];
  newStats: BattleStat[];
  wasCompleted: boolean;
  statusConflict: boolean;
}

type Games = typeof import('@/lib/supabase/queries/games');
type Matches = typeof import('@/lib/supabase/queries/matches');
type Queue = typeof import('@/lib/match/aggregate-queue');
type Aggregates = typeof import('@/lib/supabase/queries/aggregates');

export interface GamePipelineAggregates {
  enqueueAggregateJob(gameId: string, owner: CompetitionOwner): ReturnType<Queue['enqueueAggregateJob']>;
  cancelAggregateJobsForGame(gameId: string): ReturnType<Queue['cancelAggregateJobsForGame']>;
  buildGameAggregateDeltas(stats: BattleStat[], owner: CompetitionOwner, options: { excludeAllTime: boolean }): ReturnType<Aggregates['buildGameAggregateDeltas']>;
  rollbackGameAggregates(gameId: string, marker: string, deltas: ReturnType<Aggregates['buildGameAggregateDeltas']>, owner: CompetitionOwner): ReturnType<Aggregates['rollbackGameAggregates']>;
  applyGameAggregatesNow(gameId: string, owner: CompetitionOwner, deltas: ReturnType<Aggregates['buildGameAggregateDeltas']>): ReturnType<Queue['applyGameAggregatesNow']>;
}

export interface GamePipelineEffects<M extends GamePipelineMatch, C extends GamePipelineCompetition> {
  shouldExcludeFromAllTime: typeof import('@/lib/supabase/queries/test-accounts').shouldExcludeFromAllTime;
  checkPlayerEvolutions: typeof import('@/lib/draft/evolution-engine').checkPlayerEvolutions;
  planRatingRebuild: typeof import('@/lib/rating/updateRatings').planRatingRebuild;
  rebuildRatingsForPlayers: typeof import('@/lib/rating/updateRatings').rebuildRatingsForPlayers;
  recomputeStreaks: typeof import('@/lib/gamification/streaks').recomputeStreaks;
  updateSignatures: typeof import('@/lib/gamification/signatures').updateSignatures;
  repairSeasonEvolution: typeof import('@/lib/reconcile/evolution-rebuild').repairSeasonEvolution;
  recheckEpbAfterEdit(input: EpbGameEditRecheck): Promise<EvolutionRecheckResult>;
  openUnresolvedCheck(match: M): Promise<void>;
  revertFormatCompletion(match: { id: string }, competition: C, before: string, after: string): Promise<boolean>;
  loadStageEndedWarning(competition: C, takenBack: boolean): Promise<StageEndedWarning | null>;
  revalidateMatchPages(competitionId: string, matchId: string): Promise<void>;
  auditUnresolved(match: M, input: ReplayGameInput, outcomeRecorded: boolean): void;
}

export interface GamePipelineStorage<M extends GamePipelineMatch, C extends GamePipelineCompetition>
  extends Pick<Games, 'createGame' | 'createBattleStats' | 'getNextGameNumber' | 'getGameWinCounts' |
    'getGameById' | 'getGamesByMatch' | 'getBattleStatsByGame' | 'deleteBattleStatsByGame' |
    'deleteUncountedGameRow' | 'updateGameWinner' | 'setGameStatsLocked' | 'claimGameEditLease' |
    'releaseGameEditLease' | 'findGameIdByReplayHash'>,
    GamePipelineAggregates, GamePipelineEffects<M, C> {
  competitionId(match: M): string;
  owner(competitionId: string, seasonId: string | null): CompetitionOwner;
  getCompetitionById(id: string): Promise<C | null>;
  getMatchById(id: string): Promise<M | null>;
  getMatchesByRound(id: string): Promise<M[]>;
  getMatchesByCompetition(id: string): Promise<M[]>;
  getParticipants(id: string): Promise<GamePipelineParticipant[]>;
  getRoundById(id: string): Promise<GamePipelineRound | null>;
  getRoundsByCompetition(id: string): Promise<GamePipelineRound[]>;
  updateRoundStatus(...args: Parameters<typeof import('@/lib/supabase/queries/rounds').updateRoundStatus>): Promise<object>;
  updateMatchStatus(...args: [...Parameters<Matches['updateMatchStatus']>, actor: GamePipelineMatchActor]): Promise<object | null>;
  transitionMatchStatus(...args: [...Parameters<Matches['transitionMatchStatus']>, actor: GamePipelineMatchActor]): Promise<object | null>;
  resetMatchFields(...args: Parameters<Matches['resetMatchFields']>): Promise<object | null>;
  clearMatchSocialImage: Matches['clearMatchSocialImage'];
  hasDownstreamMatches(matchId: string, snapshot: { competition_id: string; winner_id: string | null; round_id: string }): Promise<boolean>;
  unpropagateBracketOnMatchReset(match: M, competition: C, participants: GamePipelineParticipant[]): Promise<string[]>;
  deleteMatchAnalysis: typeof import('@/lib/supabase/queries/match-analyses').deleteMatchAnalysis;
  deleteMatchPrepAnalysesByMatch: typeof import('@/lib/supabase/queries/match-prep-analyses').deleteMatchPrepAnalysesByMatch;
  deleteMatchSnapshots: typeof import('@/lib/supabase/queries/match-snapshots').deleteMatchSnapshots;
  cleanMatchChildren: typeof import('@/lib/match/match-children').cleanMatchChildren;
  recordMatchOutcome: typeof import('@/lib/supabase/queries/match-outcomes').recordMatchOutcome;
  readOutcomeMark(matchId: string): Promise<string | null>;
  takeBackMarkedOutcome(matchId: string, mark: string | null): Promise<boolean>;
}
