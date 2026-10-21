import { UserFacingError } from '@/lib/api/user-facing-error';
import { glicko2Update, inflateRD, type Glicko2Player } from '@/lib/rating/glicko2';
import { compareReplayOrder } from '@/lib/rating/replay-order';
import { matchCountsForRatings, type RatingScope } from '@/lib/rating/rating-scope';
import {
  applyMatchRatingResult,
  getCompletedMatchesForRatingReplay,
  getMatchTournamentIdForRating,
  getPlayerRating,
  getRatingHistoryByMatch,
  getRatingHistoryByMatches,
  loadRatingScope,
  RatingCurveStaleError,
  replacePlayerRatingCurve,
  toExpectedRatingState,
  type RatingHistoryInsertInput,
} from '@/lib/supabase/queries/ratings';
import { getPlayersByIds } from '@/lib/supabase/queries/players';
import { GLICKO2_DEFAULTS, type PlayerRating, type RatingHistoryEntry } from '@/types/rating';

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

/**
 * What the live update did with one match: `rated` carries the rating change
 * (applied now, or read back from the stored history rows); a match of a
 * test league (`seasons.is_test_season`) is `skipped_test_season` and wrote
 * nothing, so it has no change to announce (src/lib/rating/rating-scope.ts).
 */
export type RatingUpdateOutcome =
  | ({ status: 'rated' } & RatingUpdateResult)
  | { status: 'skipped_test_season' };

const SKIPPED_TEST_SEASON: RatingUpdateOutcome = { status: 'skipped_test_season' };

