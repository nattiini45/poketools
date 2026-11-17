import type {
  applyMatchRatingResult,
  getCompletedMatchesForRatingReplay,
  getPlayerRating,
  getRatingHistoryByMatch,
  getRatingHistoryByMatches,
  loadRatingScope,
  replacePlayerRatingCurve,
} from '@/lib/supabase/queries/ratings';

export interface RatingStreamMatch extends Omit<Awaited<ReturnType<typeof getCompletedMatchesForRatingReplay>>[number], 'tournament_id'> {
  tournament_id?: string;
  phase_id?: string;
}

export interface RatingStoragePort {
  countsForRatings(matchId: string): Promise<boolean | null>;
  loadScope: typeof loadRatingScope;
  getCompletedMatches(playerId: string): Promise<RatingStreamMatch[]>;
  getPlayerRating: typeof getPlayerRating;
  getHistoryByMatch: typeof getRatingHistoryByMatch;
  getHistoryByMatches: typeof getRatingHistoryByMatches;
  applyMatchResult: typeof applyMatchRatingResult;
  replacePlayerCurve: typeof replacePlayerRatingCurve;
}
