import { supabase } from '../client';
import { assertValidUuid } from '@/lib/utils/uuid';
import type { Tables } from '@/types/database';
import type { Match, MatchWithPlayers, MatchStatus, GameSummary, GameSource } from '@/types/match';
import type { MatchRecord } from '@/lib/tournament/types';

type MatchRow = Tables<'matches'>;

function toMatch(row: MatchRow): Match {
  return {
    id: row.id,
    round_id: row.round_id,
    tournament_id: row.tournament_id,
    player_1_id: row.player_1_id,
    player_2_id: row.player_2_id,
    winner_id: row.winner_id,
    status: row.status as MatchStatus,
    submitter_id: row.submitter_id,
    date_played: row.date_played,
    scheduled_at: row.scheduled_at,
    auto_confirm_at: row.auto_confirm_at,
    confirmed_at: row.confirmed_at,
    notes: row.notes,
    social_image_url: row.social_image_url,
    bracket_side: (row.bracket_side as Match['bracket_side']) ?? null,
    bracket_pos: row.bracket_pos,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

type PlayerJoin = { name: string; avatar_url?: string | null };
type GameJoin = {
  id: string;
  game_number: number;
  winner_id: string | null;
  replay_url: string;
  source: string;
  stats_locked: boolean;
};
type RoundJoin = { status: string };
type MatchWithPlayersRow = MatchRow & {
  player_1: PlayerJoin;
  player_2: PlayerJoin;
  winner: PlayerJoin | null;
  games: GameJoin[];
  round: RoundJoin;
};
type MatchWithTournamentRow = MatchWithPlayersRow & {
  tournaments: { name: string };
};

function toMatchWithPlayers(row: MatchWithPlayersRow): MatchWithPlayers {
  return {
    ...toMatch(row),
    player_1_name: row.player_1.name,
    player_2_name: row.player_2.name,
    player_1_avatar_url: row.player_1.avatar_url ?? null,
    player_2_avatar_url: row.player_2.avatar_url ?? null,
    winner_name: row.winner?.name ?? null,
    round_status: (row.round?.status ?? 'pending') as MatchWithPlayers['round_status'],
    games: (row.games ?? [])
      .sort((a, b) => a.game_number - b.game_number)
      .map((g): GameSummary => ({
        id: g.id,
        game_number: g.game_number,
        winner_id: g.winner_id,
        replay_url: g.replay_url,
        source: g.source as GameSource,
        stats_locked: g.stats_locked ?? false,
      })),
  };
}

const MATCH_WITH_PLAYERS_SELECT = `
  *,
  player_1:players!matches_player_1_id_fkey ( name, avatar_url ),
  player_2:players!matches_player_2_id_fkey ( name, avatar_url ),
  winner:players!matches_winner_id_fkey ( name ),
  games ( id, game_number, winner_id, replay_url, source, stats_locked ),
  round:rounds!matches_round_id_fkey ( status )
`;

/**
 * Per-tournament cap of the batched read (`getMatchesByTournamentIds`), the
 * cap the per-stage read had when it was introduced. `getMatchesByTournament`
 * no longer caps at it: it pages to `TOURNAMENT_MATCH_MAX_PAGES`.
 */
const MATCHES_PER_TOURNAMENT_LIMIT = 500;

/**
 * The PostgREST `max_rows` ceiling (`supabase/config.toml`). A response of
 * exactly this many rows may have been truncated server-side without an
 * error, so batched reads page in chunks of this size.
 */
const POSTGREST_MAX_ROWS = 1000;

/** List all matches with optional filters (admin use) */
export async function listAllMatches(filters?: {
  tournament_id?: string;
  status?: MatchStatus;
}): Promise<MatchWithPlayers[]> {
  let query = supabase
    .from('matches')
    .select(MATCH_WITH_PLAYERS_SELECT)
    .order('created_at', { ascending: false })
    .limit(200);

  if (filters?.tournament_id) {
    query = query.eq('tournament_id', filters.tournament_id);
  }
  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data.map((row: MatchWithPlayersRow) => toMatchWithPlayers(row));
}

/** List all matches with tournament name context (admin use) */
export async function listAllMatchesWithTournament(filters?: {
  tournament_id?: string;
  status?: MatchStatus;
}): Promise<MatchWithTournament[]> {
  const selectWithTournament = `
    *,
    player_1:players!matches_player_1_id_fkey ( name, avatar_url ),
    player_2:players!matches_player_2_id_fkey ( name, avatar_url ),
    winner:players!matches_winner_id_fkey ( name ),
    games ( id, game_number, winner_id, replay_url, source, stats_locked ),
    round:rounds!matches_round_id_fkey ( status ),
    tournaments!inner ( name )
  `;

  let query = supabase
    .from('matches')
    .select(selectWithTournament)
    .order('created_at', { ascending: false })
    .limit(200);

  if (filters?.tournament_id) {
    query = query.eq('tournament_id', filters.tournament_id);
  }
  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data.map((row: MatchWithTournamentRow) => ({
    ...toMatchWithPlayers(row),
    tournament_name: row.tournaments.name,
  }));
}

export async function getMatchesByRound(roundId: string): Promise<MatchWithPlayers[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_WITH_PLAYERS_SELECT)
    .eq('round_id', roundId);

  if (error) throw error;
  return data.map((row: MatchWithPlayersRow) => toMatchWithPlayers(row));
}

/** Pages `getMatchesByTournament` reads at most: 10 000 matches in one tournament. */
const TOURNAMENT_MATCH_MAX_PAGES = 10;

/**
 * Every match of one tournament (or league stage), with players, games and
 * round status, oldest first (`created_at`, then `id`).
 *
 * The public tournament page, its bracket and standings, broadcast standings
 * and bracket generation read it, so it must not stop short: a read capped
 * at a row count without an order would drop arbitrary matches. It pages
 * with `.range()` in `max_rows` chunks until a short page (the stable order
 * is what makes paging safe), so a tournament of fewer than 1000 matches is
 * still ONE query. It stops after `TOURNAMENT_MATCH_MAX_PAGES` and logs that
 * (disclosed, not masked): the newest matches past the bound are not read.
 */
export async function getMatchesByTournament(
  tournamentId: string
): Promise<MatchWithPlayers[]> {
  const rows: MatchWithPlayersRow[] = [];
  for (let page = 0; page < TOURNAMENT_MATCH_MAX_PAGES; page++) {
    const from = page * POSTGREST_MAX_ROWS;
    const { data, error } = await supabase
      .from('matches')
      .select(MATCH_WITH_PLAYERS_SELECT)
      .eq('tournament_id', tournamentId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + POSTGREST_MAX_ROWS - 1);

    if (error) throw error;
    rows.push(...(data as MatchWithPlayersRow[]));
    if (data.length < POSTGREST_MAX_ROWS) return rows.map(toMatchWithPlayers);
  }
  console.warn(
    `[queries/matches] getMatchesByTournament: tournament ${tournamentId} reached the ${TOURNAMENT_MATCH_MAX_PAGES * POSTGREST_MAX_ROWS}-match bound; newer matches are not read`
  );
  return rows.map(toMatchWithPlayers);
}

/**
 * Matches for several tournaments (a league's stages) in one query instead of
 * one `getMatchesByTournament` per stage. Rows come back grouped by
 * tournament id, each group oldest first (`created_at`, then `id`: the
 * per-stage read has no order, so callers cannot depend on one). Every
 * requested id has an entry, empty when the tournament has no matches.
 *
 * PostgREST caps every response at `max_rows` (1000), where the per-stage
 * reads each had their own cap. So the read pages with `.range()` in
 * `max_rows` chunks until a short page, up to the same total the per-stage
 * reads allowed (`MATCHES_PER_TOURNAMENT_LIMIT` per stage). A league of at
 * most 1000 matches is still one query. Reaching that total is logged
 * (disclosed, not masked): the newest matches past it are not returned.
 */
export async function getMatchesByTournamentIds(
  tournamentIds: readonly string[]
): Promise<Map<string, MatchWithPlayers[]>> {
  const unique = [...new Set(tournamentIds)];
  const grouped = new Map<string, MatchWithPlayers[]>(unique.map((id) => [id, []]));
  if (unique.length === 0) return grouped;

  const cap = MATCHES_PER_TOURNAMENT_LIMIT * unique.length;
  const rows: MatchWithPlayersRow[] = [];
  for (let from = 0; from < cap; from += POSTGREST_MAX_ROWS) {
    const to = Math.min(from + POSTGREST_MAX_ROWS, cap) - 1;
    const { data, error } = await supabase
      .from('matches')
      .select(MATCH_WITH_PLAYERS_SELECT)
      .in('tournament_id', unique)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);

    if (error) throw error;
    rows.push(...(data as MatchWithPlayersRow[]));
    if (data.length < to - from + 1) break;
  }

  if (rows.length >= cap) {
    console.warn(
      `[queries/matches] getMatchesByTournamentIds: ${rows.length} rows for ${unique.length} tournaments reached the ${MATCHES_PER_TOURNAMENT_LIMIT}-per-tournament cap; newer matches are not returned`
    );
  }

  for (const row of rows) {
    grouped.get(row.tournament_id)?.push(toMatchWithPlayers(row));
  }
  return grouped;
}