function rated(result: RatingUpdateResult): RatingUpdateOutcome {
  return { status: 'rated', ...result };
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

/** Attempts of the live update when another writer changes a player between
 * the read and the write (`rating_apply_match_result` answers 'stale'). */
const LIVE_APPLY_ATTEMPTS = 3;

/**
 * Waits before each re-read of a match whose history is one-sided (one
 * player's row exists, the other's does not). A chronological rebuild in
 * another process writes each player's curve in its own transaction, so
 * between two of its writes a match it replays has only one row; the
 * rebuild writes the other row moments later. The live path waits for it
 * instead of failing the finalize step.
 */
const ONE_SIDED_HISTORY_WAITS_MS: readonly number[] = [250, 750, 1500];

function isOneSidedHistory(
  existing: readonly RatingHistoryEntry[],
  winnerId: string,
  loserId: string
): boolean {
  if (existing.length === 0) return false;
  const hasWinner = existing.some((e) => e.player_id === winnerId);
  const hasLoser = existing.some((e) => e.player_id === loserId);
  return !(hasWinner && hasLoser);
}

/**
 * The match's history rows, re-read (with the waits above) while they are
 * one-sided. Returns the last read: none, both, or still one-sided after the
 * last wait (the caller then throws, and the finalize heal verifies the rows
 * on a later cron run).
 */
async function readSettledMatchHistory(
  matchId: string,
  winnerId: string,
  loserId: string
): Promise<RatingHistoryEntry[]> {
  let existing = await getRatingHistoryByMatch(matchId);
  for (const waitMs of ONE_SIDED_HISTORY_WAITS_MS) {
    if (!isOneSidedHistory(existing, winnerId, loserId)) return existing;
    console.warn(
      `[rating/live] match ${matchId}: one-sided rating history (a rebuild in another process is writing it?); re-reading in ${waitMs} ms`
    );
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    existing = await getRatingHistoryByMatch(matchId);
  }
  return existing;
}

/** The rating change a match's stored history rows record (idempotent replay). */
function resultFromHistory(
  existing: readonly RatingHistoryEntry[],
  winnerId: string,
  loserId: string,
  matchId: string
): RatingUpdateResult {
  const winnerEntry = existing.find((e) => e.player_id === winnerId);
  const loserEntry = existing.find((e) => e.player_id === loserId);
  if (!winnerEntry || !loserEntry) {
    throw new Error(`Incomplete rating history for match ${matchId}`);
  }
  return {
    winnerChange: Number((winnerEntry.rating_after - winnerEntry.rating_before).toFixed(2)),
    loserChange: Number((loserEntry.rating_after - loserEntry.rating_before).toFixed(2)),
    winnerRating: winnerEntry.rating_after,
    loserRating: loserEntry.rating_after,
  };
}

/**
 * Applies one completed match to both players' ratings (the live path, run by
 * match finalize and the gamification backfill). Idempotent: a match whose
 * two history rows exist returns the stored change and writes nothing.
 *
 * A match of a test league stays out of ratings: it resolves to
 * `skipped_test_season` with nothing written, checked here against the
 * current flag (`matchCountsForRatings`) before any computation, and again by
 * the RPC under its locks (`public.match_in_test_season`), so a flag set
 * between the two still writes nothing.
 *
 * The Glicko-2 step is computed here from the players' stored rows; the write
 * is ONE SQL transaction (`applyMatchRatingResult` → `rating_apply_match_result`):
 * both ratings and both history rows commit
 * together or not at all, under the per-player advisory locks the
 * chronological rebuild takes too, and fenced on the stored values this
 * computation read. A concurrent finalize sharing a player, or a rebuild that
 * rewrote a player in between, makes the RPC answer 'stale' with nothing
 * written; the update then re-reads and recomputes (up to
 * `LIVE_APPLY_ATTEMPTS` times) instead of overwriting the other write.
 *
 * In this process the update also queues on the rebuild lock, so it never
 * interleaves with an in-flight rebuild's reads (docs/rating.md).
 */
export function updateRatings(
  winnerId: string,
  loserId: string,
  isDraw: boolean,
  matchId: string
): Promise<RatingUpdateOutcome> {
  return withRebuildLock(() => applyLiveRatingUpdate(winnerId, loserId, isDraw, matchId));
}

async function applyLiveRatingUpdate(
  winnerId: string,
  loserId: string,
  isDraw: boolean,
  matchId: string
): Promise<RatingUpdateOutcome> {
  // Test leagues stay out of ratings: checked before the history read, so
  // rows left from before the rule are not reported as this match's change.
  const [scope, tournamentId] = await Promise.all([
    loadRatingScope(),
    getMatchTournamentIdForRating(matchId),
  ]);
  if (tournamentId === null) {
    throw new Error(`Match ${matchId} not found; its ratings were not applied`);
  }
  if (!matchCountsForRatings({ tournament_id: tournamentId }, scope)) {
    console.info(`[rating/live] match ${matchId} belongs to a test league; ratings not applied`);
    return SKIPPED_TEST_SEASON;
  }

  for (let attempt = 1; attempt <= LIVE_APPLY_ATTEMPTS; attempt += 1) {
    // A one-sided history (a rebuild elsewhere between its two players'
    // writes) is waited for, then read as the rebuild's result.
    const existing = await readSettledMatchHistory(matchId, winnerId, loserId);
    if (existing.length > 0) {
      return rated(resultFromHistory(existing, winnerId, loserId, matchId));
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

    const outcome = await applyMatchRatingResult(matchId, [
      {
        playerId: winnerId,
        expected: toExpectedRatingState(winnerExisting),
        state: { ...winnerNext, updated_at: nowIso },
        history: {
          rating_before: winnerBase.rating,
          rating_after: winnerNext.rating,
          rd_before: winnerInflated.rd,
          rd_after: winnerNext.rd,
          opponent_id: loserId,
          opponent_rating: loserBase.rating,
          result: isDraw ? 'draw' : 'win',
        },
      },
      {
        playerId: loserId,
        expected: toExpectedRatingState(loserExisting),
        state: { ...loserNext, updated_at: nowIso },
        history: {
          rating_before: loserBase.rating,
          rating_after: loserNext.rating,
          rd_before: loserInflated.rd,
          rd_after: loserNext.rd,
          opponent_id: winnerId,
          opponent_rating: winnerBase.rating,
          result: isDraw ? 'draw' : 'loss',
        },
      },
    ]);

    switch (outcome) {
      case 'applied':
        return rated({
          winnerChange: Number((winnerNext.rating - winnerBase.rating).toFixed(2)),
          loserChange: Number((loserNext.rating - loserBase.rating).toFixed(2)),
          winnerRating: winnerNext.rating,
          loserRating: loserNext.rating,
        });
      case 'already_applied':
        // A concurrent finalize of the same match won: report its change.
        return rated(resultFromHistory(await getRatingHistoryByMatch(matchId), winnerId, loserId, matchId));
      case 'stale':
        console.warn(
          `[rating/live] match ${matchId}: a player's rating changed between read and write (attempt ${attempt} of ${LIVE_APPLY_ATTEMPTS}); recomputing`
        );
        continue;
      case 'history_incomplete':
        // A rebuild elsewhere wrote one player's row after this read: wait
        // for its other row and report the rebuild's result (throws when it
        // stays one-sided).
        return rated(resultFromHistory(
          await readSettledMatchHistory(matchId, winnerId, loserId), winnerId, loserId, matchId
        ));
      case 'match_missing':
        throw new Error(`Match ${matchId} not found; its ratings were not applied`);
      case 'match_not_completed':
        throw new Error(`Match ${matchId} is no longer completed; its ratings were not applied`);
      case 'skipped_test_season':
        // The league became a test league after the check above.
        console.info(`[rating/live] match ${matchId} belongs to a test league (flag set meanwhile); ratings not applied`);
        return SKIPPED_TEST_SEASON;
    }
  }
  throw new Error(
    `Ratings for match ${matchId} were not applied: the players' ratings kept changing during ${LIVE_APPLY_ATTEMPTS} attempts`
  );
}

// ─────────────────────────────────────────────────────────────────────
// Chronological ratings rebuild
//
// Removing a match cannot be undone by restoring that match's
// `rating_before` (correct only for the player's LAST match: an EARLIER one
// would discard every later match's effect from the global `player_ratings`
// row). The rebuild instead replays the player's completed matches in
// chronological order so the curve is correct after any match is removed.
//
// Safety:
//   * One player's curve is written by ONE SQL call
//     (`replacePlayerRatingCurve` → `rating_replace_player_history`): the
//     player_ratings upsert, the history delete and the history insert commit
//     or roll back together, so no reader ever sees the player without rows.
//   * Rebuilds in this process run one at a time (`withRebuildLock`), so two
//     requests can never interleave reads of an opponent's rows with that
//     opponent's rewrite.
//   * The replay refuses to write over a history with gaps (a match where the
//     player has a row but the opponent has none): the opponent's frozen state
//     is unknown, and the old silent fallback to the initial rating spread a
//     partial failure to every opponent and every rerun. Instead the batch is
//     planned before its first write: the player with the missing row is
//     rebuilt first (which writes that row), and only a gap cycle, which no
//     order can fill, is refused with nothing written.
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
  /** Matches replayed against the GLICKO2_DEFAULTS opponent because
   * `opponentStateByMatch` had no entry for them, in replay order. */
  fallbackMatchIds: string[];
}

/** A completed match whose `rating_history` holds the loaded player's row but
 * not the opponent's: the opponent's frozen state at that match is unknown. */
export interface RatingHistoryGap {
  matchId: string;
  /** The player whose curve was being loaded (their row exists). */
  playerId: string;
  /** The opponent whose row is missing. Rebuilding this player first fills
   * the gap: their replay reads `playerId`'s row for the match and writes
   * their own. `rebuildRatingsForPlayers` orders the batch that way. */
  missingPlayerId: string;
}

/** What the loader found in `rating_history` for the player's completed matches. */
export interface RatingCurveIntegrity {
  /** Opponent row missing while the player's own row exists. */
  gaps: RatingHistoryGap[];
  /** Completed matches with no history row for either player (never rated, e.g.
   * finalization stopped before the rating step). Replayed against the
   * GLICKO2_DEFAULTS opponent and reported, never hidden. */
  unratedMatchIds: string[];
  /** The opponents of `unratedMatchIds` (unique, replay order). A rebuild
   * writes both players of such a match, so neither is left one-sided. */
  unratedOpponentIds: string[];
}

/**
 * Raised when the history gaps of a rebuild cannot be healed by ordering the
 * batch: two or more players each miss the row the other one's replay needs
 * (a cycle), so no write order fills every gap. Nothing is written. Raised
 * again as a backstop when a gap appears mid-batch (a writer in another
 * process). `players` names the involved players by display name.
 */
export class RatingHistoryIntegrityError extends UserFacingError<'rating_history_incomplete'> {
  readonly gaps: readonly RatingHistoryGap[];

  constructor(gaps: readonly RatingHistoryGap[], playerNames: ReadonlyMap<string, string> = new Map()) {
    const count = new Set(gaps.map((gap) => gap.matchId)).size;
    const ids = new Set<string>();
    for (const gap of gaps) {
      ids.add(gap.playerId);
      ids.add(gap.missingPlayerId);
    }
    const players = [...ids]
      .map((id) => playerNames.get(id) ?? id)
      .sort((a, b) => a.localeCompare(b))
      .join(', ');
    super(
      `Rating history has gaps that no rebuild order can fill for ${count} completed ${count === 1 ? 'match' : 'matches'} (players: ${players}). Those players were not rebuilt; a developer must restore the missing rating history rows.`,
      { code: 'rating_history_incomplete', params: { count, players }, status: 409 }
    );
    this.name = 'RatingHistoryIntegrityError';
    this.gaps = gaps;
  }
}

/**
 * The rebuild plan refused to grow past `MAX_PLANNED_PLAYERS` while pulling in
 * the players that history gaps depend on. Nothing was written. HTTP 409.
 * Like the gap-cycle refusal, it is a property of the stored history, so the
 * reconcile dry run reports it in `integrity.repairRefusal` (the repair would
 * answer with it) instead of failing.
 */
export class RatingRebuildPlanTooLargeError extends UserFacingError<'rating_rebuild_plan_too_large'> {
  constructor(limit: number) {
    super(
      `Rebuilding these ratings would pull in more than ${limit} players to heal rating history gaps, so nothing was rebuilt. A developer must inspect the rating history before rebuilding.`,
      { code: 'rating_rebuild_plan_too_large', params: { limit }, status: 409 }
    );
    this.name = 'RatingRebuildPlanTooLargeError';
  }
}

/**
 * Builds the integrity error with the involved players' display names. A
 * failed name lookup is logged and the ids are shown instead, so the refusal
 * (the primary cause) is never replaced by the lookup error.
 */
async function integrityError(gaps: readonly RatingHistoryGap[]): Promise<RatingHistoryIntegrityError> {
  const ids = [...new Set(gaps.flatMap((gap) => [gap.playerId, gap.missingPlayerId]))];
  const names = new Map<string, string>();
  try {
    const players = await getPlayersByIds(ids);
    for (const [id, player] of players) names.set(id, player.name);
  } catch (lookupError) {
    console.error('[rating/rebuild] player name lookup for the integrity refusal failed:', lookupError);
  }
  return new RatingHistoryIntegrityError(gaps, names);
}

/** Returns the opponent id for a match from the given player's perspective,
 * or null if the player is not a participant (defensive — should not happen
 * for matches loaded for that player). */
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
 * `now`) so the rebuilt RD matches the original timeline. Each history row is
 * stamped with its match timestamp (`recorded_at`) so the rebuilt history
 * keeps its chronological order.
 *
 * Opponent frozen state: `glicko2Update` uses the opponent's rating + rd but
 * NOT the opponent's volatility, so a player's curve can be replayed using
 * each opponent's frozen `(rating_before, rd_before)` from that match's
 * history row without rebuilding opponents. The opponent's volatility passed
 * to `glicko2Update` is `GLICKO2_DEFAULTS.INITIAL_VOLATILITY` (unused by the
 * player-side update).
 *
 * Fallback: a match absent from `opponentStateByMatch` is replayed against the
 * GLICKO2_DEFAULTS opponent and listed in `fallbackMatchIds`. The live path
 * writes both players' rows for every rated match, so an absent entry means
 * the match was never rated or a row was lost. `loadAndComputeRatingCurve`
 * tells those apart; the rebuild never writes a curve over a lost row (it
 * rebuilds the player with the missing row first, see "Batch planning").
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
  const fallbackMatchIds: string[] = [];

  for (const match of matches) {
    const opponentId = opponentIdForMatch(match, playerId);
    if (opponentId === null) continue; // player not in this match; skip defensively

    const won = match.winner_id === playerId;
    const drew = match.winner_id === null;
    const score = won ? 1.0 : drew ? 0.5 : 0.0;

    const frozen = opponentStateByMatch.get(match.id);
    if (!frozen) fallbackMatchIds.push(match.id);
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
      recorded_at: matchIso,
    });
  }

  return { finalState: state, history, matchesReplayed: matches.length, fallbackMatchIds };
}

