import { supabase } from '../client';
import { assertValidUuid } from '@/lib/utils/uuid';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Tables, TablesInsert } from '@/types/database';
import type { Game, GameCreateInput, BattleStat, BattleStatInsert, AggregateScope } from '@/types/game';
import type { PlayerBattleStatRow } from '@/types/profile';

type GameRow = Tables<'games'>;
type BattleStatRow = Tables<'battle_stats'>;

function toGame(row: GameRow): Game {
  return {
    id: row.id,
    match_id: row.match_id,
    game_number: row.game_number,
    winner_id: row.winner_id,
    replay_url: row.replay_url,
    replay_hash: row.replay_hash,
    source: row.source,
    parsed: row.parsed,
    stats_locked: row.stats_locked,
    aggregate_applied_at: row.aggregate_applied_at,
    evolution_applied_at: row.evolution_applied_at,
    exclude_all_time: row.exclude_all_time,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toBattleStat(row: BattleStatRow): BattleStat {
  return {
    id: row.id,
    game_id: row.game_id,
    player_id: row.player_id,
    pokemon_name: row.pokemon_name,
    was_brought: row.was_brought,
    was_lead: row.was_lead,
    kos_dealt: row.kos_dealt,
    was_koed: row.was_koed,
    moves_used: Array.isArray(row.moves_used) ? row.moves_used as string[] : [],
    turns_active: row.turns_active,
    match_won: row.match_won,
    created_at: row.created_at,
  };
}

// ─── Games ───────────────────────────────────────────────────────────

export async function getGamesByMatch(matchId: string): Promise<Game[]> {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('match_id', matchId)
    .order('game_number');

  if (error) throw error;
  return data.map(toGame);
}

export async function getGameById(id: string): Promise<Game | null> {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toGame(data) : null;
}

/**
 * UNIQUE (match_id, game_number) on `games`
 * (supabase/migrations/20261018130000_match_finalize_integrity.sql).
 */
export const GAMES_MATCH_GAME_NUMBER_KEY = 'games_match_id_game_number_key';

/**
 * A concurrent submission for the same match took this game number first
 * (`getNextGameNumber` is a max+1 read). The losing request wrote nothing, so
 * the client reloads and submits again. HTTP 409, code `match_result_conflict`.
 */
export class GameNumberConflictError extends UserFacingError {
  constructor() {
    super(
      'Another result was recorded for this match at the same moment. Reload the match and submit again.',
      { code: 'match_result_conflict', status: 409 },
    );
    this.name = 'GameNumberConflictError';
  }
}

/**
 * UNIQUE index on `games (replay_hash) WHERE replay_hash IS NOT NULL`
 * (supabase/migrations/20261020100000_games_replay_hash.sql).
 */
export const GAMES_REPLAY_HASH_KEY = 'games_replay_hash_key';

/**
 * The battle behind this replay is already bound to a recorded game, in this
 * match or any other. Thrown by the
 * pipeline's pre-check and, race-safe, by `createGame` when the unique index
 * refuses the insert; nothing is written. HTTP 409, code
 * `replay_already_recorded`. The pipeline deletes a game again when its stats
 * or aggregate job fail after the insert; if that delete fails too, the game
 * keeps the hash and this error points at it until an admin deletes it (admin
 * game delete; the match page lists it without stats).
 */
export class ReplayAlreadyRecordedError extends UserFacingError {
  constructor() {
    super(
      'This replay was already used to record a game result. Each battle can be recorded only once.',
      { code: 'replay_already_recorded', status: 409 },
    );
    this.name = 'ReplayAlreadyRecordedError';
  }
}

/**
 * UNIQUE index on `battle_stats (game_id, player_id, <key>)`, the database twin
 * of the request schemas' one-row-per-Pokémon rule. Since
 * supabase/migrations/20261021100200_battle_stats_pokemon_key_js_trim.sql the
 * key is `lower(regexp_replace(pokemon_name, '^[set]+|[set]+$', '', 'g'))`
 * with `[set]` exactly JavaScript's trim set, so it matches
 * `battleStatPokemonKey` (src/lib/validation/schemas.ts); it replaced the
 * `lower(btrim(pokemon_name))` key of 20261020100100 under the same name.
 */
export const BATTLE_STATS_GAME_PLAYER_POKEMON_KEY = 'battle_stats_game_player_pokemon_key';

/**
 * A stats write named the same Pokémon twice for one player in one game. The
 * request schemas refuse this first (400 `validation_failed`); this is the
 * database backstop for any writer that skipped them. HTTP 409, code
 * `battle_stats_duplicate_pokemon`; the insert wrote no row.
 */
export class BattleStatsDuplicatePokemonError extends UserFacingError {
  constructor() {
    super(
      'A Pokémon appears twice for the same player in this game. Each Pokémon can be recorded once per player and game.',
      { code: 'battle_stats_duplicate_pokemon', status: 409 },
    );
    this.name = 'BattleStatsDuplicatePokemonError';
  }
}

/** A Postgres unique violation of exactly `constraint` (others are not ours to map). */
function isUniqueViolationOf(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message, details } = error as { code?: unknown; message?: unknown; details?: unknown };
  if (code !== '23505') return false;
  return (
    (typeof message === 'string' && message.includes(constraint)) ||
    (typeof details === 'string' && details.includes(constraint))
  );
}

export async function createGame(input: GameCreateInput): Promise<Game> {
  const insert: TablesInsert<'games'> = {
    match_id: input.match_id,
    game_number: input.game_number,
    winner_id: input.winner_id,
    replay_url: input.replay_url ?? '',
    replay_hash: input.replay_hash ?? null,
    source: input.source,
    parsed: input.parsed ?? false,
    exclude_all_time: input.exclude_all_time,
  };

  const { data, error } = await supabase
    .from('games')
    .insert(insert)
    .select()
    .single();

  if (error) {
    if (isUniqueViolationOf(error, GAMES_MATCH_GAME_NUMBER_KEY)) {
      console.error(
        `[createGame] game ${input.game_number} of match ${input.match_id} already exists (concurrent submission)`,
        error
      );
      throw new GameNumberConflictError();
    }
    if (isUniqueViolationOf(error, GAMES_REPLAY_HASH_KEY)) {
      console.error(
        `[createGame] replay ${input.replay_url ?? ''} of match ${input.match_id} is already bound to a game ` +
          `(concurrent or repeated submission of the same battle)`,
        error
      );
      throw new ReplayAlreadyRecordedError();
    }
    throw error;
  }
  return toGame(data);
}

/**
 * The id of the game the battle with this replay hash is bound to, or null.
 * The pipeline's pre-check before any write; the unique index stays the
 * race-safe guard (`createGame`).
 */
export async function findGameIdByReplayHash(replayHash: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('games')
    .select('id')
    .eq('replay_hash', replayHash)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

export async function markGameParsed(gameId: string): Promise<void> {
  const { error } = await supabase
    .from('games')
    .update({ parsed: true })
    .eq('id', gameId);

  if (error) throw error;
}

export async function updateGameWinner(gameId: string, winnerId: string): Promise<Game> {
  const { data, error } = await supabase
    .from('games')
    .update({ winner_id: winnerId })
    .eq('id', gameId)
    .select()
    .single();

  if (error) throw error;
  return toGame(data);
}

// `games.aggregate_applied_at` is written only inside SQL transactions:
// `apply_aggregate_job` sets it with the increments, `rollback_game_aggregates`
// clears it with the decrements (src/lib/supabase/queries/aggregates.ts). No
// standalone marker write exists, so the marker can never disagree with the
// counts it describes. The same holds for `games.evolution_applied_at` and its
// credit ledger `games.evolution_credits`: only the EPB credit functions write
// them, the ledger only together with the marker (a CHECK keeps it NULL while
// the marker is NULL) and both with the tracker writes (`creditGameKills` /
// `uncreditGameKills` in src/lib/supabase/queries/evolutions.ts, and the
// season rebuild's `epb_sync_game_kill_credit` called from
// src/lib/reconcile/evolution-rebuild.ts).

/**
 * Mark a game as manually edited. Future re-parse / bulk import tooling should
 * respect this flag and skip re-importing locked games so hand-corrected data
 * is preserved.
 */
export async function setGameStatsLocked(
  gameId: string,
  locked = true
): Promise<void> {
  const { error } = await supabase
    .from('games')
    .update({ stats_locked: locked })
    .eq('id', gameId);

  if (error) throw error;
}

/** Outcome of `claimGameEditLease`. */
export type GameEditLeaseClaimOutcome = 'claimed' | 'leased' | 'stale' | 'missing';

const GAME_EDIT_LEASE_CLAIM_OUTCOMES: readonly GameEditLeaseClaimOutcome[] = ['claimed', 'leased', 'stale', 'missing'];

/**
 * How long an admin game edit may hold its lease (seconds). An edit is a
 * handful of requests and normally ends in well under a second; the TTL only
 * bounds how long a game stays blocked when an edit's process died or its
 * release failed. The SQL function refuses values outside 1..900.
 */
export const GAME_EDIT_LEASE_TTL_SECONDS = 120;

/**
 * Optimistic-concurrency claim plus edit lease for an admin game edit, in ONE
 * conditional UPDATE (`claim_game_edit_lease`,
 * supabase/migrations/20261019100000_games_edit_lease.sql). It succeeds only
 * while `games.updated_at` still equals the version the editor loaded
 * (`expectedUpdatedAt`, the exact string this module returned) AND no other
 * edit holds an unexpired lease; it stamps `token` with an expiry of
 * `GAME_EDIT_LEASE_TTL_SECONDS` on the database clock.
 *
 * - Two edits sent with the same version: the `trg_games_updated` trigger
 *   stamps a fresh `updated_at` on the claimed row, and a second UPDATE that
 *   waited on the first one's row lock re-checks its WHERE against the
 *   committed row and matches nothing ('leased').
 * - An editor reloaded while an edit runs holds the CURRENT version (every
 *   write of the running edit moves it on), so only the lease refuses it
 *   ('leased').
 *
 * Returns 'claimed', 'leased' (another edit is running; nothing written),
 * 'stale' (no lease, but the row is at another version; nothing written) or
 * 'missing' (the row is gone). The caller releases the lease with
 * `releaseGameEditLease` when the edit ends, success or failure.
 */
export async function claimGameEditLease(
  gameId: string,
  expectedUpdatedAt: string,
  token: string
): Promise<GameEditLeaseClaimOutcome> {
  const { data, error } = await supabase.rpc('claim_game_edit_lease', {
    p_game_id: gameId,
    p_expected_updated_at: expectedUpdatedAt,
    p_token: token,
    p_ttl_seconds: GAME_EDIT_LEASE_TTL_SECONDS,
  });

  if (error) throw error;
  const outcome = GAME_EDIT_LEASE_CLAIM_OUTCOMES.find((o) => o === data);
  if (!outcome) {
    throw new Error(`claim_game_edit_lease returned an unexpected outcome for game ${gameId}: ${String(data)}`);
  }
  return outcome;
}

/**
 * Release the edit lease `token` holds on the game (`release_game_edit_lease`).
 * Returns false when the token no longer holds it: the lease expired and
 * another edit took it over, or the game is gone. The release moves
 * `updated_at` on, so an editor opened during the edit is stale afterwards.
 */
export async function releaseGameEditLease(gameId: string, token: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('release_game_edit_lease', {
    p_game_id: gameId,
    p_token: token,
  });

  if (error) throw error;
  return data === true;
}

/** Outcome of `deleteUncountedGameRow`. */
export type UncountedGameDeleteOutcome = 'deleted' | 'counted' | 'missing';

/**
 * Delete a game row only while its aggregates are NOT counted
 * (`aggregate_applied_at IS NULL`), in ONE statement. `battle_stats`,
 * `aggregate_jobs` and `broadcast_moments` go with it (ON DELETE CASCADE), so
 * the game and its stats disappear together or not at all.
 *
 * The fence closes the edit-vs-delete race: `apply_aggregate_job` sets the
 * marker under the game row lock, and a DELETE that waited on that lock
 * re-checks its WHERE against the committed row, so a concurrent edit's
 * re-apply that committed first leaves the row in place ('counted') instead
 * of a deleted game whose counts stay. When the delete commits first, the
 * apply finds the game gone ('game_missing') and counts nothing.
 *
 * Returns 'deleted', 'counted' (the row exists with the marker set; nothing
 * was deleted) or 'missing' (the row was already gone).
 */
export async function deleteUncountedGameRow(gameId: string): Promise<UncountedGameDeleteOutcome> {
  const { data, error } = await supabase
    .from('games')
    .delete()
    .eq('id', gameId)
    .is('aggregate_applied_at', null)
    .select('id');

  if (error) throw error;
  if (data.length > 0) return 'deleted';

  const { data: remaining, error: readError } = await supabase
    .from('games')
    .select('id')
    .eq('id', gameId)
    .maybeSingle();

  if (readError) throw readError;
  return remaining ? 'counted' : 'missing';
}

/**
 * Count games won by each player in a match.
 */
export async function getGameWinCounts(
  matchId: string
): Promise<{ player_1_wins: number; player_2_wins: number; player_ids: [string, string] }> {
  const { data, error } = await supabase
    .from('games')
    .select('winner_id')
    .eq('match_id', matchId);

  if (error) throw error;

  // Get the match to know who p1 and p2 are
  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select('player_1_id, player_2_id')
    .eq('id', matchId)
    .single();

  if (matchErr) throw matchErr;

  let player_1_wins = 0;
  let player_2_wins = 0;
  for (const game of data) {
    if (game.winner_id === match.player_1_id) player_1_wins++;
    else if (game.winner_id === match.player_2_id) player_2_wins++;
  }

  return {
    player_1_wins,
    player_2_wins,
    player_ids: [match.player_1_id, match.player_2_id],
  };
}

/**
 * Get the next game number for a match.
 */
export async function getNextGameNumber(matchId: string): Promise<number> {
  const { data, error } = await supabase
    .from('games')
    .select('game_number')
    .eq('match_id', matchId)
    .order('game_number', { ascending: false })
    .limit(1);

  if (error) throw error;
  return data.length > 0 ? data[0].game_number + 1 : 1;
}

// ─── Battle Stats ────────────────────────────────────────────────────

export async function createBattleStats(stats: BattleStatInsert[]): Promise<BattleStat[]> {
  const inserts: TablesInsert<'battle_stats'>[] = stats.map((s) => ({
    game_id: s.game_id,
    player_id: s.player_id,
    pokemon_name: s.pokemon_name,
    was_brought: s.was_brought ?? true,
    was_lead: s.was_lead ?? false,
    kos_dealt: s.kos_dealt ?? 0,
    was_koed: s.was_koed ?? false,
    moves_used: (s.moves_used ?? []) as unknown as TablesInsert<'battle_stats'>['moves_used'],
    turns_active: s.turns_active ?? 0,
    match_won: s.match_won ?? false,
  }));

  const { data, error } = await supabase
    .from('battle_stats')
    .insert(inserts)
    .select();

  if (error) {
    if (isUniqueViolationOf(error, BATTLE_STATS_GAME_PLAYER_POKEMON_KEY)) {
      console.error(
        `[createBattleStats] duplicate Pokémon for one player in game ${stats[0]?.game_id ?? '?'}`,
        error
      );
      throw new BattleStatsDuplicatePokemonError();
    }
    throw error;
  }
  return data.map(toBattleStat);
}

export async function deleteBattleStatsByGame(gameId: string): Promise<void> {
  const { error } = await supabase
    .from('battle_stats')
    .delete()
    .eq('game_id', gameId);

  if (error) throw error;
}

export async function getBattleStatsByGame(gameId: string): Promise<BattleStat[]> {
  const { data, error } = await supabase
    .from('battle_stats')
    .select('*')
    .eq('game_id', gameId);

  if (error) throw error;
  return data.map(toBattleStat);
}

/**
 * Fetch all battle stats for every game in a match, grouped by game ID.
 * Single query avoids N+1 when displaying full match detail.
 */
/**
 * The narrow battle_stats select for tournament/league kill rankings: the
 * counters plus the round (joined through games → matches → rounds; the
 * tournament id stays in the embed because the scope filters on it).
 */
const TOURNAMENT_BATTLE_STAT_SELECT = `
  game_id, player_id, pokemon_name,
  was_brought, was_lead, kos_dealt, was_koed,
  games!inner (
    matches!inner (
      tournament_id,
      rounds!inner ( round_number )
    )
  )
`;

function toTournamentBattleStat(row: {
  game_id: string;
  player_id: string;
  pokemon_name: string;
  was_brought: boolean;
  was_lead: boolean;
  kos_dealt: number;
  was_koed: boolean;
  games: unknown;
}): TournamentBattleStat {
  const games = row.games as {
    matches: { tournament_id: string; rounds: { round_number: number } };
  };
  return {
    game_id: row.game_id,
    player_id: row.player_id,
    pokemon_name: row.pokemon_name,
    was_brought: row.was_brought,
    was_lead: row.was_lead,
    kos_dealt: row.kos_dealt,
    was_koed: row.was_koed,
    round_number: games.matches.rounds.round_number,
  };
}

/**
 * The PostgREST `max_rows` ceiling (`supabase/config.toml`). It caps every
 * response, an explicit `.limit()` above it included, and a response of
 * exactly this many rows may have been truncated server-side without an
 * error, so the tournament battle_stats reads page in chunks of this size.
 */
const POSTGREST_MAX_ROWS = 1000;

/** The most rows one tournament or season battle_stats read returns. */
const TOURNAMENT_BATTLE_STATS_CAP = 10000;

/**
 * Read the narrow battle_stats rows in `.range()` pages of `max_rows` until a
 * short page, up to `TOURNAMENT_BATTLE_STATS_CAP`. `fetchPage` must order the
 * rows stably (a stable order is what makes paging safe). Reaching the cap is
 * logged (disclosed, not masked): the rows past it are not returned.
 */
async function readTournamentBattleStatPages(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: Parameters<typeof toTournamentBattleStat>[0][] | null; error: unknown }>,
  caller: string,
  scopeLabel: string,
): Promise<TournamentBattleStat[]> {
  const rows: Parameters<typeof toTournamentBattleStat>[0][] = [];
  for (let from = 0; from < TOURNAMENT_BATTLE_STATS_CAP; from += POSTGREST_MAX_ROWS) {
    const to = Math.min(from + POSTGREST_MAX_ROWS, TOURNAMENT_BATTLE_STATS_CAP) - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }

  if (rows.length >= TOURNAMENT_BATTLE_STATS_CAP) {
    console.warn(
      `[queries/games] ${caller}: result count hit 10,000 limit for ${scopeLabel} — stats may be truncated`
    );
  }

  return rows.map(toTournamentBattleStat);
}

/**
 * Fetch all battle stats for a tournament with round information.
 * Used by the tournament detail page for player kill differential and
 * round-filtered rankings. This is a targeted server-side query — the
 * aggregates table lacks player_id and round granularity, so we join
 * through games → matches → rounds to get per-round, per-player data.
 *
 * **Row limit:** PostgREST returns at most `max_rows` (1000) rows per
 * response, so the read pages with `.range()` (oldest first) up to 10,000
 * rows. Each game produces roughly one `battle_stats` row per Pokémon
 * brought, so a large tournament (e.g. 100+ players × 100+ games × 6
 * Pokémon = 60,000+ rows) can exceed that cap; the newest rows past it are
 * not returned, so callers should be aware that tournament stats may be
 * incomplete for very large tournaments. A warning is logged when the
 * result count reaches the cap to flag possible truncation.
 */
export async function getBattleStatsForTournament(
  tournamentId: string
): Promise<TournamentBattleStat[]> {
  return readTournamentBattleStatPages(
    (from, to) =>
      supabase
        .from('battle_stats')
        .select(TOURNAMENT_BATTLE_STAT_SELECT)
        .eq('games.matches.tournament_id', tournamentId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    'getBattleStatsForTournament',
    `tournament ${tournamentId}`,
  );
}

/**
 * One battle_stats row as the kill rankings and standings tiebreakers read
 * it, with the round it was played in. Deliberately narrow: `moves_used`,
 * `turns_active`, `match_won` and the row `id` are not read (they are the
 * bulk of the payload on a tournament page, and these rows are passed to the
 * client tabs). Match detail and scouting read full rows (`getBattleStatsByGame`,
 * `getBattleStatsByMatch`).
 */
export interface TournamentBattleStat {
  game_id: string;
  player_id: string;
  pokemon_name: string;
  was_brought: boolean;
  was_lead: boolean;
  kos_dealt: number;
  was_koed: boolean;
  round_number: number;
}

export async function getBattleStatsByMatch(
  matchId: string
): Promise<Record<string, BattleStat[]>> {
  // Get all game IDs for this match
  const { data: games, error: gamesErr } = await supabase
    .from('games')
    .select('id')
    .eq('match_id', matchId);

  if (gamesErr) throw gamesErr;
  if (!games.length) return {};

  const gameIds = games.map((g) => g.id);

  const { data, error } = await supabase
    .from('battle_stats')
    .select('*')
    .in('game_id', gameIds);

  if (error) throw error;

  const grouped: Record<string, BattleStat[]> = {};
  for (const row of data) {
    const stat = toBattleStat(row);
    if (!grouped[stat.game_id]) grouped[stat.game_id] = [];
    grouped[stat.game_id].push(stat);
  }
  return grouped;
}

/**
 * Fetch all battle stats for a player with tournament context.
 * Used by the profile composition function to compute per-player Pokémon stats
 * (most used, best killers) and per-tournament "best Pokémon".
 *
 * This queries battle_stats (not aggregates) because aggregates are per-Pokémon
 * globally — they don't track which player used which Pokémon. This is a
 * targeted, indexed query scoped to a single player_id.
 */
/**
 * Fetch all battle stats for an opponent within a tournament, for pre-match
 * scouting context. Returns raw stats (not aggregated) so the context builder
 * can compute tendencies. Only includes stats from completed matches.
 *
 * If tournament data has < 3 games, falls back to all tournaments within the
 * same season (league scope) for richer context.
 */
export async function getOpponentBattleStatsInTournament(
  opponentId: string,
  tournamentId: string,
  seasonId?: string | null
): Promise<BattleStat[]> {
  // First try: tournament scope
  const tournamentStats = await fetchBattleStatsForPlayerInScope(opponentId, [tournamentId]);
  if (tournamentStats.length >= 3 || !seasonId) {
    return tournamentStats;
  }

  // Fall back to league scope: find all tournaments in this season
  const { data: seasonTournaments, error: stErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('season_id', seasonId);

  if (stErr || !seasonTournaments?.length) return tournamentStats;

  const allTournamentIds = seasonTournaments.map((t) => t.id);
  return fetchBattleStatsForPlayerInScope(opponentId, allTournamentIds);
}

/** Internal: get battle stats for a player across one or more tournaments (completed matches only) */
async function fetchBattleStatsForPlayerInScope(
  playerId: string,
  tournamentIds: string[]
): Promise<BattleStat[]> {
  // Get game IDs from the player's completed matches in these tournaments
  assertValidUuid(playerId, 'playerId');
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id')
    .in('tournament_id', tournamentIds)
    .eq('status', 'completed')
    .or(`player_1_id.eq.${playerId},player_2_id.eq.${playerId}`);

  if (mErr || !matches?.length) return [];

  const matchIds = matches.map((m) => m.id);

  const { data: games, error: gErr } = await supabase
    .from('games')
    .select('id')
    .in('match_id', matchIds);

  if (gErr || !games?.length) return [];

  const gameIds = games.map((g) => g.id);

  const { data, error } = await supabase
    .from('battle_stats')
    .select('*')
    .in('game_id', gameIds)
    .eq('player_id', playerId);

  if (error) throw error;
  return data.map(toBattleStat);
}

export async function getPlayerBattleStats(
  playerId: string
): Promise<PlayerBattleStatRow[]> {
  const { data, error } = await supabase
    .from('battle_stats')
    .select(`
      pokemon_name, kos_dealt, was_koed, match_won,
      games!inner (
        matches!inner ( tournament_id )
      )
    `)
    .eq('player_id', playerId)
    .limit(500);

  if (error) throw error;

  return data.map((row) => {
    const games = row.games as unknown as {
      matches: { tournament_id: string };
    };
    return {
      pokemon_name: row.pokemon_name,
      kos_dealt: row.kos_dealt,
      was_koed: row.was_koed,
      match_won: row.match_won,
      tournament_id: games.matches.tournament_id,
    };
  });
}

/**
 * Fetch all battle stats for every tournament in a season (league scope).
 * Used by the league stats page for kill ranking computation.
 * Joins through games → matches → tournaments filtered by season_id.
 */
export async function getBattleStatsForSeason(
  seasonId: string
): Promise<TournamentBattleStat[]> {
  // Get all tournament IDs in this season
  const { data: seasonTournaments, error: stErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('season_id', seasonId);

  if (stErr) throw stErr;
  if (!seasonTournaments?.length) return [];

  return getBattleStatsForTournaments(
    seasonTournaments.map((t) => t.id),
    `season ${seasonId}`,
  );
}

/**
 * The narrow battle_stats rows for several tournaments (a season's stages)
 * in one `.in()` read — `getBattleStatsForSeason` for a caller that already
 * holds the stage ids. Same `max_rows` paging, 10,000-row cap and truncation
 * warning as `getBattleStatsForTournament`; up to 1000 rows is one query.
 */
export async function getBattleStatsForTournaments(
  tournamentIds: readonly string[],
  scopeLabel = `${tournamentIds.length} tournaments`,
): Promise<TournamentBattleStat[]> {
  if (tournamentIds.length === 0) return [];

  const ids = [...tournamentIds];
  return readTournamentBattleStatPages(
    (from, to) =>
      supabase
        .from('battle_stats')
        .select(TOURNAMENT_BATTLE_STAT_SELECT)
        .in('games.matches.tournament_id', ids)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    'getBattleStatsForTournaments',
    scopeLabel,
  );
}

export interface ScopeGameRow {
  game_id: string;
  tournament_id: string;
  season_id: string | null;
  exclude_all_time: boolean;
  /**
   * The game has an increment job the queue will still apply
   * (`isLiveIncrementJob`): the queue counts it, so a scope rebuild must not.
   */
  live_increment_job: boolean;
}

/** The queue facts of an `aggregate_jobs` row that decide whether it can still apply. */
export interface AggregateJobLiveness {
  operation: string;
  status: string;
  attempts: number;
  max_attempts: number;
}

/**
 * An increment job the queue can still apply to its game: `processing` (being
 * applied now, or reclaimed later), or `pending` with attempts left (claimable;
 * a pending row with exhausted attempts can never be claimed). Its game's
 * marker is NULL until it applies, so a scope rebuild that counted the game
 * would see the queue count it a second time.
 *
 * Trade-off: a `processing` job on its last attempt is live, so the rebuild
 * skips its game. If that attempt fails, the job ends `failed` and the game is
 * missing from the rebuilt scope until the next rebuild (the cron reports
 * failed jobs; re-running the rebuild is the recovery, docs/match.md).
 */
export function isLiveIncrementJob(job: AggregateJobLiveness): boolean {
  if (job.operation !== 'increment') return false;
  if (job.status === 'processing') return true;
  return job.status === 'pending' && job.attempts < job.max_attempts;
}

/**
 * `created_at` of the newest game, or null without games (database clock).
 * The scope rebuild reads it right after it clears the scope: games recorded
 * after that are counted by their own queue job, not by the rebuild.
 */
export async function getNewestGameCreatedAt(): Promise<string | null> {
  const { data, error } = await supabase
    .from('games')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.created_at ?? null;
}

/**
 * Paginated game list for admin aggregate rebuilds.
 * Only includes games from non-scheduled matches (matches get_total_games_in_scope),
 * created at or before `createdUpTo` (null: no game existed, so none is listed).
 * The upper bound also keeps the offset pages stable while games are recorded.
 * Each row says whether the game still has a live increment job.
 */
export async function listGamesForAggregateRebuild(
  scopeType: AggregateScope,
  scopeId: string | null,
  offset: number,
  limit: number,
  createdUpTo: string | null
): Promise<ScopeGameRow[]> {
  if (scopeType === 'tournament') {
    if (!scopeId) throw new Error('scope_id required for tournament rebuild');
    assertValidUuid(scopeId, 'tournament ID');
  } else if (scopeType === 'league') {
    if (!scopeId) throw new Error('scope_id required for league rebuild');
    assertValidUuid(scopeId, 'season ID');
  }
  if (createdUpTo === null) return [];

  let query = supabase
    .from('games')
    .select(`
      id,
      exclude_all_time,
      matches!inner (
        status,
        tournament_id,
        tournaments!inner ( season_id )
      ),
      aggregate_jobs ( operation, status, attempts, max_attempts )
    `)
    .neq('matches.status', 'scheduled')
    .lte('created_at', createdUpTo)
    .order('id')
    .range(offset, offset + limit - 1);

  if (scopeType === 'tournament') {
    query = query.eq('matches.tournament_id', scopeId!);
  } else if (scopeType === 'league') {
    query = query.eq('matches.tournaments.season_id', scopeId!);
  }

  const { data, error } = await query;
  if (error) throw error;
  if (!data) return [];

  return data.map((row) => {
    const matches = row.matches as unknown as {
      tournament_id: string;
      tournaments: { season_id: string | null };
    };
    return {
      game_id: row.id,
      tournament_id: matches.tournament_id,
      season_id: matches.tournaments.season_id,
      exclude_all_time: row.exclude_all_time,
      live_increment_job: (row.aggregate_jobs ?? []).some(isLiveIncrementJob),
    };
  });
}
