import { glicko2Update, inflateRD, type Glicko2Player } from '@/lib/rating/glicko2';
import { getMatchesByPlayer } from '@/lib/supabase/queries/matches';
import {
  deleteRatingHistoryByMatch,
  deleteRatingHistoryByPlayer,
  getPlayerRating,
  getRatingHistoryByMatch,
  getRatingHistoryByMatches,
  insertRatingHistory,
  insertRatingHistoryBatch,
  upsertPlayerRating,
  type RatingHistoryInsertInput,
} from '@/lib/supabase/queries/ratings';
import { GLICKO2_DEFAULTS, type PlayerRating } from '@/types/rating';

export interface MutableRatingState {
  rating: number;
  rd: number;
  volatility: number;
  peak_rating: number;
  peak_date: string | null;
  wins: number;
  losses: number;
  draws: number;
  last_match_at: string | null;
}

export interface RatingUpdateResult {
  winnerChange: number;
  loserChange: number;
  winnerRating: number;
  loserRating: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toMutableState(row: PlayerRating | null): MutableRatingState {
  if (!row) {
    return {
      rating: GLICKO2_DEFAULTS.INITIAL_RATING,
      rd: GLICKO2_DEFAULTS.INITIAL_RD,
      volatility: GLICKO2_DEFAULTS.INITIAL_VOLATILITY,
      peak_rating: GLICKO2_DEFAULTS.INITIAL_RATING,
      peak_date: null,
      wins: 0,
      losses: 0,
      draws: 0,
      last_match_at: null,
    };
  }

  return {
    rating: row.rating,
    rd: row.rd,
    volatility: row.volatility,
    peak_rating: row.peak_rating,
    peak_date: row.peak_date,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    last_match_at: row.last_match_at,
  };
}

function periodsSinceLastMatch(lastMatchAt: string | null, now: Date): number {
  if (!lastMatchAt) return 0;
  const last = new Date(lastMatchAt).getTime();
  if (Number.isNaN(last)) return 0;
  const diff = now.getTime() - last;
  if (diff <= 0) return 0;
  return Math.floor(diff / MS_PER_DAY);
}

export async function updateRatings(
  winnerId: string,
  loserId: string,
  isDraw: boolean,
  matchId: string
): Promise<RatingUpdateResult> {
  const existing = await getRatingHistoryByMatch(matchId);
  if (existing.length > 0) {
    const winnerEntry = existing.find((e) => e.player_id === winnerId);
    const loserEntry = existing.find((e) => e.player_id === loserId);
    if (!winnerEntry || !loserEntry) {
      throw new Error(`Incomplete rating history for match ${matchId}`);
    }
    const winnerChange = Number((winnerEntry.rating_after - winnerEntry.rating_before).toFixed(2));
    const loserChange = Number((loserEntry.rating_after - loserEntry.rating_before).toFixed(2));
    return {
      winnerChange,
      loserChange,
      winnerRating: winnerEntry.rating_after,
      loserRating: loserEntry.rating_after,
    };
  }

  const now = new Date();
  const nowIso = now.toISOString();

  const [winnerExisting, loserExisting] = await Promise.all([
    getPlayerRating(winnerId),
    getPlayerRating(loserId),
  ]);

  const winnerBase = toMutableState(winnerExisting);
  const loserBase = toMutableState(loserExisting);

  const winnerInflated = {
    ...winnerBase,
    rd: inflateRD(
      winnerBase.rd,
      winnerBase.volatility,
      periodsSinceLastMatch(winnerBase.last_match_at, now)
    ),
  };
  const loserInflated = {
    ...loserBase,
    rd: inflateRD(
      loserBase.rd,
      loserBase.volatility,
      periodsSinceLastMatch(loserBase.last_match_at, now)
    ),
  };

  const winnerScore = isDraw ? 0.5 : 1.0;
  const loserScore = isDraw ? 0.5 : 0.0;

  const winnerUpdated = glicko2Update(winnerInflated, loserInflated, winnerScore);
  const loserUpdated = glicko2Update(loserInflated, winnerInflated, loserScore);

  const winnerNext: MutableRatingState = {
    ...winnerBase,
    rating: winnerUpdated.rating,
    rd: winnerUpdated.rd,
    volatility: winnerUpdated.volatility,
    peak_rating: Math.max(winnerBase.peak_rating, winnerUpdated.rating),
    peak_date: winnerUpdated.rating > winnerBase.peak_rating ? nowIso : winnerBase.peak_date,
    wins: isDraw ? winnerBase.wins : winnerBase.wins + 1,
    losses: winnerBase.losses,
    draws: isDraw ? winnerBase.draws + 1 : winnerBase.draws,
    last_match_at: nowIso,
  };

  const loserNext: MutableRatingState = {
    ...loserBase,
    rating: loserUpdated.rating,
    rd: loserUpdated.rd,
    volatility: loserUpdated.volatility,
    peak_rating: Math.max(loserBase.peak_rating, loserUpdated.rating),
    peak_date: loserUpdated.rating > loserBase.peak_rating ? nowIso : loserBase.peak_date,
    wins: loserBase.wins,
    losses: isDraw ? loserBase.losses : loserBase.losses + 1,
    draws: isDraw ? loserBase.draws + 1 : loserBase.draws,
    last_match_at: nowIso,
  };

  await Promise.all([
    upsertPlayerRating(winnerId, { ...winnerNext, updated_at: nowIso }),
    upsertPlayerRating(loserId, { ...loserNext, updated_at: nowIso }),
  ]);

  await Promise.all([
    insertRatingHistory({
      player_id: winnerId,
      match_id: matchId,
      rating_before: winnerBase.rating,
      rating_after: winnerNext.rating,
      rd_before: winnerInflated.rd,
      rd_after: winnerNext.rd,
      opponent_id: loserId,
      opponent_rating: loserBase.rating,
      result: isDraw ? 'draw' : 'win',
    }),
    insertRatingHistory({
      player_id: loserId,
      match_id: matchId,
      rating_before: loserBase.rating,
      rating_after: loserNext.rating,
      rd_before: loserInflated.rd,
      rd_after: loserNext.rd,
      opponent_id: winnerId,
      opponent_rating: winnerBase.rating,
      result: isDraw ? 'draw' : 'loss',
    }),
  ]);

  const winnerChange = Number((winnerNext.rating - winnerBase.rating).toFixed(2));
  const loserChange = Number((loserNext.rating - loserBase.rating).toFixed(2));

  return {
    winnerChange,
    loserChange,
    winnerRating: winnerNext.rating,
    loserRating: loserNext.rating,
  };
}

export async function rollbackRatingsForMatch(matchId: string): Promise<string[]> {
  const history = await getRatingHistoryByMatch(matchId);
  if (history.length === 0) {
    return [];
  }

  const affectedPlayerIds = new Set<string>();

  for (const entry of history) {
    const current = await getPlayerRating(entry.player_id);
    if (!current) continue;

    affectedPlayerIds.add(entry.player_id);

    let wins = current.wins;
    let losses = current.losses;
    let draws = current.draws;

    if (entry.result === 'win') wins = Math.max(0, wins - 1);
    if (entry.result === 'loss') losses = Math.max(0, losses - 1);
    if (entry.result === 'draw') draws = Math.max(0, draws - 1);

    await upsertPlayerRating(entry.player_id, {
      rating: entry.rating_before,
      rd: entry.rd_before,
      volatility: current.volatility,
      peak_rating: current.peak_rating,
      peak_date: current.peak_date,
      wins,
      losses,
      draws,
      last_match_at: current.last_match_at,
    });
  }

  await deleteRatingHistoryByMatch(matchId);
  return Array.from(affectedPlayerIds);
}

// ─────────────────────────────────────────────────────────────────────
// Chronological ratings rebuild (spec §19/§20, Task T4)
//
// `rollbackRatingsForMatch` above is inverse-only: it restores a single
// match's `rating_before` for its two players. That is only correct for
// deleting the LAST match — removing an EARLIER match would discard every
// later match's effect from the global `player_ratings` row. The rebuild
// instead replays the player's completed matches in chronological order so
// the curve is correct after any match is removed.
// ─────────────────────────────────────────────────────────────────────

/**
 * A completed match reduced to the fields the rating curve needs.
 * `date_played` falls back to `created_at` exactly like `recomputeStreaks`.
 */
export interface CompletedMatchForRating {
  id: string;
  player_1_id: string;
  player_2_id: string;
  winner_id: string | null;
  date_played: string | null;
  created_at: string;
}

/** Frozen opponent state for a single match, taken from that match's
 * `rating_history` row for the opponent (rating_before / rd_before). */
export interface OpponentFrozenState {
  rating: number;
  rd: number;
}

export interface ComputeRatingCurveInput {
  playerId: string;
  /** Completed matches, already sorted chronologically (oldest first). */
  matches: CompletedMatchForRating[];
  /** Frozen opponent state keyed by match id. Falls back to GLICKO2_DEFAULTS
   * when a match is absent from the map (see fallback note below). */
  opponentStateByMatch: Map<string, OpponentFrozenState>;
}

export interface ComputedRatingCurve {
  finalState: MutableRatingState;
  history: RatingHistoryInsertInput[];
  matchesReplayed: number;
}

/** Returns the opponent id for a match from the given player's perspective,
 * or null if the player is not a participant (defensive — should not happen
 * for matches loaded via `getMatchesByPlayer`). */
function opponentIdForMatch(match: CompletedMatchForRating, playerId: string): string | null {
  if (match.player_1_id === playerId) return match.player_2_id;
  if (match.player_2_id === playerId) return match.player_1_id;
  return null;
}

/** Timestamp used for inflation/last_match_at, mirroring `recomputeStreaks`. */
function matchTimestamp(match: CompletedMatchForRating): string {
  return match.date_played ?? match.created_at;
}

/**
 * PURE rating-curve replay. Given already-loaded matches and per-match frozen
 * opponent states, returns the recomputed player state plus the history rows
 * that should be persisted. No DB access — fully unit-testable.
 *
 * Mirrors the `MutableRatingState` transitions in `updateRatings`: same
 * default start, same inflation via `inflateRD`/`periodsSinceLastMatch`, same
 * `glicko2Update` call, same peak/wins/losses/draws/last_match_at bookkeeping.
 *
 * Inflation uses the gap between consecutive match dates (NOT replay-time
 * `now`) so the rebuilt RD matches the original timeline.
 *
 * Opponent frozen state: `glicko2Update` uses the opponent's rating + rd but
 * NOT the opponent's volatility, so a player's curve can be replayed using
 * each opponent's frozen `(rating_before, rd_before)` from that match's
 * history row without rebuilding opponents. The opponent's volatility passed
 * to `glicko2Update` is `GLICKO2_DEFAULTS.INITIAL_VOLATILITY` (unused by the
 * player-side update).
 *
 * Fallback: if a match is missing from `opponentStateByMatch`, the opponent
 * state falls back to `GLICKO2_DEFAULTS` (initial rating / rd). This keeps the
 * replay robust when an opponent has no history row for a match (e.g. a brand
 * new opponent with no prior rating). The fallback is deterministic and
 * documented; callers that always supply frozen states never hit it.
 */
export function computeRatingCurveCore(input: ComputeRatingCurveInput): ComputedRatingCurve {
  const { playerId, matches, opponentStateByMatch } = input;

  const state: MutableRatingState = {
    rating: GLICKO2_DEFAULTS.INITIAL_RATING,
    rd: GLICKO2_DEFAULTS.INITIAL_RD,
    volatility: GLICKO2_DEFAULTS.INITIAL_VOLATILITY,
    peak_rating: GLICKO2_DEFAULTS.INITIAL_RATING,
    peak_date: null,
    wins: 0,
    losses: 0,
    draws: 0,
    last_match_at: null,
  };

  const history: RatingHistoryInsertInput[] = [];

  for (const match of matches) {
    const opponentId = opponentIdForMatch(match, playerId);
    if (opponentId === null) continue; // player not in this match; skip defensively

    const won = match.winner_id === playerId;
    const drew = match.winner_id === null;
    const score = won ? 1.0 : drew ? 0.5 : 0.0;

    const frozen = opponentStateByMatch.get(match.id);
    const opponent: Glicko2Player = frozen
      ? { rating: frozen.rating, rd: frozen.rd, volatility: GLICKO2_DEFAULTS.INITIAL_VOLATILITY }
      : {
          rating: GLICKO2_DEFAULTS.INITIAL_RATING,
          rd: GLICKO2_DEFAULTS.INITIAL_RD,
          volatility: GLICKO2_DEFAULTS.INITIAL_VOLATILITY,
        };

    const matchDate = new Date(matchTimestamp(match));
    const ratingBefore = state.rating;
    const rdBeforeInflated = inflateRD(
      state.rd,
      state.volatility,
      periodsSinceLastMatch(state.last_match_at, matchDate)
    );

    const playerInflated: Glicko2Player = {
      rating: state.rating,
      rd: rdBeforeInflated,
      volatility: state.volatility,
    };

    const updated = glicko2Update(playerInflated, opponent, score);

    const matchIso = matchDate.toISOString();

    state.rating = updated.rating;
    state.rd = updated.rd;
    state.volatility = updated.volatility;
    const previousPeak = state.peak_rating;
    state.peak_rating = Math.max(previousPeak, updated.rating);
    state.peak_date = updated.rating > previousPeak ? matchIso : state.peak_date;
    if (won) state.wins += 1;
    else if (drew) state.draws += 1;
    else state.losses += 1;
    state.last_match_at = matchIso;

    history.push({
      player_id: playerId,
      match_id: match.id,
      rating_before: ratingBefore,
      rating_after: updated.rating,
      rd_before: rdBeforeInflated,
      rd_after: updated.rd,
      opponent_id: opponentId,
      opponent_rating: opponent.rating,
      result: won ? 'win' : drew ? 'draw' : 'loss',
    });
  }

  return { finalState: state, history, matchesReplayed: matches.length };
}

export interface RebuildRatingsResult {
  matchesReplayed: number;
  ratingBefore: number;
  ratingAfter: number;
}

/** Result of loading + computing a player's rating curve WITHOUT writing. */
export interface LoadedRatingCurve {
  /** The recomputed curve (final state + history rows to persist). */
  computed: ComputedRatingCurve;
  /** The currently-stored `player_ratings` row, or null if the player has none. */
  stored: PlayerRating | null;
  /** Number of completed matches replayed (== computed.matchesReplayed). */
  matchesReplayed: number;
}

/**
 * Load a player's completed matches + opponents' frozen rating states, then
 * recompute the rating curve from those sources via `computeRatingCurveCore`.
 * Also fetches the stored `player_ratings` row so callers can diff it against
 * the computed curve. PURE READS — performs NO writes.
 *
 * This is the compute-only half of `rebuildRatingsForPlayer`; the repair path
 * calls this then performs the writes, so the load logic is shared (no
 * duplication). Used by the season reconcile orchestrator (spec §22) to report
 * rating mismatches without mutating.
 *
 * Opponent frozen states are batch-fetched: a single `rating_history` query for
 * all of the player's match ids selects, per match, the opponent's row
 * (`player_id === opponentId`) to read its `rating_before`/`rd_before`. Matches
 * missing an opponent row fall back to `GLICKO2_DEFAULTS` inside the core.
 */
export async function loadAndComputeRatingCurve(
  playerId: string
): Promise<LoadedRatingCurve> {
  const completedMatches: CompletedMatchForRating[] = (await getMatchesByPlayer(playerId))
    .filter((m) => m.status === 'completed')
    .sort((a, b) => {
      const aTime = new Date(a.date_played ?? a.created_at).getTime();
      const bTime = new Date(b.date_played ?? b.created_at).getTime();
      return aTime - bTime;
    })
    .map((m): CompletedMatchForRating => ({
      id: m.id,
      player_1_id: m.player_1_id,
      player_2_id: m.player_2_id,
      winner_id: m.winner_id,
      date_played: m.date_played,
      created_at: m.created_at,
    }));

  // Batch-fetch every history row for these matches; pick the opponent's row
  // (player_id === opponentId) per match to read its frozen rating_before/rd_before.
  const matchIds = completedMatches.map((m) => m.id);
  const historyRows = await getRatingHistoryByMatches(matchIds);

  const opponentStateByMatch = new Map<string, OpponentFrozenState>();
  for (const match of completedMatches) {
    const opponentId = opponentIdForMatch(match, playerId);
    if (opponentId === null) continue;
    const opponentRow = historyRows.find(
      (row) => row.match_id === match.id && row.player_id === opponentId
    );
    if (opponentRow) {
      opponentStateByMatch.set(match.id, {
        rating: opponentRow.rating_before,
        rd: opponentRow.rd_before,
      });
    }
    // If no opponent history row exists for this match, the map entry is simply
    // absent and `computeRatingCurveCore` falls back to GLICKO2_DEFAULTS.
  }

  const [computed, stored] = await Promise.all([
    Promise.resolve(
      computeRatingCurveCore({ playerId, matches: completedMatches, opponentStateByMatch })
    ),
    getPlayerRating(playerId),
  ]);

  return { computed, stored, matchesReplayed: computed.matchesReplayed };
}

/**
 * Rebuilds one player's rating curve from scratch by replaying their completed
 * matches chronologically, then persisting the result.
 *
 * Delegates the load+compute to `loadAndComputeRatingCurve` so the read path is
 * shared with the reconcile orchestrator's diff path (no duplication).
 *
 * WRITES (sequential best-effort, NOT wrapped in one transaction — consistent
 * with `updateRatings`/`rollbackRatingsForMatch`): upsert the recomputed
 * `player_ratings` row, delete THIS player's `rating_history` rows, then
 * batch-insert the rebuilt history rows. Opponents' history and ratings are
 * never touched — we only read their frozen states.
 */
export async function rebuildRatingsForPlayer(playerId: string): Promise<RebuildRatingsResult> {
  const { computed } = await loadAndComputeRatingCurve(playerId);
  const { finalState, history } = computed;

  // Sequential best-effort writes — not one transaction (consistent with the
  // existing updateRatings/rollbackRatingsForMatch multi-table writes).
  const updatedAt = new Date().toISOString();
  await upsertPlayerRating(playerId, { ...finalState, updated_at: updatedAt });
  await deleteRatingHistoryByPlayer(playerId);
  if (history.length > 0) {
    await insertRatingHistoryBatch(history);
  }

  const ratingBefore = history.length > 0 ? history[0].rating_before : GLICKO2_DEFAULTS.INITIAL_RATING;

  return {
    matchesReplayed: computed.matchesReplayed,
    ratingBefore,
    ratingAfter: finalState.rating,
  };
}

/**
 * Rebuilds the rating curves for multiple players, STRICTLY SEQUENTIALLY.
 *
 * A player's rebuild reads the OTHER players' rating_history rows (their
 * frozen pre-match states) while deleting and reinserting the player's own
 * rows. Parallel rebuilds of mutual opponents therefore race: a rebuild can
 * read an opponent's rows mid-delete, find none, and silently fall back to
 * GLICKO2_DEFAULTS — persisting corrupted curves for both players (observed
 * 2026-08-14: a chunk-parallel reconcile repair grew rating mismatches
 * 48 → 55). Sequential execution removes the interleaving; with a stable
 * history each rebuild reproduces the same frozen values it read, so one
 * pass is correct.
 */
export async function rebuildRatingsForPlayers(
  playerIds: string[]
): Promise<RebuildRatingsResult[]> {
  const results: RebuildRatingsResult[] = [];

  for (const playerId of playerIds) {
    results.push(await rebuildRatingsForPlayer(playerId));
  }

  return results;
}