/**
 * One player's scheduled matches in one tournament (a league phase), oldest
 * first (`created_at`, then `id`). For the substitution, which repairs them:
 * filtered on the server, so it reads only this player's rows instead of the
 * whole phase, and paged with `.range()` in `max_rows` chunks until a short
 * page, so none is cut off.
 */
export async function getScheduledMatchesForPlayerInTournament(
  tournamentId: string,
  playerId: string,
): Promise<MatchWithPlayers[]> {
  assertValidUuid(playerId, 'playerId');
  const rows: MatchWithPlayersRow[] = [];
  for (let from = 0; ; from += POSTGREST_MAX_ROWS) {
    const to = from + POSTGREST_MAX_ROWS - 1;
    const { data, error } = await supabase
      .from('matches')
      .select(MATCH_WITH_PLAYERS_SELECT)
      .eq('tournament_id', tournamentId)
      .eq('status', 'scheduled')
      .or(`player_1_id.eq.${playerId},player_2_id.eq.${playerId}`)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);

    if (error) throw error;
    rows.push(...(data as MatchWithPlayersRow[]));
    if (data.length < POSTGREST_MAX_ROWS) break;
  }
  return rows.map(toMatchWithPlayers);
}

/** Pages `getTournamentPairings` reads at most: 20 000 matches in one phase. */
const PAIRING_MAX_PAGES = 20;