export interface RebuildRatingsResult {
  playerId: string;
  /** True when the player was not requested but added to the batch: the
   * missing side of a history gap, or the opponent of a never-rated match. */
  addedToBatch: boolean;
  matchesReplayed: number;
  ratingBefore: number;
  ratingAfter: number;
  /** Completed matches no history row existed for (never rated); replayed
   * against the default opponent. Empty on a healthy history. */
  unratedMatchIds: string[];
  /** True when the write changed what other replays read: the player had no
   * `player_ratings` row, the stored rating / rd / volatility (compared at the
   * columns' scale) or wins / losses / draws differ from the written state, the
   * player's number of history rows among the replayed matches changed, or one
   * of those rows changed its rating or rd before or after the match (the
   * values an opponent's replay reads). `ratingBefore` is the curve's start,
   * so it cannot tell this. */
  changed: boolean;
}

/** Result of loading + computing a player's rating curve WITHOUT writing. */
export interface LoadedRatingCurve {
  /** The recomputed curve (final state + history rows to persist). */
  computed: ComputedRatingCurve;
  /** The currently-stored `player_ratings` row, or null if the player has none. */
  stored: PlayerRating | null;
  /** Number of completed matches replayed (== computed.matchesReplayed). */
  matchesReplayed: number;
  /** Gaps and never-rated matches found in the history the replay read. */
  integrity: RatingCurveIntegrity;
  /** Matches the player's OWN history rows the replay read belong to: the
   * write's fence (`replacePlayerRatingCurve`). */
  ownHistoryMatchIds: string[];
  /** Those own rows themselves. The rebuild compares them with the rows it
   * writes (`RebuildRatingsResult.changed`): opponents' replays read them.
   * Absent (older callers, test fixtures): only the row count is compared. */
  ownHistory?: readonly RatingHistoryEntry[];
}

