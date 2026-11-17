import { createGamePipeline } from '@/lib/pkmn/game-pipeline';
import { createBracketPropagation, type BracketPropagationStorage, type BracketPropagationMatch } from '@/lib/tournament/bracket-propagation';
import * as games from '@/lib/supabase/queries/phase-games';
import * as matches from '@/lib/supabase/queries/phase-matches';
import { getPhaseById, getPhaseParticipants } from '@/lib/supabase/queries/league-phases';
import { getPhaseRoundById, getRoundsByPhase, updatePhaseRoundStatus } from '@/lib/supabase/queries/phase-rounds';
import { recordPhaseMatchOutcome } from '@/lib/supabase/queries/phase-match-outcomes';
import { deletePhaseMatchSnapshots } from '@/lib/supabase/queries/phase-match-snapshots';
import { cleanPhaseMatchChildren, deletePhaseMatchAnalyses, deletePhaseMatchPrepAnalyses, type PhaseMatchChildrenEffects } from '@/lib/supabase/queries/phase-match-children';
import type { Phase } from '@/types/league-phase';
import type { PhaseMatch, PhaseMatchWithPlayers } from '@/types/league-phase-match';
import type { GamePipelineAggregates, GamePipelineEffects, GamePipelineStorage } from './game-pipeline-types';

type NativeStorage = GamePipelineStorage<PhaseMatchWithPlayers, Phase>;
export type NativeGamePipelineEffects = GamePipelineEffects<PhaseMatchWithPlayers, Phase> &
  Pick<NativeStorage, 'readOutcomeMark' | 'takeBackMarkedOutcome'> & PhaseMatchChildrenEffects;

export function createNativeBracketPropagationStorage(effects: PhaseMatchChildrenEffects): BracketPropagationStorage<PhaseMatch & Pick<BracketPropagationMatch, 'games'>> {
  return {
    getRounds: (id) => getRoundsByPhase(id),
    getMatches: (id) => matches.getMatchesByPhase(id),
    getGames: (id) => games.getPhaseGamesByMatch(id),
    updatePlayers: (id, p1, p2) => matches.updatePhaseMatchPlayers(id, p1, p2),
    deleteMatches: (ids) => matches.deletePhaseMatchesByIds(ids, effects),
    createMatches: async (inputs) => {
      const rows = await matches.createPhaseMatchBatch(inputs.map(({ competition_id, ...input }) => ({ ...input, phase_id: competition_id })));
      return rows.map((row) => ({ ...row, games: [] }));
    },
  };
}

export function createNativeGamePipelineStorage(
  effects: NativeGamePipelineEffects,
  aggregates: GamePipelineAggregates,
): NativeStorage {
  const bracket = createBracketPropagation(createNativeBracketPropagationStorage(effects));
  return {
    ...effects,
    ...aggregates,
    competitionId: (match) => match.phase_id,
    owner: (phase_id, season_id) => {
      if (!season_id) throw new Error('Phase aggregate owner requires a league');
      return { kind: 'phase', phase_id, season_id };
    },
    getCompetitionById: (id) => getPhaseById(id),
    getParticipants: (id) => getPhaseParticipants(id),
    getRoundById: (id) => getPhaseRoundById(id),
    getRoundsByCompetition: (id) => getRoundsByPhase(id),
    updateRoundStatus: (...args) => updatePhaseRoundStatus(...args),
    getMatchById: (id) => matches.getPhaseMatchById(id),
    getMatchesByRound: (id) => matches.getPhaseMatchesByRound(id),
    getMatchesByCompetition: (id) => matches.getMatchesByPhase(id),
    updateMatchStatus: (...args) => matches.updatePhaseMatchStatus(...args),
    transitionMatchStatus: (...args) => matches.transitionPhaseMatchStatus(...args),
    resetMatchFields: (...args) => matches.resetPhaseMatchFields(...args),
    clearMatchSocialImage: (id) => matches.clearPhaseMatchSocialImage(id),
    hasDownstreamMatches: (id, snapshot) => matches.hasDownstreamPhaseMatches(id, {
      phase_id: snapshot.competition_id,
      winner_id: snapshot.winner_id,
      round_id: snapshot.round_id,
    }),
    unpropagateBracketOnMatchReset: (...args) => bracket.unpropagateBracketOnMatchReset(...args),
    createGame: (...args) => games.createPhaseGame(...args),
    createBattleStats: (...args) => games.createPhaseBattleStats(...args),
    getNextGameNumber: (...args) => games.getNextPhaseGameNumber(...args),
    getGameWinCounts: (...args) => games.getPhaseGameWinCounts(...args),
    getGameById: (...args) => games.getPhaseGameById(...args),
    getGamesByMatch: (...args) => games.getPhaseGamesByMatch(...args),
    getBattleStatsByGame: (...args) => games.getPhaseBattleStatsByGame(...args),
    deleteBattleStatsByGame: (...args) => games.deletePhaseBattleStatsByGame(...args),
    deleteUncountedGameRow: (...args) => games.deleteUncountedPhaseGameRow(...args),
    updateGameWinner: (...args) => games.updatePhaseGameWinner(...args),
    setGameStatsLocked: (...args) => games.setPhaseGameStatsLocked(...args),
    claimGameEditLease: (...args) => games.claimPhaseGameEditLease(...args),
    releaseGameEditLease: (...args) => games.releasePhaseGameEditLease(...args),
    findGameIdByReplayHash: (...args) => games.findPhaseGameIdByReplayHash(...args),
    recordMatchOutcome: (...args) => recordPhaseMatchOutcome(...args),
    deleteMatchSnapshots: (...args) => deletePhaseMatchSnapshots(...args),
    deleteMatchAnalysis: (id) => deletePhaseMatchAnalyses(id),
    deleteMatchPrepAnalysesByMatch: (id) => deletePhaseMatchPrepAnalyses(id),
    cleanMatchChildren: (id) => cleanPhaseMatchChildren(id, effects),
  };
}

export function createNativeGamePipeline(effects: NativeGamePipelineEffects, aggregates: GamePipelineAggregates) {
  return createGamePipeline(createNativeGamePipelineStorage(effects, aggregates));
}