/** Who met whom in one tournament, and whether the read stopped at its bound. */
export interface TournamentPairings {
  pairings: Array<{ player_1_id: string; player_2_id: string }>;
  /** True when the read stopped at its bound: the newest matches were not read. */
  truncated: boolean;
}

/**
 * The pairings of every match in one tournament, any status, oldest first
 * (`created_at`, then `id`). Only the two player ids, so a large phase stays
 * cheap (no game rows). Paged with `.range()` in `max_rows` chunks until a
 * short page, up to `PAIRING_MAX_PAGES`; a read that stops there says so
 * (`truncated`), and the caller discloses it.
 */
export async function getTournamentPairings(tournamentId: string): Promise<TournamentPairings> {
  const pairings: TournamentPairings['pairings'] = [];
  for (let page = 0; page < PAIRING_MAX_PAGES; page++) {
    const from = page * POSTGREST_MAX_ROWS;
    const { data, error } = await supabase
      .from('matches')
      .select('player_1_id, player_2_id')
      .eq('tournament_id', tournamentId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + POSTGREST_MAX_ROWS - 1);

    if (error) throw error;
    pairings.push(...data);
    if (data.length < POSTGREST_MAX_ROWS) return { pairings, truncated: false };
  }
  console.warn(
    `[queries/matches] getTournamentPairings: tournament ${tournamentId} reached the ${PAIRING_MAX_PAGES * POSTGREST_MAX_ROWS}-match bound; newer matches are not read`
  );
  return { pairings, truncated: true };
}

/**
 * Targeted H2H query — fetches only completed matches between two specific players
 * in a tournament. Returns 1-5 matches instead of loading the entire tournament.
 */
export async function getH2HBetweenPlayers(
  player1Id: string,
  player2Id: string,
  tournamentId: string
): Promise<MatchWithPlayers[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_WITH_PLAYERS_SELECT)
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .or(
      `and(player_1_id.eq.${player1Id},player_2_id.eq.${player2Id}),and(player_1_id.eq.${player2Id},player_2_id.eq.${player1Id})`
    );

  if (error) throw error;
  return data.map((row: MatchWithPlayersRow) => toMatchWithPlayers(row));
}

/**
 * Get only completed matches for a tournament. Avoids transferring pending/in-progress
 * match data when the caller only needs completed results (e.g. standings, H2H).
 */