export interface LoadRatingCurveOptions {
  /** Completed matches to leave out of the replay, as if they were not
   * completed: the preflight before a match reset uses this for the matches
   * being reset, which are still completed when the preflight runs. */
  excludeMatchIds?: readonly string[];
  /** The rating scope to replay against (test-league matches are left out).
   * Read once per rebuild batch and passed down; read here when omitted. */
  scope?: RatingScope;
}

/**
 * Load a player's completed matches + opponents' frozen rating states, then
 * recompute the rating curve from those sources via `computeRatingCurveCore`.
 * Also fetches the stored `player_ratings` row so callers can diff it against
 * the computed curve. PURE READS — performs NO writes.
 *
 * This is the compute-only half of the rebuild; the repair path calls this
 * then performs the writes, so the load logic is shared (no duplication). Used
 * by the season reconcile orchestrator to report rating mismatches without
 * mutating.
 *
 * Every completed match is read (paged, `getCompletedMatchesForRatingReplay`)
 * and the ones that count toward ratings are kept (`matchCountsForRatings`:
 * test-league matches stay out, so the replay reproduces exactly what the
 * live path writes); the history rows of those are batch-fetched (chunked and
 * paged). The player's own rows of left-out matches are not read: the write
 * deletes them, and its fence ignores them.
 * Per match: the opponent's row gives the frozen state; an own row without an
 * opponent row is a gap (`integrity.gaps`); no row at all is a never-rated
 * match (`integrity.unratedMatchIds`). Both missing-row cases replay against
 * GLICKO2_DEFAULTS here; the rebuild never WRITES a curve with gaps.
 */
