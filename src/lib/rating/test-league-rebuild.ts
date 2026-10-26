/**
 * Rating rebuild after a league's test-league flag is set (test leagues stay
 * out of ratings, see rating-scope.ts). The
 * seasons PATCH route runs it for every request that sends the flag, changed
 * or not, so sending it again finishes a rebuild that was cut off.
 *
 * The rating rule follows the CURRENT flag, so flipping it changes which
 * matches a replay counts:
 *   - flag ON: the league's completed matches leave every rebuild; the
 *     players' stored curves still contain them until rebuilt;
 *   - flag OFF: the matches count again, but no rating_history row exists for
 *     them (the live path skipped them), so the replay meets them as never
 *     rated.
 * Rebuilding the players of the league's completed matches replays them
 * under the new flag. The rebuild's own gap healing may add further players
 * (`rebuildRatingsForPlayers`).
 *
 * One pass does not settle the league's players among themselves. A rebuild
 * writes its players one after another, and each replay reads the opponent's
 * STORED pre-match state (`rating_before`), so a player written before an
 * opponent replays against the opponent's old state:
 *   - flag OFF: a never-rated league match has no row for the opponent yet,
 *     so the first replay meets the default opponent;
 *   - either flag: two league players who also met in a counted match replay
 *     it against each other's pre-change state.
 * A second pass is not always enough either: a pass that moves one player's
 * states leaves every player written before it with a replay against the
 * states it overwrote (two players with three counted matches between them
 * still move in a third pass). So the passes repeat over every player
 * rewritten so far while the last one changed any player
 * (`RebuildRatingsResult.changed`: the stored ratings or any of the player's
 * history rows moved). A pass that changes nothing replayed every player
 * against the states the pass before it wrote, so the players are settled. Up
 * to `MAX_PASSES` passes may still change something, plus the pass that
 * confirms it; a run still changing after that reports `settled: false` (the
 * route answers it as `rebuild_warning`, and the reconcile repair, repeated,
 * finishes it).
 *
 * Opponents outside the league are not rebuilt: their curves keep the league
 * players' old frozen states until a later rebuild reaches them (the one-pass
 * limit every rebuild has).
 *
 * Every pass is queued on the in-process rating lock and writes each player
 * in one SQL transaction. A failure stops the run and is thrown unchanged
 * (the route reports it as `rebuild_warning`). Whatever happened, the rating
 * reads of the league's players are expired: a failed run may already have
 * rewritten some of them.
 *
 * The pass loop is `rebuildRatingsSettled`; the rebuild after a league is
 * restored from the trash (`rebuildAfterSeasonRestore`) runs the same loop over
 * the restored league's players.
 */
import { listSeasonCompletedMatchPlayerIds } from '@/lib/supabase/queries/ratings';
import { rebuildRatingsForPlayers, type RebuildRatingsResult } from '@/lib/rating/updateRatings';
import { expireRatingReads } from '@/lib/revalidation';

/** The most passes of one flag rebuild that may still change a player. One
 * more pass confirms the last of them; a run still changing then reports
 * `settled: false`. */
export const MAX_PASSES = 8;

export interface TestFlagRatingRebuildSummary {
  seasonId: string;
  /** The flag value the ratings were rebuilt for. */
  isTestSeason: boolean;
  /** Players of the league's completed matches (the rebuild's request). */
  playerIds: string[];
  /** Every player whose curve was rewritten (gap-healing additions included). */
  rebuiltPlayerIds: string[];
  /** Passes run: 0 when the league has no completed match, otherwise 1 to `MAX_PASSES` + 1. */
  passes: number;
  /** True when the last pass changed no player (or there was nothing to rebuild);
   * false when the cap was reached while a pass still changed something. */
  settled: boolean;
  /** Matches the first pass found without rating history (the league's matches after the flag went OFF). */
  unratedMatches: number;
}

function unratedMatchCount(results: readonly RebuildRatingsResult[]): number {
  return new Set(results.flatMap((result) => result.unratedMatchIds)).size;
}

/** What `rebuildRatingsSettled` did. */
export interface SettledRatingRebuild {
  /** Every player whose curve was rewritten (gap-healing additions included). */
  rebuiltPlayerIds: string[];
  /** Passes run: 0 for an empty request, otherwise 1 to `MAX_PASSES` + 1. */
  passes: number;
  /** True when the last pass changed no player (or there was nothing to rebuild); false at the pass cap. */
  settled: boolean;
  /** Matches the first pass found without rating history. */
  unratedMatches: number;
}

/**
 * Rebuilds the ratings of `playerIds` in passes until a pass changes nothing (see the module comment for why one pass
 * does not settle players among themselves). Used after a test-league flag change and after a league is restored from
 * the trash. A failure stops the run and is thrown unchanged. Whatever happened, the rating reads of the requested
 * players and of every player rewritten so far are expired: a failed run may already have rewritten some of them.
 */
export async function rebuildRatingsSettled(playerIds: readonly string[]): Promise<SettledRatingRebuild> {
  if (playerIds.length === 0) return { rebuiltPlayerIds: [], passes: 0, settled: true, unratedMatches: 0 };

  const rebuilt = new Set<string>();
  try {
    const first = await rebuildRatingsForPlayers([...playerIds]);
    for (const result of first) rebuilt.add(result.playerId);
    const unratedMatches = unratedMatchCount(first);
    let passes = 1;
    let changed = first.some((result) => result.changed);

    // Each further pass replays every player rewritten so far (gap-healing
    // additions of any pass included) against the states the last pass wrote.
    // A run that reaches the fixed point on its MAX_PASSES-th pass still gets
    // the pass that confirms it.
    while (changed && passes <= MAX_PASSES) {
      const pass = await rebuildRatingsForPlayers([...rebuilt]);
      for (const result of pass) rebuilt.add(result.playerId);
      passes += 1;
      changed = pass.some((result) => result.changed);
    }
    return { rebuiltPlayerIds: [...rebuilt], passes, settled: !changed, unratedMatches };
  } finally {
    expireRatingReads([...new Set([...playerIds, ...rebuilt])]);
  }
}

export async function rebuildRatingsAfterTestFlagChange(
  seasonId: string,
  isTestSeason: boolean
): Promise<TestFlagRatingRebuildSummary> {
  const playerIds = await listSeasonCompletedMatchPlayerIds(seasonId);
  const rebuilt = await rebuildRatingsSettled(playerIds);
  return { seasonId, isTestSeason, playerIds, ...rebuilt };
}
