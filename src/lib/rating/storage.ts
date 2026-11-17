import type {
  applyMatchRatingResult,
  ApplyMatchRatingOutcome,
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
  confirmed_at?: string | null;
}

export interface RatingCompletionIdentity {
  winnerId: string | null;
  confirmedAt: string | null;
}

export interface RatingStoragePort {
  requiresCompletionFence?: boolean;
  countsForRatings(matchId: string): Promise<boolean | null>;
  loadScope: typeof loadRatingScope;
  getCompletedMatches(playerId: string): Promise<RatingStreamMatch[]>;
  getPlayerRating: typeof getPlayerRating;
  getHistoryByMatch: typeof getRatingHistoryByMatch;
  getHistoryByMatches: typeof getRatingHistoryByMatches;
  applyMatchResult(
    ...args: [...Parameters<typeof applyMatchRatingResult>, completion?: RatingCompletionIdentity]
  ): Promise<ApplyMatchRatingOutcome | 'match_changed'>;
  replacePlayerCurve(
    ...args: [...Parameters<typeof replacePlayerRatingCurve>, expectedMatches?: readonly RatingStreamMatch[]]
  ): ReturnType<typeof replacePlayerRatingCurve>;
}