export async function loadAndComputeRatingCurve(
  playerId: string,
  options: LoadRatingCurveOptions = {}
): Promise<LoadedRatingCurve> {
  const excluded = new Set(options.excludeMatchIds ?? []);
  const [replayMatches, scope] = await Promise.all([
    getCompletedMatchesForRatingReplay(playerId),
    options.scope ?? loadRatingScope(),
  ]);
  const completedMatches: CompletedMatchForRating[] = replayMatches
    .filter((m) => !excluded.has(m.id) && matchCountsForRatings(m, scope))
    // The canonical replay order (shared with the gamification backfill);
    // its tie-breaks reproduce the reader's order for equal timestamps.
    .sort(compareReplayOrder)
    .map((m): CompletedMatchForRating => ({
      id: m.id,
      player_1_id: m.player_1_id,
      player_2_id: m.player_2_id,
      winner_id: m.winner_id,
      date_played: m.date_played,
      created_at: m.created_at,
    }));

  const matchIds = completedMatches.map((m) => m.id);
  const historyRows = await getRatingHistoryByMatches(matchIds);

  const rowsByMatch = new Map<string, Map<string, (typeof historyRows)[number]>>();
  for (const row of historyRows) {
    let byPlayer = rowsByMatch.get(row.match_id);
    if (!byPlayer) {
      byPlayer = new Map();
      rowsByMatch.set(row.match_id, byPlayer);
    }
    byPlayer.set(row.player_id, row);
  }

  const opponentStateByMatch = new Map<string, OpponentFrozenState>();
  const integrity: RatingCurveIntegrity = { gaps: [], unratedMatchIds: [], unratedOpponentIds: [] };
  for (const match of completedMatches) {
    const opponentId = opponentIdForMatch(match, playerId);
    if (opponentId === null) continue;
    const byPlayer = rowsByMatch.get(match.id);
    const opponentRow = byPlayer?.get(opponentId);
    if (opponentRow) {
      opponentStateByMatch.set(match.id, {
        rating: opponentRow.rating_before,
        rd: opponentRow.rd_before,
      });
    } else if (byPlayer?.has(playerId)) {
      integrity.gaps.push({ matchId: match.id, playerId, missingPlayerId: opponentId });
    } else {
      integrity.unratedMatchIds.push(match.id);
      if (!integrity.unratedOpponentIds.includes(opponentId)) {
        integrity.unratedOpponentIds.push(opponentId);
      }
    }
  }

  const [computed, stored] = await Promise.all([
    Promise.resolve(
      computeRatingCurveCore({ playerId, matches: completedMatches, opponentStateByMatch })
    ),
    getPlayerRating(playerId),
  ]);

  const ownHistory = historyRows.filter((row) => row.player_id === playerId);
  const ownHistoryMatchIds = ownHistory.map((row) => row.match_id);

  return { computed, stored, matchesReplayed: computed.matchesReplayed, integrity, ownHistoryMatchIds, ownHistory };
}

