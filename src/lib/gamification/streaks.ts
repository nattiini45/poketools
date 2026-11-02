import { getCompletedMatchesForRatingReplay, loadRatingScope } from '@/lib/supabase/queries/ratings';
import {
  getPlayerStatTotalsByMatch,
  getPlayerStreaks,
  replacePlayerStreaks,
  StreaksStaleError,
  upsertPlayerStreaks,
} from '@/lib/supabase/queries/streaks';
import { compareReplayOrder, type ReplayOrderMatch } from '@/lib/rating/replay-order';
import { matchCountsForRatings, type RatingScope } from '@/lib/rating/rating-scope';
import type { MatchResult, MatchStats, StreakChanges, PlayerStreaks } from '@/types/streak';

/** A player's streak numbers: the row without its ids. */
export type StreakCounters = Omit<PlayerStreaks, 'id' | 'player_id'>;

/** A match extends the KO streak from this many kills dealt. */
const KO_STREAK_THRESHOLD = 3;

/** The write is fenced on the player's completed matches; one retry covers a match that completed during the replay. */
const REPLACE_ATTEMPTS = 2;

const EMPTY_COUNTERS: Readonly<StreakCounters> = {
  current_win_streak: 0,
  best_win_streak: 0,
  current_loss_streak: 0,
  best_loss_streak: 0,
  current_ko_streak: 0,
  best_ko_streak: 0,
  current_flawless_streak: 0,
  best_flawless_streak: 0,
  last_match_id: null,
};

function countersOf(row: PlayerStreaks | null): StreakCounters {
  if (!row) return { ...EMPTY_COUNTERS };
  return {
    current_win_streak: row.current_win_streak,
    best_win_streak: row.best_win_streak,
    current_loss_streak: row.current_loss_streak,
    best_loss_streak: row.best_loss_streak,
    current_ko_streak: row.current_ko_streak,
    best_ko_streak: row.best_ko_streak,
    current_flawless_streak: row.current_flawless_streak,
    best_flawless_streak: row.best_flawless_streak,
    last_match_id: row.last_match_id,
  };
}

/**
 * One match applied to a player's streaks. `stats` is null when the match has
 * no battle stats for the player (a result entered without a replay, or an
 * admin settle): their KO and flawless figures are then unknown, so those two
 * streaks stay as they are instead of being reset or extended on invented
 * zeros. The win and loss streaks move on the result alone.
 */
export function advanceStreaks(
  current: StreakCounters,
  result: MatchResult,
  stats: MatchStats | null,
  matchId: string
): StreakCounters {
  const win = result.won ? current.current_win_streak + 1 : result.lost || result.drew ? 0 : current.current_win_streak;
  const loss = result.lost ? current.current_loss_streak + 1 : result.won || result.drew ? 0 : current.current_loss_streak;
  const ko = stats === null
    ? current.current_ko_streak
    : stats.total_kos_dealt >= KO_STREAK_THRESHOLD ? current.current_ko_streak + 1 : 0;
  const flawless = stats === null
    ? current.current_flawless_streak
    : stats.total_kos_lost === 0 ? current.current_flawless_streak + 1 : 0;

  return {
    current_win_streak: win,
    best_win_streak: Math.max(current.best_win_streak, win),
    current_loss_streak: loss,
    best_loss_streak: Math.max(current.best_loss_streak, loss),
    current_ko_streak: ko,
    best_ko_streak: Math.max(current.best_ko_streak, ko),
    current_flawless_streak: flawless,
    best_flawless_streak: Math.max(current.best_flawless_streak, flawless),
    last_match_id: matchId,
  };
}

function describeChanges(before: StreakCounters, after: StreakCounters): StreakChanges {
  const newRecords: string[] = [];
  if (after.best_win_streak > before.best_win_streak) newRecords.push('win_streak');
  if (after.best_loss_streak > before.best_loss_streak) newRecords.push('loss_streak');
  if (after.best_ko_streak > before.best_ko_streak) newRecords.push('ko_streak');
  if (after.best_flawless_streak > before.best_flawless_streak) newRecords.push('flawless_streak');

  return {
    win_streak: { before: before.current_win_streak, after: after.current_win_streak },
    loss_streak: { before: before.current_loss_streak, after: after.current_loss_streak },
    ko_streak: { before: before.current_ko_streak, after: after.current_ko_streak },
    flawless_streak: { before: before.current_flawless_streak, after: after.current_flawless_streak },
    new_records: newRecords,
  };
}

