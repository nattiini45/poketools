import { supabase } from '../client';
import { assertValidUuid } from '@/lib/utils/uuid';
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
    source: row.source,
    parsed: row.parsed,
    stats_locked: row.stats_locked,
    aggregate_applied_at: row.aggregate_applied_at,
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

export async function createGame(input: GameCreateInput): Promise<Game> {
  const insert: TablesInsert<'games'> = {
    match_id: input.match_id,
    game_number: input.game_number,
    winner_id: input.winner_id,
    replay_url: input.replay_url ?? '',
    source: input.source,
    parsed: input.parsed ?? false,
    exclude_all_time: input.exclude_all_time,
  };

  const { data, error } = await supabase
    .from('games')
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return toGame(data);
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

export async function markGameAggregatesApplied(
  gameId: string,
  appliedAt = new Date().toISOString()
): Promise<Game> {
  const { data, error } = await supabase
    .from('games')
    .update({ aggregate_applied_at: appliedAt })
    .eq('id', gameId)
    .select()
    .single();

  if (error) throw error;
  return toGame(data);
}

export async function clearGameAggregatesApplied(gameId: string): Promise<void> {
  const { error } = await supabase
    .from('games')
    .update({ aggregate_applied_at: null })
    .eq('id', gameId);

  if (error) throw error;
}

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

export async function deleteGameRow(gameId: string): Promise<void> {
  const { error } = await supabase
    .from('games')
    .delete()
    .eq('id', gameId);

  if (error) throw error;
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

  if (error) throw error;
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
}

/**
 * Paginated game list for admin aggregate rebuilds.
 * Only includes games from non-scheduled matches (matches get_total_games_in_scope).
 */
export async function listGamesForAggregateRebuild(
  scopeType: AggregateScope,
  scopeId: string | null,
  offset: number,
  limit: number
): Promise<ScopeGameRow[]> {
  if (scopeType === 'tournament') {
    if (!scopeId) throw new Error('scope_id required for tournament rebuild');
    assertValidUuid(scopeId, 'tournament ID');
  } else if (scopeType === 'league') {
    if (!scopeId) throw new Error('scope_id required for league rebuild');
    assertValidUuid(scopeId, 'season ID');
  }

  let query = supabase
    .from('games')
    .select(`
      id,
      exclude_all_time,
      matches!inner (
        status,
        tournament_id,
        tournaments!inner ( season_id )
      )
    `)
    .neq('matches.status', 'scheduled')
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
    };
  });
}