// ── Batch planning (gap healing) ─────────────────────────────────────
// A gap (P has a row for match M, opponent O has none) is the trace of a
// partial write from before the atomic writers (the live path wrote the two
// rows in separate calls until `rating_apply_match_result`, the pre-H13
// rebuild deleted and re-inserted a player's rows in separate calls), or of a
// hand edit. Replaying P cannot know O's state at M, but replaying O can: O's
// replay reads P's row for M and writes O's own. So the batch rebuilds O
// before P, and the gap is gone by the time P is replayed. Players outside
// the requested set are added when the healing needs them, and so is the
// opponent of a never-rated match (otherwise the replayed player's new row
// would be one-sided and every later rebuild would see a gap).
// Only a cycle (P needs O first, O needs P first) cannot be ordered; the
// plan refuses it before anything is written.
// Healing reaches beyond the requested players on purpose: a player's curve depends on each opponent's frozen state at every
// match, so filling a gap means rewriting the opponent who misses the row,
// and pairing a never-rated match means writing both of its players. Limiting
// the batch to the requested set would leave a curve built on the default
// opponent, or a one-sided history that every later rebuild refuses.

export interface RatingRebuildPlan {
  /** Every player to rebuild, in write order: a gap's missing player comes
   * before the player whose replay needs its row; otherwise request order,
   * then added players in discovery order. */
  order: string[];
  /** Players not requested but added to heal a gap or pair a never-rated match. */
  addedPlayerIds: string[];
  /** Gaps the order fills. */
  healedGaps: RatingHistoryGap[];
}

interface PlannedRebuild {
  plan: RatingRebuildPlan;
  loaded: Map<string, LoadedRatingCurve>;
  /** The rating scope the plan replayed against (reused by the batch's writes). */
  scope: RatingScope;
}

/** Cap on the players one plan may pull in, so a corrupt history cannot turn
 * a two-player reset into an unbounded league-wide crawl unnoticed. */
const MAX_PLANNED_PLAYERS = 2000;

async function planRatingRebuildUnlocked(
  playerIds: readonly string[],
  options: LoadRatingCurveOptions
): Promise<PlannedRebuild> {
  const queue = [...new Set(playerIds)];
  const queued = new Set(queue);
  const requested = new Set(queue);
  const loaded = new Map<string, LoadedRatingCurve>();
  const gaps: RatingHistoryGap[] = [];
  // One scope read for the whole plan (not one per player).
  const scope = options.scope ?? (await loadRatingScope());
  const loadOptions: LoadRatingCurveOptions = { ...options, scope };

  for (let i = 0; i < queue.length; i += 1) {
    const playerId = queue[i];
    const curve = await loadAndComputeRatingCurve(playerId, loadOptions);
    loaded.set(playerId, curve);
    gaps.push(...curve.integrity.gaps);
    const additions = [
      ...curve.integrity.gaps.map((gap) => gap.missingPlayerId),
      ...curve.integrity.unratedOpponentIds,
    ];
    for (const id of additions) {
      if (queued.has(id)) continue;
      if (queue.length >= MAX_PLANNED_PLAYERS) {
        throw new RatingRebuildPlanTooLargeError(MAX_PLANNED_PLAYERS);
      }
      queue.push(id);
      queued.add(id);
    }
  }

  // The owner of a gap waits for the missing player.
  const waitsFor = new Map<string, Set<string>>();
  for (const gap of gaps) {
    let deps = waitsFor.get(gap.playerId);
    if (!deps) {
      deps = new Set();
      waitsFor.set(gap.playerId, deps);
    }
    deps.add(gap.missingPlayerId);
  }

  const order: string[] = [];
  const done = new Set<string>();
  const remaining = [...queue];
  while (remaining.length > 0) {
    const next = remaining.findIndex((id) =>
      [...(waitsFor.get(id) ?? [])].every((dep) => done.has(dep))
    );
    if (next === -1) {
      const stuck = new Set(remaining);
      const cycleGaps = gaps.filter(
        (gap) => stuck.has(gap.playerId) && stuck.has(gap.missingPlayerId)
      );
      throw await integrityError(cycleGaps);
    }
    const [id] = remaining.splice(next, 1);
    order.push(id);
    done.add(id);
  }

  return {
    plan: {
      order,
      addedPlayerIds: queue.filter((id) => !requested.has(id)),
      healedGaps: gaps,
    },
    loaded,
    scope,
  };
}

/**
 * Read-only preflight for a rebuild of `playerIds`: plans the batch (see
 * "Batch planning" above) and throws `RatingHistoryIntegrityError` when its
 * gaps cannot be ordered. Callers that write other data before the rebuild
 * (match reset, season repair) run this first, so a refusal leaves everything
 * untouched. `excludeMatchIds` drops matches the caller is about to
 * un-complete. Not queued on the rebuild lock (reads only); the rebuild plans
 * again under the lock and re-checks every player before its write.
 */
export async function planRatingRebuild(
  playerIds: readonly string[],
  options: LoadRatingCurveOptions = {}
): Promise<RatingRebuildPlan> {
  const { plan } = await planRatingRebuildUnlocked(playerIds, options);
  return plan;
}

