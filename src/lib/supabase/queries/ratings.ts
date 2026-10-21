import { supabase } from '../client';
import { getTestAccountIds } from './test-accounts';
import { assertValidUuid } from '@/lib/utils/uuid';
import { postgrestQuoted } from '@/lib/supabase/postgrest-filter';
import { readAllPages } from '@/lib/supabase/read-all-pages';
import { createRatingScope, type RatingScope } from '@/lib/rating/rating-scope';
import type { Json, Tables } from '@/types/database';
import type { SignaturePokemon } from '@/types/signature';
import type { PlayerRating, RatingHistoryEntry, RatingLeaderboardEntry } from '@/types/rating';

type PlayerRatingRow = Tables<'player_ratings'>;
type RatingHistoryRow = Tables<'rating_history'>;
type PlayerRow = Tables<'players'>;
type PlayerSignaturesRow = Tables<'player_signatures'>;

function toPlayerRating(row: PlayerRatingRow): PlayerRating {
  return {
    id: row.id,
    player_id: row.player_id,
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

function toRatingHistoryEntry(row: RatingHistoryRow): RatingHistoryEntry {
  return {
    id: row.id,
    player_id: row.player_id,
    match_id: row.match_id,
    rating_before: row.rating_before,
    rating_after: row.rating_after,
    rd_before: row.rd_before,
    rd_after: row.rd_after,
    opponent_id: row.opponent_id,
    opponent_rating: row.opponent_rating,
    result: row.result as RatingHistoryEntry['result'],
    rating_change: row.rating_change ?? row.rating_after - row.rating_before,
    recorded_at: row.recorded_at,
  };
}

export interface PlayerRatingUpsertInput {
  rating: number;
  rd: number;
  volatility: number;
  peak_rating: number;
  peak_date: string | null;
  wins: number;
  losses: number;
  draws: number;
  last_match_at: string | null;
  updated_at?: string;
}

export interface RatingHistoryInsertInput {
  player_id: string;
  match_id: string;
  rating_before: number;
  rating_after: number;
  rd_before: number;
  rd_after: number;
  opponent_id: string;
  opponent_rating: number;
  result: RatingHistoryEntry['result'];
  /** When the rating change happened. Omitted by the live path (the DB
   * default `now()` stamps it); the chronological rebuild passes the match
   * timestamp so a rebuilt history keeps its order. */
  recorded_at?: string;
}

/** PostgREST caps every response at `max_rows` (1000) and truncates silently. */
const POSTGREST_MAX_ROWS = 1000;
/** Match ids per `in.(...)` filter: keeps the request URL well under proxy limits
 * (150 UUIDs ≈ 5.6 KB) and, at two rows per match, each chunk under one page. */
const MATCH_ID_CHUNK = 150;

export async function getPlayerRating(playerId: string): Promise<PlayerRating | null> {
  const { data, error } = await supabase
    .from('player_ratings')
    .select('*')
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) throw error;
  return data ? toPlayerRating(data) : null;
}

export async function getRatingHistory(
  playerId: string,
  limit = 30
): Promise<RatingHistoryEntry[]> {
  const { data, error } = await supabase
    .from('rating_history')
    .select('*')
    .eq('player_id', playerId)
    .order('recorded_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data.map(toRatingHistoryEntry);
}

export async function getRatingHistoryByMatch(matchId: string): Promise<RatingHistoryEntry[]> {
  const { data, error } = await supabase
    .from('rating_history')
    .select('*')
    .eq('match_id', matchId)
    .order('recorded_at', { ascending: false });

  if (error) throw error;
  return data.map(toRatingHistoryEntry);
}

/**
 * Batch-fetch rating_history rows for multiple matches.
 * Used by the chronological rating rebuild to gather each opponent's frozen
 * (rating_before, rd_before) state per match without N+1 per-match queries.
 *
 * Complete under `max_rows`: the ids go out in chunks of `MATCH_ID_CHUNK`, and
 * every chunk is paged with `.range()` (ordered by the unique `id`) until a
 * short page, so a player with thousands of matches gets every row.
 */
export async function getRatingHistoryByMatches(
  matchIds: string[]
): Promise<RatingHistoryEntry[]> {
  const unique = [...new Set(matchIds)];
  if (unique.length === 0) return [];

  const rows: RatingHistoryRow[] = [];
  for (let i = 0; i < unique.length; i += MATCH_ID_CHUNK) {
    const chunk = unique.slice(i, i + MATCH_ID_CHUNK);
    for (let from = 0; ; from += POSTGREST_MAX_ROWS) {
      const { data, error } = await supabase
        .from('rating_history')
        .select('*')
        .in('match_id', chunk)
        .order('id', { ascending: true })
        .range(from, from + POSTGREST_MAX_ROWS - 1);

      if (error) throw error;
      rows.push(...data);
      if (data.length < POSTGREST_MAX_ROWS) break;
    }
  }

  return rows.map(toRatingHistoryEntry);
}

/** A completed match reduced to the columns the rating replay needs. */
export interface RatingReplayMatch {
  id: string;
  /** Decides whether the match counts toward ratings (`matchCountsForRatings`). */
  tournament_id: string;
  player_1_id: string;
  player_2_id: string;
  winner_id: string | null;
  date_played: string | null;
  created_at: string;
}

/** Keyset position in the replay order: the last row of the previous page. */
interface ReplayCursor {
  date_played: string | null;
  created_at: string;
  id: string;
}

const REPLAY_SELECT = 'id, tournament_id, player_1_id, player_2_id, winner_id, date_played, created_at';

/** `(created_at, id) < (cursor.created_at, cursor.id)` in the descending order, as a logic tree. */
function createdIdBefore(cursor: ReplayCursor): string {
  const createdAt = postgrestQuoted(cursor.created_at);
  return `or(created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${postgrestQuoted(cursor.id)}))`;
}

/**
 * Every COMPLETED match of one player, for the chronological rating replay.
 * Test-league matches are included: the caller drops them with
 * `matchCountsForRatings` against one `loadRatingScope()` read per rebuild
 * batch (src/lib/rating/rating-scope.ts).
 *
 * Narrow select, status filtered on the server, and paged until a short page:
 * the replay must see the player's whole match list (a truncated list would
 * restart the curve from the initial rating and the rebuild would then delete
 * the dropped matches' history).
 *
 * Order: `date_played` desc (nulls last), `created_at` desc, then the unique
 * `id` desc. That is the order the replay has always received before its
 * stable ascending sort by `date_played ?? created_at`, so matches with an
 * identical timestamp keep their established relative order and rebuilt
 * curves stay comparable with the stored ones.
 *
 * Keyset paging: each page continues strictly behind the
 * last row of the previous one in that order, so a match inserted, deleted or
 * re-dated during a long read can never shift a page boundary and duplicate
 * or skip a row (offset paging could, for players with more than 1000
 * matches). Two passes keep every filter simple: matches with a
 * `date_played` (keyset on date_played, created_at, id), then the undated
 * ones (keyset on created_at, id), which is exactly "nulls last".
 */
export async function getCompletedMatchesForRatingReplay(
  playerId: string
): Promise<RatingReplayMatch[]> {
  assertValidUuid(playerId, 'playerId');
  const playerFilter = `or(player_1_id.eq.${playerId},player_2_id.eq.${playerId})`;

  const rows: RatingReplayMatch[] = [];
  const pushPage = (data: RatingReplayMatch[]) => {
    for (const row of data) {
      rows.push({
        id: row.id,
        tournament_id: row.tournament_id,
        player_1_id: row.player_1_id,
        player_2_id: row.player_2_id,
        winner_id: row.winner_id,
        date_played: row.date_played,
        created_at: row.created_at,
      });
    }
  };

  // Pass 1: matches with a date_played.
  let cursor: ReplayCursor | null = null;
  for (;;) {
    const after: string = cursor
      ? `,or(date_played.lt.${postgrestQuoted(cursor.date_played ?? '')},` +
        `and(date_played.eq.${postgrestQuoted(cursor.date_played ?? '')},${createdIdBefore(cursor)}))`
      : '';
    const { data, error } = await supabase
      .from('matches')
      .select(REPLAY_SELECT)
      .or(`and(${playerFilter}${after})`)
      .eq('status', 'completed')
      .not('date_played', 'is', null)
      .order('date_played', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(POSTGREST_MAX_ROWS);

    if (error) throw error;
    pushPage(data);
    if (data.length < POSTGREST_MAX_ROWS) break;
    const last = data[data.length - 1];
    cursor = { date_played: last.date_played, created_at: last.created_at, id: last.id };
  }

  // Pass 2: matches without a date_played (nulls last).
  cursor = null;
  for (;;) {
    const after: string = cursor ? `,${createdIdBefore(cursor)}` : '';
    const { data, error } = await supabase
      .from('matches')
      .select(REPLAY_SELECT)
      .or(`and(${playerFilter}${after})`)
      .eq('status', 'completed')
      .is('date_played', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(POSTGREST_MAX_ROWS);

    if (error) throw error;
    pushPage(data);
    if (data.length < POSTGREST_MAX_ROWS) break;
    const last = data[data.length - 1];
    cursor = { date_played: null, created_at: last.created_at, id: last.id };
  }

  return rows;
}

/**
 * The rating scope (src/lib/rating/rating-scope.ts): the ids of every
 * tournament that belongs to a test league (`seasons.is_test_season`). Two
 * narrow reads (the test leagues, then their tournaments), each complete
 * under `max_rows`. A failed read throws: a rating run must never fall back
 * to counting test-league matches.
 */
export async function loadRatingScope(): Promise<RatingScope> {
  const testSeasons = await readAllPages<{ id: string }>((from, to) =>
    supabase.from('seasons').select('id').eq('is_test_season', true).order('id', { ascending: true }).range(from, to)
  );
  if (testSeasons.length === 0) return createRatingScope([]);

  const seasonIds = testSeasons.map((season) => season.id);
  const tournamentIds: string[] = [];
  for (let i = 0; i < seasonIds.length; i += MATCH_ID_CHUNK) {
    const chunk = seasonIds.slice(i, i + MATCH_ID_CHUNK);
    const rows = await readAllPages<{ id: string }>((from, to) =>
      supabase.from('tournaments').select('id').in('season_id', chunk).order('id', { ascending: true }).range(from, to)
    );
    tournamentIds.push(...rows.map((row) => row.id));
  }
  return createRatingScope(tournamentIds);
}

/** The tournament of one match (the live rating update's scope check), or null when the match does not exist. */
export async function getMatchTournamentIdForRating(matchId: string): Promise<string | null> {
  assertValidUuid(matchId, 'matchId');
  const { data, error } = await supabase
    .from('matches')
    .select('tournament_id')
    .eq('id', matchId)
    .maybeSingle();

  if (error) throw error;
  return data?.tournament_id ?? null;
}

/**
 * Every player of a COMPLETED match of the league `seasonId` (any of its
 * phases): the players whose rating curves change when the league's
 * test-league flag is set, and the players the league's reconcile repair
 * covers beyond its roster. Players who left the roster are included (their
 * matches still feed their curves); roster members without a completed match
 * are not (nothing of theirs changes). Unique ids, first-seen order.
 */
export async function listSeasonCompletedMatchPlayerIds(seasonId: string): Promise<string[]> {
  assertValidUuid(seasonId, 'seasonId');
  const tournaments = await readAllPages<{ id: string }>((from, to) =>
    supabase.from('tournaments').select('id').eq('season_id', seasonId).order('id', { ascending: true }).range(from, to)
  );
  const tournamentIds = tournaments.map((tournament) => tournament.id);

  const playerIds = new Set<string>();
  for (let i = 0; i < tournamentIds.length; i += MATCH_ID_CHUNK) {
    const chunk = tournamentIds.slice(i, i + MATCH_ID_CHUNK);
    const matches = await readAllPages<{ player_1_id: string; player_2_id: string }>((from, to) =>
      supabase
        .from('matches')
        .select('player_1_id, player_2_id')
        .in('tournament_id', chunk)
        .eq('status', 'completed')
        .order('id', { ascending: true })
        .range(from, to)
    );
    for (const match of matches) {
      playerIds.add(match.player_1_id);
      playerIds.add(match.player_2_id);
    }
  }
  return [...playerIds];
}

/** SQLSTATE `rating_replace_player_history` raises when its history fence fails. */
const SERIALIZATION_FAILURE = '40001';

/**
 * `rating_replace_player_history` refused the write (nothing written): the
 * player gained a rating_history row for a completed match after the replay
 * read the history, or the replay wrote a row for a match whose league became
 * a test league after the replay read the flag (20261019130000). Re-read the
 * rating scope and the player, and replay again.
 */
export class RatingCurveStaleError extends Error {
  readonly playerId: string;

  constructor(playerId: string, cause: unknown) {
    super(`rating curve of player ${playerId} changed after the replay read it; nothing was written`, { cause });
    this.name = 'RatingCurveStaleError';
    this.playerId = playerId;
  }
}

/**
 * Replace one player's whole rating curve in ONE transaction through the
 * service-role RPC `rating_replace_player_history`
 * (supabase/migrations/20261018130200_rating_history_atomic_replace.sql):
 * upsert `player_ratings`, delete the player's `rating_history` rows and
 * insert `history`. A failure anywhere rolls the whole call back, so readers
 * never see the player without history (the old delete-then-insert window).
 *
 * Fenced on `expectedHistoryMatchIds` (round 3, the 4-argument function in
 * 20261018170100_rating_apply_atomic.sql): the ids of the player's OWN
 * history rows the replay read. When the player meanwhile gained a row for a
 * completed match outside that set (a live `rating_apply_match_result`
 * committed between the replay's read and this write), the RPC writes nothing
 * and this throws `RatingCurveStaleError`; the caller re-reads and retries.
 *
 * Refuses, before any request, a history row that belongs to another player.
 * Throws the PostgREST error unchanged otherwise, and throws when the RPC
 * reports a row count other than `history.length`. Returns the inserted row
 * count.
 */
export async function replacePlayerRatingCurve(
  playerId: string,
  state: PlayerRatingUpsertInput,
  history: readonly RatingHistoryInsertInput[],
  expectedHistoryMatchIds: readonly string[]
): Promise<number> {
  assertValidUuid(playerId, 'playerId');
  const foreign = history.filter((entry) => entry.player_id !== playerId);
  if (foreign.length > 0) {
    throw new Error(
      `replacePlayerRatingCurve: ${foreign.length} history row(s) belong to another player than ${playerId}`
    );
  }

  const statePayload = {
    rating: state.rating,
    rd: state.rd,
    volatility: state.volatility,
    peak_rating: state.peak_rating,
    peak_date: state.peak_date,
    wins: state.wins,
    losses: state.losses,
    draws: state.draws,
    last_match_at: state.last_match_at,
    updated_at: state.updated_at ?? new Date().toISOString(),
  };
  const historyPayload = history.map((entry) => ({
    player_id: entry.player_id,
    match_id: entry.match_id,
    rating_before: entry.rating_before,
    rating_after: entry.rating_after,
    rd_before: entry.rd_before,
    rd_after: entry.rd_after,
    opponent_id: entry.opponent_id,
    opponent_rating: entry.opponent_rating,
    result: entry.result,
    recorded_at: entry.recorded_at ?? null,
  }));

  const { data, error } = await supabase.rpc('rating_replace_player_history', {
    p_player_id: playerId,
    p_state: statePayload as Json,
    p_history: historyPayload as Json,
    p_expected_history_match_ids: [...expectedHistoryMatchIds],
  });

  if (error) {
    if (error.code === SERIALIZATION_FAILURE) throw new RatingCurveStaleError(playerId, error);
    throw error;
  }
  if (data !== history.length) {
    throw new Error(
      `rating_replace_player_history inserted ${String(data)} row(s) for player ${playerId}, expected ${history.length}`
    );
  }
  return data;
}

/** The stored rating values the live update computed from: the fence of `rating_apply_match_result`. */
export interface ExpectedRatingState {
  rating: number;
  rd: number;
  volatility: number;
  wins: number;
  losses: number;
  draws: number;
}

/** One player's side of a live match rating update. */
export interface MatchRatingResultEntry {
  playerId: string;
  /** The player's stored row the result was computed from, or null when the player had none. */
  expected: ExpectedRatingState | null;
  /** The player's new rating state. */
  state: PlayerRatingUpsertInput;
  /** The player's history row for the match (`match_id` comes from the call). */
  history: Omit<RatingHistoryInsertInput, 'player_id' | 'match_id' | 'recorded_at'>;
}

/** Outcome codes of `rating_apply_match_result` (supabase/migrations/20261018170100_rating_apply_atomic.sql;
 * 'skipped_test_season' from 20261019130000_ratings_skip_test_seasons.sql). */
export type ApplyMatchRatingOutcome =
  | 'applied'
  | 'already_applied'
  | 'stale'
  | 'history_incomplete'
  | 'match_missing'
  | 'match_not_completed'
  | 'skipped_test_season';

function toApplyMatchRatingOutcome(raw: string): ApplyMatchRatingOutcome {
  switch (raw) {
    case 'applied':
    case 'already_applied':
    case 'stale':
    case 'history_incomplete':
    case 'match_missing':
    case 'match_not_completed':
    case 'skipped_test_season':
      return raw;
  }
  throw new Error(`rating_apply_match_result returned an unknown outcome: ${JSON.stringify(raw)}`);
}

/** The stored values `rating_apply_match_result` compares against `expected`. */
export function toExpectedRatingState(row: PlayerRating | null): ExpectedRatingState | null {
  if (!row) return null;
  return {
    rating: row.rating,
    rd: row.rd,
    volatility: row.volatility,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
  };
}

/**
 * Write one completed match's live rating change in ONE transaction through
 * the service-role RPC `rating_apply_match_result`: both players'
 * `player_ratings` rows and both `rating_history` rows commit together or not
 * at all, under the per-player advisory locks the chronological rebuild
 * (`rating_replace_player_history`) takes as well.
 *
 * Outcomes: 'applied'; 'already_applied' (both history rows exist, nothing
 * written: a retry or a concurrent finalize won); 'stale' (a stored row no
 * longer equals `expected`: another writer changed the player since the read,
 * nothing written, re-read and recompute); 'history_incomplete' (exactly one
 * history row exists, nothing written); 'match_missing' /
 * 'match_not_completed' (the match was deleted or reset meanwhile, nothing
 * written); 'skipped_test_season' (the match belongs to a test league, which
 * stays out of ratings: nothing written). Throws the PostgREST error unchanged (the transaction rolled back)
 * and on an outcome code this build does not know.
 */
export async function applyMatchRatingResult(
  matchId: string,
  entries: readonly [MatchRatingResultEntry, MatchRatingResultEntry]
): Promise<ApplyMatchRatingOutcome> {
  assertValidUuid(matchId, 'matchId');
  const payload = entries.map((entry) => ({
    player_id: entry.playerId,
    expected: entry.expected,
    state: {
      rating: entry.state.rating,
      rd: entry.state.rd,
      volatility: entry.state.volatility,
      peak_rating: entry.state.peak_rating,
      peak_date: entry.state.peak_date,
      wins: entry.state.wins,
      losses: entry.state.losses,
      draws: entry.state.draws,
      last_match_at: entry.state.last_match_at,
      updated_at: entry.state.updated_at ?? new Date().toISOString(),
    },
    history: {
      opponent_id: entry.history.opponent_id,
      rating_before: entry.history.rating_before,
      rating_after: entry.history.rating_after,
      rd_before: entry.history.rd_before,
      rd_after: entry.history.rd_after,
      opponent_rating: entry.history.opponent_rating,
      result: entry.history.result,
    },
  }));

  const { data, error } = await supabase.rpc('rating_apply_match_result', {
    p_match_id: matchId,
    p_players: payload as Json,
  });

  if (error) throw error;
  return toApplyMatchRatingOutcome(data);
}

export async function getLeaderboard(minGames?: number): Promise<PlayerRating[]> {
  let query = supabase
    .from('player_ratings')
    .select('*')
    .order('rating', { ascending: false })
    .limit(1000);

  // Global leaderboards never include test accounts. PostgREST `in` values
  // are plain UUIDs — no quoting needed (the ids come from the players.id
  // uuid column, so they cannot contain filter metacharacters).
  const testIds = await getTestAccountIds();
  if (testIds.length > 0) {
    query = query.not('player_id', 'in', `(${testIds.join(',')})`);
  }

  const { data, error } = await query;

  if (error) throw error;

  const mapped = data.map(toPlayerRating);
  if (!minGames || minGames <= 0) {
    return mapped;
  }

  return mapped.filter((r) => (r.wins + r.losses + r.draws) >= minGames);
}

export async function getLeaderboardEntries(minGames?: number): Promise<RatingLeaderboardEntry[]> {
  const ratings = await getLeaderboard(minGames);
  if (ratings.length === 0) return [];

  const playerIds = [...new Set(ratings.map((rating) => rating.player_id))];

  const [{ data: players, error: playersError }, { data: signatures, error: signaturesError }] =
    await Promise.all([
      supabase
        .from('players')
        .select('id, name, avatar_url')
        .in('id', playerIds),
      supabase
        .from('player_signatures')
        .select('player_id, signatures')
        .in('player_id', playerIds),
    ]);

  if (playersError) throw playersError;
  if (signaturesError) throw signaturesError;

  const playerMap = new Map<string, Pick<PlayerRow, 'name' | 'avatar_url'>>();
  for (const player of players as Pick<PlayerRow, 'id' | 'name' | 'avatar_url'>[]) {
    playerMap.set(player.id, { name: player.name, avatar_url: player.avatar_url });
  }

  const signaturesMap = new Map<string, SignaturePokemon[]>();
  for (const row of signatures as Pick<PlayerSignaturesRow, 'player_id' | 'signatures'>[]) {
    const raw = row.signatures;
    signaturesMap.set(
      row.player_id,
      Array.isArray(raw) ? (raw as unknown as SignaturePokemon[]) : []
    );
  }

  return ratings.map((rating) => {
    const player = playerMap.get(rating.player_id);
    return {
      ...rating,
      player_name: player?.name ?? 'Unknown Player',
      player_avatar_url: player?.avatar_url ?? null,
      signatures: signaturesMap.get(rating.player_id) ?? [],
    };
  });
}

/**
 * Batch-fetch ratings for multiple players in a single query.
 * Used by standings endpoint to avoid N+1 per-player queries.
 */
export async function getPlayerRatingsBatch(
  playerIds: string[]
): Promise<Map<string, PlayerRating>> {
  if (playerIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('player_ratings')
    .select('*')
    .in('player_id', playerIds);

  if (error) throw error;

  const result = new Map<string, PlayerRating>();
  for (const row of data) {
    result.set(row.player_id, toPlayerRating(row));
  }
  return result;
}
