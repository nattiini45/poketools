import { createMatchFinalizer, type FinalizationAnnouncements, type MatchFinalizationStorage } from '@/lib/match/finalization-core';
import { getPhaseById, getPhaseParticipants } from '@/lib/supabase/queries/league-phases';
import { getPhaseMatchById, markPhaseMatchFinalized } from '@/lib/supabase/queries/phase-matches';
import { getPhaseBattleStatsByMatch } from '@/lib/supabase/queries/phase-games';
import { getPhaseMatchOutcome, recordPhaseMatchOutcome, deletePhaseMatchOutcome } from '@/lib/supabase/queries/phase-match-outcomes';
import { getPhaseMatchSnapshots } from '@/lib/supabase/queries/phase-match-snapshots';
import { getPhaseRoundById } from '@/lib/supabase/queries/phase-rounds';
import { createMixedRatingStorage, getPhaseRatingHistoryByMatches, mixedStreakStorage } from './rating-streak-streams';
import { updateRatingsWithStorage } from '@/lib/rating/updateRatings';
import { recomputeStreaksWithStorage } from '@/lib/gamification/streaks';
import { matchCountsForRatings } from '@/lib/rating/rating-scope';
import { updateSignatures } from '@/lib/gamification/signatures';
import { checkPhaseAchievements } from './achievement-streams';
import { createPhaseEpbStorage } from './epb-storage';
import { createEpbKillEvaluator } from '@/lib/match/evolution-match-evaluator';
import { createEpbMatchdayRunner } from '@/lib/match/epb-matchday';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { isKitCandidate } from '@/lib/format-engine/kit-candidate';
import { createBracketPropagation } from '@/lib/tournament/bracket-propagation';
import { createNativeBracketPropagationStorage } from './game-pipeline-storage';
import type { PhaseMatchChildrenEffects } from '@/lib/supabase/queries/phase-match-children';
import type { Phase } from '@/types/league-phase';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';

export interface PhaseFinalizationEffects extends PhaseMatchChildrenEffects {
  announcements(input: FinalizationAnnouncements<PhaseMatchWithPlayers, Phase>): void | Promise<void>;
  formatHook: MatchFinalizationStorage<PhaseMatchWithPlayers, Phase>['runFormatHook'];
  revalidate: MatchFinalizationStorage<PhaseMatchWithPlayers, Phase>['revalidateMatchPages'];
}

export function createPhaseMatchFinalizer(effects: PhaseFinalizationEffects) {
  for (const name of ['announcements', 'formatHook', 'revalidate', 'releaseTeams'] as const) {
    if (typeof effects?.[name] !== 'function') throw new Error(`Native phase finalization requires ${name}`);
  }
  const ratings = createMixedRatingStorage('phase');
  const epbStorage = createPhaseEpbStorage();
  const kills = createEpbKillEvaluator(epbStorage);
  const matchday = createEpbMatchdayRunner(epbStorage);
  const bracket = createBracketPropagation(createNativeBracketPropagationStorage(effects));

  return createMatchFinalizer<PhaseMatchWithPlayers, Phase>({
    competitionId: (match) => match.phase_id,
    auditOwner: (match) => ({ phase_id: match.phase_id }),
    resourceType: 'phase_match',
    getMatchById: (...args) => getPhaseMatchById(...args),
    markMatchFinalized: (...args) => markPhaseMatchFinalized(...args),
    loadCompetition: async (id) => {
      const phase = await getPhaseById(id);
      if (!phase) throw new Error(`Phase ${id} not found`);
      return phase;
    },
    getBattleStatsByMatch: (...args) => getPhaseBattleStatsByMatch(...args),
    getMatchOutcome: (...args) => getPhaseMatchOutcome(...args),
    recordMatchOutcome: (...args) => recordPhaseMatchOutcome(...args),
    deleteMatchOutcome: (...args) => deletePhaseMatchOutcome(...args),
    updateRatings: (...args) => updateRatingsWithStorage(...args, ratings),
    recomputeStreaks: (id) => recomputeStreaksWithStorage(id, mixedStreakStorage),
    updateSignatures: (...args) => updateSignatures(...args),
    checkAchievements: (id, { match, competition, winnerId, loserId }) => checkPhaseAchievements(id, {
      match_id: match.id,
      phase_id: match.phase_id,
      season_id: competition.season_id,
      winner_id: winnerId,
      loser_id: loserId,
      is_draw: false,
    }),
    emitAnnouncements: (input) => effects.announcements(input),
    isEpbCompetition: (phase) => isEvolutionPointBuy(phase.season_format_type ?? ''),
    isElimCompetition: (phase) => phase.bracket_type === 'single_elim' || phase.bracket_type === 'double_elim',
    isKitCandidate: (...args) => isKitCandidate(...args),
    runEpbRealKillsStep: async (match, seasonId, statsByGame) => {
      const round = await getPhaseRoundById(match.round_id);
      if (!round) throw new Error(`Round ${match.round_id} not found; EPB matchday unknown`);
      await kills.creditMatchRealKills({
        seasonId,
        matchday: round.round_number,
        playerIds: [match.player_1_id, match.player_2_id],
        gameIds: [...new Set([...match.games.map((game) => game.id), ...Object.keys(statsByGame)])],
        statsByGame,
      });
      return round.round_number;
    },
    runEpbStep: (match, seasonId, day, battleStats) => matchday({ match, seasonId, matchday: day, battleStats }),
    getMatchSnapshots: (...args) => getPhaseMatchSnapshots(...args),
    runBracketStep: async (match, winnerId, phase) => {
      const participants = await getPhaseParticipants(match.phase_id);
      await bracket.propagateBracketOnMatchComplete({ ...match, winner_id: winnerId, status: 'completed' }, phase, participants);
    },
    runFormatHook: (...args) => effects.formatHook(...args),
    revalidateMatchPages: (...args) => effects.revalidate(...args),
    loadRatingScope: (...args) => ratings.loadScope(...args),
    matchCountsForRatings: (...args) => matchCountsForRatings(...args),
    getRatingHistoryByMatch: (...args) => ratings.getHistoryByMatch(...args),
    getRatingHistoryByMatches: (...args) => getPhaseRatingHistoryByMatches(...args),
  });
}