// ── In-process serialization ─────────────────────────────────────────
// A rebuild reads its opponents' history rows while other rebuilds rewrite
// theirs; two overlapping rebuilds (two reconcile requests, a reset during a
// repair) then replay against a mix of old and new opponent states. Every
// write entry point below, and the live `updateRatings`, queues on this
// chain, so this process runs one rating write at a time, in arrival order.
// Across processes the SQL side serializes: the live write and the rebuild's
// per-player replace take the same per-player advisory locks, and the live
// write is fenced on the state it computed from (docs/rating.md). The chain swallows nothing: each
// caller awaits its own `run` promise and sees its own rejection; the chain
// only continues past a failed run so later callers are not blocked forever.
let rebuildChain: Promise<void> = Promise.resolve();
let rebuildsQueued = 0;

function withRebuildLock<T>(task: () => Promise<T>): Promise<T> {
  rebuildsQueued += 1;
  const run = rebuildChain.then(task);
  rebuildChain = run.then(
    () => {
      rebuildsQueued -= 1;
    },
    () => {
      rebuildsQueued -= 1;
    }
  );
  return run;
}

/** Number of rebuild calls queued or running in this process (0 when idle). */
export function ratingRebuildsInFlight(): number {
  return rebuildsQueued;
}

/** `value` rounded to `scale` decimals, the way a numeric(p, scale) column
 * stores it. The write sends the number as JSON text and the column rounds
 * that decimal half away from zero, so the text is shifted, not the binary
 * value: 1418.085 stores as 1418.09, while 1418.085 * 100 is 141808.49999999997. */
function toColumnScale(value: number, scale: number): number {
  const text = String(Math.abs(value));
  if (text.includes('e')) return Number(value.toFixed(scale));
  const rounded = Number(`${Math.round(Number(`${text}e${scale}`))}e-${scale}`);
  return value < 0 ? -rounded : rounded;
}

/** Whether writing `curve` changes the stored state (see `RebuildRatingsResult.changed`):
 * player_ratings.rating and rd are numeric(7,2), volatility numeric(8,6);
 * rating_history's rating and rd columns are numeric(7,2). */
function curveChangesStoredState(curve: LoadedRatingCurve): boolean {
  const { stored, computed, ownHistoryMatchIds, ownHistory } = curve;
  if (stored === null) return true;
  const { finalState, history } = computed;
  if (
    toColumnScale(finalState.rating, 2) !== Number(stored.rating) ||
    toColumnScale(finalState.rd, 2) !== Number(stored.rd) ||
    toColumnScale(finalState.volatility, 6) !== Number(stored.volatility) ||
    finalState.wins !== stored.wins ||
    finalState.losses !== stored.losses ||
    finalState.draws !== stored.draws ||
    history.length !== ownHistoryMatchIds.length
  ) {
    return true;
  }
  if (!ownHistory) return false;
  // Opponents' replays read these rows, so an inner row that moved is a change
  // even when the final state rounds to the stored one.
  const storedByMatch = new Map(ownHistory.map((row) => [row.match_id, row]));
  return history.some((row) => {
    const before = storedByMatch.get(row.match_id);
    return (
      !before ||
      toColumnScale(row.rating_before, 2) !== Number(before.rating_before) ||
      toColumnScale(row.rd_before, 2) !== Number(before.rd_before) ||
      toColumnScale(row.rating_after, 2) !== Number(before.rating_after) ||
      toColumnScale(row.rd_after, 2) !== Number(before.rd_after)
    );
  });
}

/** Writes one player's loaded curve. Refuses (writing nothing for this
 * player) when the curve still has gaps: the plan ordered the batch so none
 * remain, so a gap here means another process wrote in between. */
async function writeLoadedCurve(
  playerId: string,
  curve: LoadedRatingCurve,
  addedToBatch: boolean
): Promise<RebuildRatingsResult> {
  const { computed, integrity, ownHistoryMatchIds } = curve;
  if (integrity.gaps.length > 0) {
    throw await integrityError(integrity.gaps);
  }
  const { finalState, history } = computed;

  if (integrity.unratedMatchIds.length > 0) {
    console.warn(
      `[rating/rebuild] player ${playerId}: ${integrity.unratedMatchIds.length} completed match(es) had no rating history and were replayed against the default opponent: ${integrity.unratedMatchIds.join(', ')}`
    );
  }

  // One transaction: player_ratings upsert + history delete + history insert,
  // fenced on the history this replay read (RatingCurveStaleError otherwise).
  await replacePlayerRatingCurve(
    playerId,
    { ...finalState, updated_at: new Date().toISOString() },
    history,
    ownHistoryMatchIds
  );

  const ratingBefore = history.length > 0 ? history[0].rating_before : GLICKO2_DEFAULTS.INITIAL_RATING;

  return {
    playerId,
    addedToBatch,
    matchesReplayed: computed.matchesReplayed,
    ratingBefore,
    ratingAfter: finalState.rating,
    unratedMatchIds: integrity.unratedMatchIds,
    changed: curveChangesStoredState(curve),
  };
}

