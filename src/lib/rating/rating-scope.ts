/**
 * Which completed matches count toward player ratings (owner decision
 * 2026-10-19): every completed match EXCEPT one whose tournament belongs to a
 * test league (`seasons.is_test_season`). Standalone tournaments (no season)
 * and normal leagues count. Test ACCOUNTS are not part of this rule (the
 * leaderboard leaves them out on read, see `getLeaderboard`).
 *
 * This is the one TypeScript predicate; the database mirrors it in
 * `public.match_in_test_season(match_id)`
 * (supabase/migrations/20261019130000_ratings_skip_test_seasons.sql), which
 * makes `rating_apply_match_result` skip such a match and
 * `rating_replace_player_history` refuse its history rows, so no caller can
 * bypass the rule. Every rating writer selects matches through it: the live
 * update (`updateRatings`), the chronological rebuild and its gap healing
 * (`loadAndComputeRatingCurve`), the reconcile replay and the finalize heal.
 *
 * The rule follows the CURRENT flag (unlike `games.exclude_all_time`, frozen
 * per game): setting the flag rebuilds the league's players
 * (`rebuildRatingsAfterTestFlagChange`), repeating the pass until one changes
 * nothing (at most 8 passes), so they settle among themselves under the
 * matches this predicate admits; a run that hits the cap says so. Opponents
 * outside the league keep curves built against the league players' old states
 * until a later rebuild reaches them.
 */

/** The tournaments whose matches stay out of ratings, read once per rating run. */
export interface RatingScope {
  /** Ids of the tournaments (league phases) that belong to a test league. */
  readonly testSeasonTournamentIds: ReadonlySet<string>;
}

export function createRatingScope(testSeasonTournamentIds: Iterable<string>): RatingScope {
  return { testSeasonTournamentIds: new Set(testSeasonTournamentIds) };
}

/** True when the match counts toward player ratings (its tournament is not part of a test league). */
export function matchCountsForRatings(
  match: { readonly tournament_id: string },
  scope: RatingScope
): boolean {
  return !scope.testSeasonTournamentIds.has(match.tournament_id);
}