export async function getCompletedMatchesByTournament(
  tournamentId: string
): Promise<MatchWithPlayers[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_WITH_PLAYERS_SELECT)
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .limit(500);

  if (error) throw error;
  return data.map((row: MatchWithPlayersRow) => toMatchWithPlayers(row));
}

export async function getMatchById(id: string): Promise<MatchWithPlayers | null> {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_WITH_PLAYERS_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toMatchWithPlayers(data as MatchWithPlayersRow) : null;
}

export async function getMatchesByPlayer(
  playerId: string,
  tournamentId?: string
): Promise<MatchWithPlayers[]> {
  assertValidUuid(playerId, 'playerId');
  let query = supabase
    .from('matches')
    .select(MATCH_WITH_PLAYERS_SELECT)
    .or(`player_1_id.eq.${playerId},player_2_id.eq.${playerId}`)
    .order('date_played', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (tournamentId) {
    query = query.eq('tournament_id', tournamentId);
  }

  const { data, error } = await query.limit(500);

  if (error) throw error;
  return data.map((row: MatchWithPlayersRow) => toMatchWithPlayers(row));
}

/**
 * Get a player's upcoming matches — those that have not yet been played out.
 * Filters to the pre-play / unresolved statuses from the match state machine
 * (`scheduled` → `in_progress`); pending_confirmation/disputed/completed are
 * excluded since those already have a result. Ordered by scheduled time
 * (unscheduled matches last). Used by the AI agent's upcoming-matches tool.
 */
export async function getUpcomingMatches(
  playerId: string
): Promise<MatchWithPlayers[]> {
  assertValidUuid(playerId, 'playerId');
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_WITH_PLAYERS_SELECT)
    .or(`player_1_id.eq.${playerId},player_2_id.eq.${playerId}`)
    .in('status', ['scheduled', 'in_progress'] satisfies MatchStatus[])
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .limit(100);

  if (error) throw error;
  return data.map((row: MatchWithPlayersRow) => toMatchWithPlayers(row));
}

export interface MatchWithTournament extends MatchWithPlayers {
  tournament_name: string;
}

/**
 * Get all matches for a player with tournament name context.
 * Used by the profile page to show match history with tournament attribution.
 */
export async function getMatchesByPlayerWithTournament(
  playerId: string
): Promise<MatchWithTournament[]> {
  const selectWithTournament = `
    *,
    player_1:players!matches_player_1_id_fkey ( name, avatar_url ),
    player_2:players!matches_player_2_id_fkey ( name, avatar_url ),
    winner:players!matches_winner_id_fkey ( name ),
    games ( id, game_number, winner_id, replay_url, source, stats_locked ),
    round:rounds!matches_round_id_fkey ( status ),
    tournaments!inner ( name )
  `;

  assertValidUuid(playerId, 'playerId');
  const { data, error } = await supabase
    .from('matches')
    .select(selectWithTournament)
    .or(`player_1_id.eq.${playerId},player_2_id.eq.${playerId}`)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw error;

  return data.map((row: MatchWithTournamentRow) => ({
    ...toMatchWithPlayers(row),
    tournament_name: row.tournaments.name,
  }));
}

export async function createMatch(input: {
  round_id: string;
  tournament_id: string;
  player_1_id: string;
  player_2_id: string;
}): Promise<Match> {
  const { data, error } = await supabase
    .from('matches')
    .insert({
      round_id: input.round_id,
      tournament_id: input.tournament_id,
      player_1_id: input.player_1_id,
      player_2_id: input.player_2_id,
    })
    .select()
    .single();

  if (error) throw error;
  return toMatch(data);
}

type MatchBatchInput = {
  round_id: string;
  tournament_id: string;
  player_1_id: string;
  player_2_id: string;
  bracket_side?: string | null;
  bracket_pos?: number | null;
};

function isPostgresUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

async function fetchMatchByBracketSlot(
  roundId: string,
  bracketSide: string,
  bracketPos: number
): Promise<Match | null> {
  const { data, error } = await supabase
    .from('matches')
    .select()
    .eq('round_id', roundId)
    .eq('bracket_side', bracketSide)
    .eq('bracket_pos', bracketPos)
    .maybeSingle();

  if (error) throw error;
  return data ? toMatch(data as MatchRow) : null;
}

async function insertMatchRow(input: MatchBatchInput): Promise<Match> {
  const { data, error } = await supabase
    .from('matches')
    .insert(input)
    .select()
    .single();

  if (error) throw error;
  return toMatch(data);
}