async function rebuildBatchUnlocked(playerIds: readonly string[]): Promise<RebuildRatingsResult[]> {
  const { plan, loaded, scope } = await planRatingRebuildUnlocked(playerIds, {});
  if (plan.addedPlayerIds.length > 0) {
    console.warn(
      `[rating/rebuild] healing ${plan.healedGaps.length} history gap(s) and pairing never-rated matches: rebuilding ${plan.addedPlayerIds.length} additional player(s): ${plan.addedPlayerIds.join(', ')}`
    );
  }
  const added = new Set(plan.addedPlayerIds);

  const results: RebuildRatingsResult[] = [];
  for (const [index, playerId] of plan.order.entries()) {
    // The plan's load is still current for the first player (nothing written
    // since, and the lock is held). Later players are re-read: earlier writes
    // in this batch filled their gaps and changed their opponents' rows.
    const fromPlan = loaded.get(playerId);
    const curve = index === 0 && fromPlan ? fromPlan : await loadAndComputeRatingCurve(playerId, { scope });
    results.push(await writeCurveRetryingStale(playerId, curve, added.has(playerId)));
  }
  return results;
}

/** Attempts of one player's rebuild write when a live apply committed between
 * the replay's read and its write (`RatingCurveStaleError`). */
const REBUILD_WRITE_ATTEMPTS = 3;

/**
 * Writes one player's curve; when the write's history fence fails (a live
 * apply from another process committed after the read, or a league's
 * test-league flag was set after the scope read), re-reads the rating scope
 * and the player and replays again, up to `REBUILD_WRITE_ATTEMPTS` writes,
 * then throws the last `RatingCurveStaleError`. Nothing is written by a
 * refused attempt.
 */
async function writeCurveRetryingStale(
  playerId: string,
  firstCurve: LoadedRatingCurve,
  addedToBatch: boolean
): Promise<RebuildRatingsResult> {
  let curve = firstCurve;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await writeLoadedCurve(playerId, curve, addedToBatch);
    } catch (err) {
      if (!(err instanceof RatingCurveStaleError) || attempt >= REBUILD_WRITE_ATTEMPTS) throw err;
      console.warn(
        `[rating/rebuild] player ${playerId}: the history or a test-league flag changed after the replay read it (attempt ${attempt}/${REBUILD_WRITE_ATTEMPTS}); re-reading`
      );
      // No scope passed: the retry reads the current test-league flags.
      curve = await loadAndComputeRatingCurve(playerId);
    }
  }
}

/**
 * Rebuilds one player's rating curve from scratch by replaying their completed
 * matches chronologically, then persisting the result atomically. Same rules
 * as `rebuildRatingsForPlayers` (gap healing included, so other players may be
 * rebuilt too); returns the requested player's result.
 */
export async function rebuildRatingsForPlayer(playerId: string): Promise<RebuildRatingsResult> {
  const results = await rebuildRatingsForPlayers([playerId]);
  const own = results.find((result) => result.playerId === playerId);
  if (!own) {
    throw new Error(`rating rebuild for player ${playerId} returned no result for that player`);
  }
  return own;
}

/**
 * Rebuilds the rating curves for multiple players, STRICTLY SEQUENTIALLY and
 * as one queued unit (no other rebuild in this process interleaves).
 *
 * A player's rebuild reads the OTHER players' rating_history rows (their
 * frozen pre-match states) while the player's own rows are rewritten.
 * Parallel rebuilds of mutual opponents therefore race (observed 2026-08-14:
 * a chunk-parallel reconcile repair grew rating mismatches 48 → 55).
 *
 * Before the first write the batch is planned (see "Batch planning"): history
 * gaps are healed by rebuilding the missing player first (added to the batch
 * if needed), and both players of a never-rated match are rebuilt. A gap
 * cycle aborts the whole batch with RatingHistoryIntegrityError and nothing is
 * written. Each player's write is one SQL transaction
 * (`replacePlayerRatingCurve`), re-checked for gaps right before it. A failure
 * stops the loop at that player: players before it are fully rebuilt, players
 * after it are untouched, and the caller sees the error. The results list
 * every rebuilt player in write order (added players included).
 *
 * One pass reproduces the stored curves when the history is consistent; after
 * removing or adding a match the opponents' later frozen states change, so a
 * second pass can still move numbers (reconcile reports the remaining diff;
 * each result's `changed` says whether its write moved anything).
 */
export function rebuildRatingsForPlayers(playerIds: string[]): Promise<RebuildRatingsResult[]> {
  return withRebuildLock(() => rebuildBatchUnlocked(playerIds));
}