/**
 * Applies one match to the stored streak row (read, advance, upsert).
 *
 * NOT replay-safe and not safe against a concurrent writer of the same
 * player: the live finalize and the reconcile paths rebuild through
 * `recomputeStreaks` instead. It stays for the gamification backfill, which
 * advances each player match by match so its achievement checks see the
 * chronological streak state, and then rebuilds every row with
 * `recomputeStreaks`.
 */
export async function updateStreaks(
  playerId: string,
  matchResult: MatchResult,
  matchStats: MatchStats | null,
  matchId: string
): Promise<StreakChanges> {
  const before = countersOf(await getPlayerStreaks(playerId));
  const after = advanceStreaks(before, matchResult, matchStats, matchId);
  await upsertPlayerStreaks(playerId, after);
  return describeChanges(before, after);
}

/** A completed match reduced to what the streak replay reads. */
export interface StreakHistoryMatch extends ReplayOrderMatch {
  tournament_id: string;
  winner_id: string | null;
}

/**
 * A player's streaks from their whole completed history, in the canonical
 * replay order (`compareReplayOrder`: the order the rating curve uses, so a
 * match's place in the streaks and in the ratings agrees).
 *
 * - A match of a test league does not count (`matchCountsForRatings`, the
 *   same rule as ratings).
 * - A draw (no winner) resets the win and the loss streak.
 * - A match with no entry in `statsByMatch` has unknown KO figures for this
 *   player (see `advanceStreaks`). The map is per player, so a match with
 *   stats for one side only leaves the other side's KO and flawless streaks
 *   untouched.
 * - `last_match_id` is the last counted match.
 *
 * Pure: the input list is not mutated and its order does not matter.
 */
export function computeStreaksFromHistory(
  playerId: string,
  matches: readonly StreakHistoryMatch[],
  statsByMatch: ReadonlyMap<string, MatchStats>,
  scope: RatingScope
): StreakCounters {
  const ordered = matches.filter((match) => matchCountsForRatings(match, scope)).sort(compareReplayOrder);

  let counters: StreakCounters = { ...EMPTY_COUNTERS };
  for (const match of ordered) {
    const drew = match.winner_id === null;
    const won = match.winner_id === playerId;
    counters = advanceStreaks(
      counters,
      { won, lost: !won && !drew, drew },
      statsByMatch.get(match.id) ?? null,
      match.id
    );
  }
  return counters;
}

/**
 * Rebuilds a player's streak row from their full history and replaces the
 * stored row in ONE fenced write (`streaks_replace_player`): there is no
 * zeroed row in between, and a match that completed after the replay read
 * the history makes the write refuse, so the replay reads again (once).
 * Replay-safe: the result depends on the history only, never on the stored
 * row, so a heal, a reconcile and a second run all land on the same values.
 * Grants no achievement and emits nothing.
 *
 * Returns the player's change (before and after the stored row) for the
 * announcements of a live finalize.
 */
export async function recomputeStreaks(playerId: string): Promise<StreakChanges> {
  for (let attempt = 1; ; attempt++) {
    // The history is read first and the stats are read for exactly its match ids: a match that completes in
    // between is then in neither or in both, and the fence below catches the first case.
    const [scope, history, stored] = await Promise.all([
      loadRatingScope(),
      getCompletedMatchesForRatingReplay(playerId),
      getPlayerStreaks(playerId),
    ]);
    const statTotals = await getPlayerStatTotalsByMatch(
      playerId,
      history.map((match) => match.id)
    );

    const after = computeStreaksFromHistory(playerId, history, statTotals, scope);
    try {
      await replacePlayerStreaks(playerId, after, history.map((match) => match.id));
    } catch (err) {
      if (err instanceof StreaksStaleError && attempt < REPLACE_ATTEMPTS) continue;
      throw err;
    }
    return describeChanges(countersOf(stored), after);
  }
}