async function recoverMatchBatch(matches: MatchBatchInput[]): Promise<Match[]> {
  const recovered: Match[] = [];
  for (const input of matches) {
    if (input.bracket_pos != null && input.bracket_side) {
      const existing = await fetchMatchByBracketSlot(
        input.round_id,
        input.bracket_side,
        input.bracket_pos
      );
      if (existing) {
        recovered.push(existing);
        continue;
      }
    }
    try {
      recovered.push(await insertMatchRow(input));
    } catch (retryErr) {
      if (!isPostgresUniqueViolation(retryErr)) throw retryErr;
      if (input.bracket_pos != null && input.bracket_side) {
        const existing = await fetchMatchByBracketSlot(
          input.round_id,
          input.bracket_side,
          input.bracket_pos
        );
        if (existing) {
          recovered.push(existing);
          continue;
        }
      }
      throw retryErr;
    }
  }
  return recovered;
}

export async function createMatchBatch(
  matches: MatchBatchInput[]
): Promise<Match[]> {
  const { data, error } = await supabase
    .from('matches')
    .insert(matches)
    .select();

  if (!error) return data.map(toMatch);
  if (!isPostgresUniqueViolation(error)) throw error;
  return recoverMatchBatch(matches);
}

export async function updateMatchPlayers(
  id: string,
  player1Id: string,
  player2Id: string
): Promise<Match> {
  const { data, error } = await supabase
    .from('matches')
    .update({
      player_1_id: player1Id,
      player_2_id: player2Id,
      winner_id: null,
      status: 'scheduled' as MatchStatus,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toMatch(data);
}

export async function deleteMatchesByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('matches').delete().in('id', ids);
  if (error) throw error;
}

export async function updateMatchStatus(
  id: string,
  status: MatchStatus,
  winnerId?: string | null,
  submitterId?: string | null,
  notes?: string | null,
): Promise<Match>;
export async function updateMatchStatus(
  id: string,
  status: MatchStatus,
  winnerId: string | null | undefined,
  submitterId: string | null | undefined,
  notes: string | null | undefined,
  expectedStatus: MatchStatus,
): Promise<Match | null>;
export async function updateMatchStatus(
  id: string,
  status: MatchStatus,
  winnerId?: string | null,
  submitterId?: string | null,
  notes?: string | null,
  expectedStatus?: MatchStatus
): Promise<Match | null> {
  const updates: Record<string, unknown> = { status };
  if (winnerId !== undefined) updates.winner_id = winnerId;
  if (submitterId !== undefined) updates.submitter_id = submitterId;
  if (notes !== undefined) updates.notes = notes;
  if (status === 'completed') {
    const now = new Date().toISOString();
    updates.date_played = now;
    updates.confirmed_at = now;
    updates.auto_confirm_at = null;
  }

  let query = supabase.from('matches').update(updates).eq('id', id);
  if (expectedStatus !== undefined) {
    query = query.eq('status', expectedStatus);
    const { data, error } = await query.select().maybeSingle();
    if (error) throw error;
    return data ? toMatch(data) : null;
  }

  const { data, error } = await query.select().single();
  if (error) throw error;
  return toMatch(data);
}

/**
 * Resets a match to its initial state: scheduled, no winner, no submitter, no date.
 */
export async function resetMatchFields(id: string): Promise<Match> {
  const { data, error } = await supabase
    .from('matches')
    .update({
      status: 'scheduled' as MatchStatus,
      winner_id: null,
      submitter_id: null,
      date_played: null,
      auto_confirm_at: null,
      confirmed_at: null,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toMatch(data);
}

/**
 * Null the generated social preview image URL for a match. `social_image_url`
 * is a plain text column (not an FK) that `resetMatchFields` deliberately
 * omits, so a reset would otherwise leave a stale preview pointing at the
 * prior result. Clearing it lets a re-finalized match rebuild a fresh image.
 */
export async function clearMatchSocialImage(matchId: string): Promise<void> {
  const { error } = await supabase
    .from('matches')
    .update({ social_image_url: null })
    .eq('id', matchId);

  if (error) throw error;
}

/**
 * Re-pair a scheduled/in-progress match and clear any result fields.
 * Caller is responsible for validating admin access and participant eligibility.
 */
export async function repairMatchPairing(
  id: string,
  player1Id: string,
  player2Id: string
): Promise<MatchWithPlayers> {
  const { data, error } = await supabase
    .from('matches')
    .update({
      player_1_id: player1Id,
      player_2_id: player2Id,
      winner_id: null,
      submitter_id: null,
      date_played: null,
      scheduled_at: null,
      auto_confirm_at: null,
      confirmed_at: null,
      status: 'scheduled' as MatchStatus,
    })
    .eq('id', id)
    .select(MATCH_WITH_PLAYERS_SELECT)
    .single();

  if (error) throw error;
  return toMatchWithPlayers(data as MatchWithPlayersRow);
}

/** What `repairScheduledMatchPairing` did. */
export type ScheduledMatchRepair =
  /** The pairing now names the given players. */
  | 'repaired'
  /** Nothing written: the match has game rows (a result is being or was reported). */
  | 'has_games'
  /**
   * Nothing written: the match is no longer scheduled, or no longer names the
   * expected players (a result report or another pairing change landed).
   */
  | 'changed';

/**
 * Re-pair a match the substitution planned to repair, only while it is still
 * as planned: scheduled, without games, and between the expected players.
 * `repairMatchPairing` updates by id alone, so a result reported between the
 * plan and the write would be wiped and its games re-attributed.
 *
 * Two steps, the game count and then one conditional UPDATE (status and both
 * player ids in the filter): a report that set the status in between is
 * caught by the UPDATE. Only a game row inserted after the count while the
 * status is still `scheduled` can pass, a window of one round trip.
 */
export async function repairScheduledMatchPairing(
  id: string,
  expected: { player_1_id: string; player_2_id: string },
  next: { player_1_id: string; player_2_id: string },
): Promise<ScheduledMatchRepair> {
  const { count, error: countError } = await supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', id);
  if (countError) throw countError;
  if ((count ?? 0) > 0) return 'has_games';

  const { data, error } = await supabase
    .from('matches')
    .update({
      player_1_id: next.player_1_id,
      player_2_id: next.player_2_id,
      winner_id: null,
      submitter_id: null,
      date_played: null,
      scheduled_at: null,
      auto_confirm_at: null,
      confirmed_at: null,
    })
    .eq('id', id)
    .eq('status', 'scheduled')
    .eq('player_1_id', expected.player_1_id)
    .eq('player_2_id', expected.player_2_id)
    .select('id');

  if (error) throw error;
  return data.length > 0 ? 'repaired' : 'changed';
}

/** Set or clear a match's scheduled battle time. */
export async function updateMatchSchedule(
  id: string,
  scheduledAt: string | null
): Promise<MatchWithPlayers> {
  assertValidUuid(id, 'match id');

  const { data, error } = await supabase
    .from('matches')
    .update({ scheduled_at: scheduledAt })
    .eq('id', id)
    .select(MATCH_WITH_PLAYERS_SELECT)
    .single();

  if (error) throw error;
  return toMatchWithPlayers(data as MatchWithPlayersRow);
}

/** Update auto-confirm timing metadata for a pending confirmation match. */
export async function updateMatchConfirmationTiming(
  id: string,
  input: {
    auto_confirm_at?: string | null;
    confirmed_at?: string | null;
  }
): Promise<MatchWithPlayers> {
  assertValidUuid(id, 'match id');

  const { data, error } = await supabase
    .from('matches')
    .update(input)
    .eq('id', id)
    .select(MATCH_WITH_PLAYERS_SELECT)
    .single();

  if (error) throw error;
  return toMatchWithPlayers(data as MatchWithPlayersRow);
}

/** Pending confirmations whose auto-confirm timer has elapsed. */
export async function listMatchesReadyForAutoConfirm(
  nowIso = new Date().toISOString(),
  limit = 50
): Promise<MatchWithPlayers[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_WITH_PLAYERS_SELECT)
    .eq('status', 'pending_confirmation')
    .not('auto_confirm_at', 'is', null)
    .lte('auto_confirm_at', nowIso)
    .order('auto_confirm_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data.map((row) => toMatchWithPlayers(row as MatchWithPlayersRow));
}

export interface DownstreamMatchSnapshot {
  tournament_id: string;
  winner_id: string | null;
  round_id: string;
}

/**
 * Checks whether the winner of this match appears as a player in any
 * later-round match within the same tournament (bracket advancement).
 * Used to warn admins before resetting a match in elimination brackets.
 *
 * Pass `snapshot` when the live row may already have been reset (winner
 * cleared) — callers must capture tournament/winner/round before
 * `resetMatchFields`.
 */
export async function hasDownstreamMatches(
  matchId: string,
  snapshot?: DownstreamMatchSnapshot
): Promise<boolean> {
  let tournamentId: string;
  let winnerId: string | null;
  let roundId: string;

  if (snapshot) {
    tournamentId = snapshot.tournament_id;
    winnerId = snapshot.winner_id;
    roundId = snapshot.round_id;
  } else {
    const { data: match, error: matchErr } = await supabase
      .from('matches')
      .select('tournament_id, winner_id, round_id')
      .eq('id', matchId)
      .single();

    if (matchErr) throw matchErr;
    tournamentId = match.tournament_id;
    winnerId = match.winner_id;
    roundId = match.round_id;
  }

  if (!winnerId) return false;

  const { data: round, error: roundErr } = await supabase
    .from('rounds')
    .select('round_number')
    .eq('id', roundId)
    .single();

  if (roundErr) throw roundErr;

  // Find later rounds in this tournament
  const { data: laterRounds, error: lrErr } = await supabase
    .from('rounds')
    .select('id')
    .eq('tournament_id', tournamentId)
    .gt('round_number', round.round_number);

  if (lrErr) throw lrErr;
  if (!laterRounds.length) return false;

  const laterRoundIds = laterRounds.map((r) => r.id);

  // Check if the winner appears as a player in any later-round match
  const { data: downstream, error: dsErr } = await supabase
    .from('matches')
    .select('id')
    .in('round_id', laterRoundIds)
    .or(`player_1_id.eq.${winnerId},player_2_id.eq.${winnerId}`)
    .limit(1);

  if (dsErr) throw dsErr;
  return downstream.length > 0;
}

/**
 * Get match records for standings computation.
 * Only returns completed matches with their winner.
 */
export async function getCompletedMatchRecords(
  tournamentId: string
): Promise<MatchRecord[]> {
  const { data, error } = await supabase
    .from('matches')
    .select('player_1_id, player_2_id, winner_id, rounds!inner( round_number )')
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .limit(2000);

  if (error) throw error;

  return data.map((row) => ({
    player_1_id: row.player_1_id,
    player_2_id: row.player_2_id,
    winner_id: row.winner_id,
    round_number: (row.rounds as { round_number: number }).round_number,
  }));
}

/**
 * Batch-fetch completed match records for multiple tournaments in a single query.
 * Returns a Map keyed by tournament_id. Used by profile composition
 * to avoid N+1 queries when computing standings.
 */
export async function getCompletedMatchRecordsBatch(
  tournamentIds: string[]
): Promise<Map<string, MatchRecord[]>> {
  if (tournamentIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('matches')
    .select('tournament_id, player_1_id, player_2_id, winner_id, rounds!inner( round_number )')
    .in('tournament_id', tournamentIds)
    .eq('status', 'completed')
    .limit(2000);

  if (error) throw error;

  const result = new Map<string, MatchRecord[]>();
  for (const row of data) {
    const record: MatchRecord = {
      player_1_id: row.player_1_id,
      player_2_id: row.player_2_id,
      winner_id: row.winner_id,
      round_number: (row.rounds as { round_number: number }).round_number,
    };
    const list = result.get(row.tournament_id) ?? [];
    list.push(record);
    result.set(row.tournament_id, list);
  }

  return result;
}

export async function updateMatchSocialImageUrl(
  matchId: string,
  socialImageUrl: string | null,
): Promise<void> {
  assertValidUuid(matchId);
  const { error } = await supabase
    .from('matches')
    .update({ social_image_url: socialImageUrl })
    .eq('id', matchId);
  if (error) throw error;
}

/**
 * Get the set of player IDs that have at least one completed match
 * across the given tournaments. Used for team visibility checks.
 */
export async function getPlayerIdsWithCompletedMatches(
  tournamentIds: string[]
): Promise<Set<string>> {
  if (tournamentIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from('matches')
    .select('player_1_id, player_2_id')
    .in('tournament_id', tournamentIds)
    .eq('status', 'completed');

  if (error) throw error;

  const result = new Set<string>();
  for (const row of data) {
    result.add(row.player_1_id);
    result.add(row.player_2_id);
  }
  return result;
}
