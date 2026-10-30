import { supabase } from '../client';
import { assertValidUuid } from '@/lib/utils/uuid';
import { ilikeAnyOf, postgrestQuoted } from '@/lib/supabase/postgrest-filter';
import { readBoundedPages } from '@/lib/supabase/read-bounded-pages';
import { releaseTeamsFromMatches } from './teams';
import type { Tables } from '@/types/database';
import type { Match, MatchWithPlayers, MatchStatus, GameSummary, GameSource } from '@/types/match';
import type { MatchRecord } from '@/lib/tournament/types';
import {
  ADMIN_MATCH_AUTO_CONFIRM_SOON_HOURS,
  ADMIN_MATCH_DEFAULT_SORT,
  ADMIN_MATCH_SEARCH_PLAYER_CAP,
  ADMIN_MATCH_STALE_IN_PROGRESS_DAYS,
  ADMIN_MATCH_STATUSES,
  ADMIN_MATCH_STATUS_PRIORITY,
  type ADMIN_MATCH_BRACKET_TYPES,
  type ADMIN_MATCH_FORMAT_TYPES,
  type AdminMatchDateField,
  type AdminMatchPreset,
  type AdminMatchSort,
} from '@/lib/admin/match-list';

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

// ── Admin match list (paged, filtered on the server) ────────────────

/** A match row of the admin list: the tournament (phase) and, for a league phase, its league. */
export interface AdminMatchRow extends MatchWithTournament {
  /** The league (season) the tournament is a phase of; null for a standalone tournament. */
  season_id: string | null;
  season_name: string | null;
  /** The league is a test league. */
  season_is_test: boolean;
  /** The tournament or its league is archived. */
  archived: boolean;
  round_name: string;
  round_number: number;
  best_of: number;
  round_deadline: string | null;
}

export interface AdminMatchPage {
  rows: AdminMatchRow[];
  /** Matches that satisfy the filters, across all pages. */
  total: number;
}

export interface AdminMatchListParams {
  /** Tournaments the caller may see; null = every tournament (site admin). An empty list yields an empty page. */
  tournamentIds: string[] | null;
  /** Only tournaments that belong to no league. */
  standaloneOnly?: boolean;
  statuses?: MatchStatus[];
  /** Matches where either seat is one of these players. Callers return early on an empty search result. */
  playerIds?: string[];
  /** One match, by id. */
  matchId?: string;
  /** 1-based. */
  page: number;
  pageSize: number;
  roundId?: string;
  /** League format (`seasons.format_type`). */
  formatType?: (typeof ADMIN_MATCH_FORMAT_TYPES)[number];
  bracketType?: (typeof ADMIN_MATCH_BRACKET_TYPES)[number];
  bestOf?: number;
  rulesetId?: string;
  /** One date column in a half-open window `[from, to)`, or unset (`none`). */
  date?: { field: AdminMatchDateField; from?: string; to?: string; none?: boolean };
  /** Matches with this player in either seat. */
  playerId?: string;
  /** With `playerId`: only the matches of these two players (either seat each). */
  player2Id?: string;
  /** `has`: a game with a replay URL. `none`: no game with one. */
  replay?: 'has' | 'none';
  /** A game whose stats were edited by hand (`stats_locked`). */
  handEdited?: boolean;
  hasNotes?: boolean;
  /** No game recorded at all. */
  noGames?: boolean;
  preset?: AdminMatchPreset;
  /** The clock of the presets (default: now). */
  now?: Date;
  /** Keep the matches of test leagues (default: hidden). */
  includeTest?: boolean;
  /** Keep the matches of archived leagues and tournaments (default: hidden). */
  includeArchived?: boolean;
  /** Default `created_desc`. */
  sort?: AdminMatchSort;
}

/**
 * The display shape of a page of matches. Read by id AFTER the ids were chosen (`listAdminMatchesPage`), with no
 * filter on it, so a filter on an embed can never shrink `games` (the row's score and replay count).
 */
const ADMIN_MATCH_HYDRATE_SELECT = `
  *,
  player_1:players!matches_player_1_id_fkey ( name, avatar_url ),
  player_2:players!matches_player_2_id_fkey ( name, avatar_url ),
  winner:players!matches_winner_id_fkey ( name ),
  games ( id, game_number, winner_id, replay_url, source, stats_locked ),
  round:rounds!matches_round_id_fkey ( status, name, round_number, best_of, deadline ),
  tournaments!inner ( name, season_id, archived, seasons ( name, is_test_season, archived ) )
`;

type AdminMatchRowRaw = MatchWithPlayersRow & {
  round: RoundJoin & { name: string; round_number: number; best_of: number; deadline: string | null };
  tournaments: {
    name: string;
    season_id: string | null;
    archived: boolean;
    seasons: { name: string; is_test_season: boolean; archived: boolean } | null;
  };
};

function toAdminMatchRow(row: AdminMatchRowRaw): AdminMatchRow {
  return {
    ...toMatchWithPlayers(row),
    tournament_name: row.tournaments.name,
    season_id: row.tournaments.season_id,
    season_name: row.tournaments.seasons?.name ?? null,
    season_is_test: row.tournaments.seasons?.is_test_season ?? false,
    archived: row.tournaments.archived || (row.tournaments.seasons?.archived ?? false),
    round_name: row.round.name,
    round_number: row.round.round_number,
    best_of: row.round.best_of,
    round_deadline: row.round.deadline,
  };
}

/** PostgREST answers an offset past the last row with this code when a count is requested. */
const RANGE_NOT_SATISFIABLE = 'PGRST103';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The column of each date a date filter can name. */
const DATE_COLUMNS: Record<AdminMatchDateField, string> = {
  scheduled: 'scheduled_at',
  played: 'date_played',
  created: 'created_at',
  updated: 'updated_at',
};

/** The statuses each preset can match. */
const PRESET_STATUSES: Record<AdminMatchPreset, readonly MatchStatus[]> = {
  awaiting_confirmation: ['pending_confirmation'],
  auto_confirms_soon: ['pending_confirmation'],
  stale_in_progress: ['in_progress'],
  overdue: ADMIN_MATCH_STATUSES.filter((status) => status !== 'completed'),
};

/**
 * The status set of a request: the status tab narrowed by the preset. null =
 * every status; an empty array = nothing can match (the caller skips the read).
 */
function effectiveStatuses(params: AdminMatchListParams): MatchStatus[] | null {
  const requested = params.statuses && params.statuses.length > 0 ? params.statuses : null;
  if (!params.preset) return requested;
  const allowed = PRESET_STATUSES[params.preset];
  return (requested ?? [...allowed]).filter((status) => allowed.includes(status));
}

/** Throws before any request is built: every id that reaches a filter string is a uuid. */
function assertParamIds(params: AdminMatchListParams): void {
  if (params.matchId) assertValidUuid(params.matchId, 'matchId');
  if (params.roundId) assertValidUuid(params.roundId, 'roundId');
  if (params.rulesetId) assertValidUuid(params.rulesetId, 'rulesetId');
  if (params.playerId) assertValidUuid(params.playerId, 'playerId');
  if (params.player2Id) assertValidUuid(params.player2Id, 'playerId');
  for (const id of params.playerIds ?? []) assertValidUuid(id, 'playerId');
}

/** Whether the content filters contradict each other (nothing can match; the route refuses them with a 400). */
function contentFiltersContradict(params: AdminMatchListParams): boolean {
  const needsGame = params.replay === 'has' || params.handEdited === true;
  const needsNoGame = params.noGames === true || params.replay === 'none';
  return (needsGame && needsNoGame) || (params.replay === 'none' && params.handEdited === true);
}

/**
 * Ids of the leagues hidden from the request (test leagues unless `includeTest`, archived leagues unless
 * `includeArchived`), in `ID_CHUNK` groups, or none when nothing is hidden. A phase can stay unarchived inside an
 * archived league, so the tournament's own flag alone does not hide the league's matches.
 */
async function listHiddenSeasonIdChunks(params: AdminMatchListParams): Promise<string[][]> {
  // Standalone tournaments belong to no league, so a standalone request has nothing to hide.
  if (params.standaloneOnly) return [];
  const hidden = [
    params.includeTest ? null : 'is_test_season.eq.true',
    params.includeArchived ? null : 'archived.eq.true',
  ].filter((condition) => condition !== null);
  if (hidden.length === 0) return [];
  const rows = await readAllRows<{ id: string }>((from, to) =>
    supabase.from('seasons').select('id').or(hidden.join(',')).order('id').range(from, to)
  );
  // The ids travel in the request URL: a handful of hidden leagues is the norm; hundreds would need another shape.
  const chunks: string[][] = [];
  for (let i = 0; i < rows.length; i += ID_CHUNK) {
    const chunk = rows.slice(i, i + ID_CHUNK).map((row) => row.id);
    for (const id of chunk) assertValidUuid(id, 'seasonId');
    chunks.push(chunk);
  }
  return chunks;
}

interface LeanContext {
  now: Date;
  hiddenSeasonChunks: string[][];
}

/**
 * The lean select of the id read: `id`, plus an embed ONLY when a filter or the sort reads a column of it. Each
 * embed is `!inner` where it filters the parent, so the count and the page agree.
 */
function leanSelect(params: AdminMatchListParams, ctx: LeanContext): string {
  const formatFilter = Boolean(params.formatType);
  const tournamentEmbed =
    Boolean(params.standaloneOnly) ||
    !params.includeArchived ||
    ctx.hiddenSeasonChunks.length > 0 ||
    Boolean(params.bracketType) ||
    Boolean(params.rulesetId) ||
    formatFilter;
  const sort = params.sort ?? ADMIN_MATCH_DEFAULT_SORT;
  // A filter on the embed reads the real column, but an ORDER BY on a to-one embed reads the embed's own select list.
  const deadlineSort = sort.startsWith('deadline_');
  const roundEmbed = params.bestOf !== undefined || params.preset === 'overdue' || deadlineSort;
  const gamesInner = params.replay === 'has' || params.handEdited === true;
  const gamesAnti = !gamesInner && (params.noGames === true || params.replay === 'none');

  const parts = ['id'];
  if (tournamentEmbed) parts.push(formatFilter ? 'tournaments!inner ( id, seasons!inner ( id ) )' : 'tournaments!inner ( id )');
  if (roundEmbed) parts.push(deadlineSort ? 'rounds!inner ( id, deadline )' : 'rounds!inner ( id )');
  if (gamesInner) parts.push('games!inner ( id )');
  else if (gamesAnti) parts.push('games ( id )');
  return parts.join(', ');
}

/**
 * The id query behind the page, the segment pages and the head counts: one factory, so a count can never disagree
 * with the rows it counts. `statuses` is the already-narrowed status set (null = every status).
 */
function buildLeanQuery(
  params: AdminMatchListParams,
  ctx: LeanContext,
  statuses: MatchStatus[] | null,
  head: boolean
) {
  let query = supabase.from('matches').select(leanSelect(params, ctx), { count: 'exact', head });
  if (params.tournamentIds !== null) query = query.in('tournament_id', params.tournamentIds);
  if (params.standaloneOnly) query = query.is('tournaments.season_id', null);
  if (statuses !== null) query = query.in('status', statuses);
  if (params.matchId) query = query.eq('id', params.matchId);
  if (params.roundId) query = query.eq('round_id', params.roundId);
  if (params.formatType) query = query.eq('tournaments.seasons.format_type', params.formatType);
  if (params.bracketType) query = query.eq('tournaments.bracket_type', params.bracketType);
  if (params.rulesetId) query = query.eq('tournaments.ruleset_id', params.rulesetId);
  if (params.bestOf !== undefined) query = query.eq('rounds.best_of', params.bestOf);

  if (params.date) {
    const column = DATE_COLUMNS[params.date.field];
    if (params.date.none) {
      query = query.is(column, null);
    } else {
      if (params.date.from) query = query.gte(column, params.date.from);
      if (params.date.to) query = query.lt(column, params.date.to);
    }
  }

  if (params.playerId && params.player2Id) {
    const [a, b] = [params.playerId, params.player2Id];
    query = query.or(
      `and(player_1_id.eq.${a},player_2_id.eq.${b}),and(player_1_id.eq.${b},player_2_id.eq.${a})`
    );
  } else if (params.playerId) {
    query = query.or(`player_1_id.eq.${params.playerId},player_2_id.eq.${params.playerId}`);
  }
  if (params.playerIds && params.playerIds.length > 0) {
    const list = params.playerIds.join(',');
    // A second or() is ANDed with the first by PostgREST.
    query = query.or(`player_1_id.in.(${list}),player_2_id.in.(${list})`);
  }

  if (params.replay === 'has') query = query.neq('games.replay_url', '');
  if (params.handEdited) query = query.eq('games.stats_locked', true);
  if (params.hasNotes) query = query.neq('notes', '');
  if (params.noGames) {
    // No game at all already means no replay, so it wins over "no replay".
    query = query.is('games', null);
  } else if (params.replay === 'none') {
    // No game WITH a replay: the filter on the embed narrows it, the anti-join keeps the matches left with none.
    query = query.neq('games.replay_url', '').is('games', null);
  }

  if (params.preset === 'auto_confirms_soon') {
    query = query.lte('auto_confirm_at', new Date(ctx.now.getTime() + ADMIN_MATCH_AUTO_CONFIRM_SOON_HOURS * HOUR_MS).toISOString());
  } else if (params.preset === 'stale_in_progress') {
    query = query.lt('updated_at', new Date(ctx.now.getTime() - ADMIN_MATCH_STALE_IN_PROGRESS_DAYS * DAY_MS).toISOString());
  } else if (params.preset === 'overdue') {
    query = query.lt('rounds.deadline', ctx.now.toISOString());
  }

  if (!params.includeArchived) query = query.eq('tournaments.archived', false);
  for (const chunk of ctx.hiddenSeasonChunks) {
    query = query.or(`season_id.is.null,season_id.not.in.(${chunk.join(',')})`, { referencedTable: 'tournaments' });
  }
  return query;
}

type LeanQuery = ReturnType<typeof buildLeanQuery>;

/** Orders by the sort key (nullable keys last in both directions) with `id` as the tiebreaker, so paging is stable. */
function orderLeanQuery(query: LeanQuery, sort: Exclude<AdminMatchSort, 'status_priority'>): LeanQuery {
  switch (sort) {
    case 'scheduled_asc':
    case 'scheduled_desc': {
      const ascending = sort === 'scheduled_asc';
      return query.order('scheduled_at', { ascending, nullsFirst: false }).order('id', { ascending });
    }
    case 'deadline_asc':
    case 'deadline_desc': {
      const ascending = sort === 'deadline_asc';
      return query.order('rounds(deadline)', { ascending, nullsFirst: false }).order('id', { ascending });
    }
    case 'updated_asc':
      return query.order('updated_at', { ascending: true }).order('id', { ascending: true });
    case 'updated_desc':
      return query.order('updated_at', { ascending: false }).order('id', { ascending: false });
    case 'created_desc':
      return query.order('created_at', { ascending: false }).order('id', { ascending: false });
  }
}

interface IdPage {
  ids: string[];
  total: number;
}

const idsOf = (data: unknown): string[] => (data as { id: string }[]).map((row) => row.id);

/** One page of ids in a column order, with the exact total. */
async function readIdsOrdered(
  params: AdminMatchListParams,
  ctx: LeanContext,
  statuses: MatchStatus[] | null,
  sort: Exclude<AdminMatchSort, 'status_priority'>,
  from: number
): Promise<IdPage> {
  const { data, error, count } = await orderLeanQuery(buildLeanQuery(params, ctx, statuses, false), sort).range(
    from,
    from + params.pageSize - 1
  );
  if (error) {
    if (error.code !== RANGE_NOT_SATISFIABLE) throw error;
    // The page is past the last row: report the real total so the caller can step back.
    const { count: total, error: countError } = await buildLeanQuery(params, ctx, statuses, true);
    if (countError) throw countError;
    return { ids: [], total: total ?? 0 };
  }
  const ids = idsOf(data);
  return { ids, total: count ?? ids.length };
}

/**
 * One page of ids in "needs attention first" order. A CASE order does not exist in PostgREST, so the list is a
 * concatenation of one segment per status (disputed first, completed last), each ordered oldest-waiting first
 * (`updated_at`, then `id`): one head count per status gives the total and the segment bounds, and only the
 * segments that overlap the requested window are read.
 */
async function readIdsByStatusPriority(
  params: AdminMatchListParams,
  ctx: LeanContext,
  statuses: MatchStatus[] | null,
  from: number
): Promise<IdPage> {
  const order = ADMIN_MATCH_STATUS_PRIORITY.filter((status) => statuses === null || statuses.includes(status));
  const counts = await Promise.all(
    order.map(async (status) => {
      const { count, error } = await buildLeanQuery(params, ctx, [status], true);
      if (error) throw error;
      return count ?? 0;
    })
  );
  const total = counts.reduce((sum, count) => sum + count, 0);

  const end = from + params.pageSize;
  const segments: { status: MatchStatus; from: number; to: number }[] = [];
  let offset = 0;
  order.forEach((status, index) => {
    const segmentStart = offset;
    offset += counts[index];
    const lo = Math.max(from, segmentStart);
    const hi = Math.min(end, offset);
    if (lo < hi) segments.push({ status, from: lo - segmentStart, to: hi - segmentStart - 1 });
  });

  const pages = await Promise.all(
    segments.map(async (segment) => {
      const { data, error } = await buildLeanQuery(params, ctx, [segment.status], false)
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .range(segment.from, segment.to);
      if (error) throw error;
      return idsOf(data);
    })
  );
  return { ids: pages.flat(), total };
}

/**
 * The display rows of `ids`, in that order; an id that vanished since the id read is skipped. Read in chunks of
 * `ID_CHUNK` ids, so an export of thousands of ids never puts them all in one request URL.
 */
async function hydrateAdminMatches(ids: string[]): Promise<AdminMatchRow[]> {
  if (ids.length === 0) return [];
  const data = await readRowsByIds<AdminMatchRowRaw>(ids, (chunk) =>
    supabase.from('matches').select(ADMIN_MATCH_HYDRATE_SELECT).in('id', chunk)
  );
  const byId = new Map(data.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [toAdminMatchRow(row)] : [];
  });
}

/**
 * One page of matches for the admin list, filtered, sorted and counted by the
 * database, in two reads: first the page's ids and the exact total from a lean
 * select (an embed only where a filter or the sort needs it), then the display
 * shape of those ids with no filter on it. A filter on an embed therefore can
 * never shrink the `games` of a row. `.range()` paging with an exact count, so
 * the `max_rows` ceiling does not hide older matches.
 *
 * The caller decides which tournaments the viewer may see (`tournamentIds`) and
 * whether test and archived leagues are shown (`includeTest`, `includeArchived`,
 * both hidden by default); this function only applies them. Players are
 * embedded in the narrow shape (`name`, `avatar_url`): no private `players`
 * column is selected.
 */
export async function listAdminMatchesPage(params: AdminMatchListParams): Promise<AdminMatchPage> {
  const empty: AdminMatchPage = { rows: [], total: 0 };
  if (params.tournamentIds !== null && params.tournamentIds.length === 0) return empty;
  assertParamIds(params);
  if (contentFiltersContradict(params)) return empty;
  const statuses = effectiveStatuses(params);
  if (statuses !== null && statuses.length === 0) return empty;

  const ctx: LeanContext = { now: params.now ?? new Date(), hiddenSeasonChunks: await listHiddenSeasonIdChunks(params) };
  const sort = params.sort ?? ADMIN_MATCH_DEFAULT_SORT;
  const from = (params.page - 1) * params.pageSize;
  const { ids, total } =
    sort === 'status_priority'
      ? await readIdsByStatusPriority(params, ctx, statuses, from)
      : await readIdsOrdered(params, ctx, statuses, sort, from);
  return { rows: await hydrateAdminMatches(ids), total };
}

export interface AdminMatchExport {
  rows: AdminMatchRow[];
  /** Matches that satisfy the filters, however many `rows` were read. */
  total: number;
  /** More than `cap` matches satisfy the filters: the set was cut at the cap. */
  truncated: boolean;
}

/**
 * The whole filtered set of the admin list for the CSV export, up to `cap` rows. Filters, scope and sort are those of
 * `listAdminMatchesPage` (the same lean query and id readers, here at the largest page the API serves), so the file
 * holds exactly the rows the list pages through. The ids are paged with ONE `LeanContext`, so the presets see one
 * clock for the whole export; an id that shifts between two pages (a write in between) is kept once. The display rows
 * are then read in chunks of `ID_CHUNK` ids.
 */
export async function listAdminMatchesForExport(
  params: Omit<AdminMatchListParams, 'page' | 'pageSize'>,
  cap: number
): Promise<AdminMatchExport> {
  const empty: AdminMatchExport = { rows: [], total: 0, truncated: false };
  if (params.tournamentIds !== null && params.tournamentIds.length === 0) return empty;
  const paged: AdminMatchListParams = { ...params, page: 1, pageSize: POSTGREST_MAX_ROWS };
  assertParamIds(paged);
  if (contentFiltersContradict(paged)) return empty;
  const statuses = effectiveStatuses(paged);
  if (statuses !== null && statuses.length === 0) return empty;

  const ctx: LeanContext = { now: params.now ?? new Date(), hiddenSeasonChunks: await listHiddenSeasonIdChunks(paged) };
  const sort = params.sort ?? ADMIN_MATCH_DEFAULT_SORT;
  const seen = new Set<string>();
  const ids: string[] = [];
  let total = 0;
  for (let from = 0; ; from += POSTGREST_MAX_ROWS) {
    const page =
      sort === 'status_priority'
        ? await readIdsByStatusPriority(paged, ctx, statuses, from)
        : await readIdsOrdered(paged, ctx, statuses, sort, from);
    total = page.total;
    for (const id of page.ids) {
      if (ids.length >= cap) break;
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    // Done when enough ids were collected or the last (short or empty) page was read.
    if (ids.length >= Math.min(total, cap) || page.ids.length < POSTGREST_MAX_ROWS) break;
  }
  const rows = await hydrateAdminMatches(ids);
  // Cut only when matches beyond the cap exist. Comparing with `rows.length` would also fire for an id that vanished
  // between the id read and the hydrate read, or a set that grew by a write meanwhile, with the cap not reached.
  return { rows, total, truncated: total > cap };
}

/**
 * Ids of the players whose name or Showdown username contains `search`
 * (bounded by `ADMIN_MATCH_SEARCH_PLAYER_CAP`; `truncated` says more match).
 * Only the id column is read. Wildcards in the term are escaped and the
 * pattern is double-quoted, so `50%`, a comma or a parenthesis match literally.
 */
export async function findPlayerIdsForMatchSearch(
  search: string
): Promise<{ ids: string[]; truncated: boolean }> {
  const { data, error } = await supabase
    .from('players')
    .select('id')
    .or(ilikeAnyOf(['name', 'ps_username'], search))
    .order('name')
    .order('id')
    .limit(ADMIN_MATCH_SEARCH_PLAYER_CAP + 1);
  if (error) throw error;
  const ids = (data as { id: string }[]).map((row) => row.id);
  return {
    ids: ids.slice(0, ADMIN_MATCH_SEARCH_PLAYER_CAP),
    truncated: ids.length > ADMIN_MATCH_SEARCH_PLAYER_CAP,
  };
}

/** Ids of every tournament (phase) of a league. A league has a handful; no paging needed. */
export async function listTournamentIdsBySeason(seasonId: string): Promise<string[]> {
  assertValidUuid(seasonId, 'seasonId');
  const { data, error } = await supabase
    .from('tournaments')
    .select('id')
    .eq('season_id', seasonId)
    .order('id')
    .limit(POSTGREST_MAX_ROWS);
  if (error) throw error;
  return (data as { id: string }[]).map((row) => row.id);
}

/**
 * Names of the players with these ids, for the filter chips: `id` and `name`
 * only. `visibleOnly` keeps what the public player directory shows (active,
 * non-test accounts), which is all a resource admin may learn.
 */
export async function listMatchFilterPlayers(
  ids: string[],
  opts: { visibleOnly: boolean }
): Promise<{ id: string; name: string }[]> {
  for (const id of ids) assertValidUuid(id, 'playerId');
  const rows = await readRowsByIds<{ id: string; name: string }>(ids, (chunk) => {
    let query = supabase.from('players').select('id, name').in('id', chunk);
    if (opts.visibleOnly) query = query.eq('status', 'active').eq('is_test_account', false);
    return query.order('id');
  });
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

// ── Admin match filter options ──────────────────────────────────────

export interface AdminMatchPhaseOption {
  id: string;
  name: string;
  stage_order: number;
  archived: boolean;
  ruleset_id: string;
}

export interface AdminMatchLeagueOption {
  id: string;
  name: string;
  status: string;
  archived: boolean;
  is_test_season: boolean;
  phases: AdminMatchPhaseOption[];
}

export interface AdminMatchStandaloneOption {
  id: string;
  name: string;
  status: string;
  archived: boolean;
  ruleset_id: string;
}

export interface AdminMatchRulesetOption {
  id: string;
  name: string;
}

export interface AdminMatchFilterOptions {
  leagues: AdminMatchLeagueOption[];
  /** Standalone tournaments (no league). */
  tournaments: AdminMatchStandaloneOption[];
  /** The rulesets of the tournaments above, by name. */
  rulesets: AdminMatchRulesetOption[];
}

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Ids per `.in()` request, small enough for the request URL. */
const ID_CHUNK = 100;

/** Every row of a query, in `max_rows` chunks until a short page (PostgREST truncates silently). */
export async function readAllRows<T>(page: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += POSTGREST_MAX_ROWS) {
    const { data, error } = await page(from, from + POSTGREST_MAX_ROWS - 1);
    if (error) throw error;
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < POSTGREST_MAX_ROWS) return rows;
  }
}

/** Rows whose id is in `ids`, read in chunks of `ID_CHUNK`. */
export async function readRowsByIds<T>(
  ids: readonly string[],
  read: (chunk: string[]) => PageResult<T>
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const rows: T[] = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const { data, error } = await read(unique.slice(i, i + ID_CHUNK));
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

type TournamentOptionRow = {
  id: string;
  name: string;
  status: string;
  archived: boolean;
  season_id: string | null;
  stage_order: number;
  ruleset_id: string;
};
type SeasonOptionRow = {
  id: string;
  name: string;
  status: string;
  archived: boolean;
  is_test_season: boolean;
};

const TOURNAMENT_OPTION_COLUMNS = 'id, name, status, archived, season_id, stage_order, ruleset_id';
const SEASON_OPTION_COLUMNS = 'id, name, status, archived, is_test_season';

/**
 * The Matches page's league -> phase selects, plus the standalone
 * tournaments and the rulesets they use. Archived rows are included (flagged)
 * so old matches stay reachable. `null` = unrestricted (site admin); lists
 * restrict to a resource admin's tournaments, and to the leagues those belong
 * to or that the admin is assigned to; the rulesets are only those of the
 * tournaments read. All reads page past the `max_rows` ceiling.
 */
export async function listAdminMatchFilterOptions(scope: {
  tournamentIds: string[] | null;
  seasonIds: string[] | null;
}): Promise<AdminMatchFilterOptions> {
  const tournamentRows =
    scope.tournamentIds === null
      ? await readAllRows<TournamentOptionRow>((from, to) =>
          supabase.from('tournaments').select(TOURNAMENT_OPTION_COLUMNS).order('id').range(from, to)
        )
      : await readRowsByIds<TournamentOptionRow>(scope.tournamentIds, (chunk) =>
          supabase.from('tournaments').select(TOURNAMENT_OPTION_COLUMNS).in('id', chunk).order('id')
        );

  const [seasonRows, rulesetRows] = await Promise.all([
    scope.seasonIds === null
      ? readAllRows<SeasonOptionRow>((from, to) =>
          supabase.from('seasons').select(SEASON_OPTION_COLUMNS).order('id').range(from, to)
        )
      : readRowsByIds<SeasonOptionRow>(
          [...scope.seasonIds, ...tournamentRows.flatMap((row) => (row.season_id ? [row.season_id] : []))],
          (chunk) => supabase.from('seasons').select(SEASON_OPTION_COLUMNS).in('id', chunk).order('id')
        ),
    readRowsByIds<AdminMatchRulesetOption>(
      tournamentRows.map((row) => row.ruleset_id),
      (chunk) => supabase.from('ruleset_definition_versions').select('id, name:name_text').in('id', chunk).order('id')
    ),
  ]);

  const phasesBySeason = new Map<string, AdminMatchPhaseOption[]>();
  const tournaments: AdminMatchStandaloneOption[] = [];
  for (const row of tournamentRows) {
    if (row.season_id === null) {
      tournaments.push({
        id: row.id,
        name: row.name,
        status: row.status,
        archived: row.archived,
        ruleset_id: row.ruleset_id,
      });
      continue;
    }
    const phases = phasesBySeason.get(row.season_id) ?? [];
    phases.push({
      id: row.id,
      name: row.name,
      stage_order: row.stage_order,
      archived: row.archived,
      ruleset_id: row.ruleset_id,
    });
    phasesBySeason.set(row.season_id, phases);
  }

  const byArchivedThenName = (a: { archived: boolean; name: string }, b: { archived: boolean; name: string }) =>
    Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name);

  const leagues = seasonRows
    .map((season): AdminMatchLeagueOption => ({
      id: season.id,
      name: season.name,
      status: season.status,
      archived: season.archived,
      is_test_season: season.is_test_season,
      phases: (phasesBySeason.get(season.id) ?? []).sort(
        (a, b) => a.stage_order - b.stage_order || a.name.localeCompare(b.name)
      ),
    }))
    .sort(byArchivedThenName);

  const rulesets = rulesetRows
    .map((row): AdminMatchRulesetOption => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  return { leagues, tournaments: tournaments.sort(byArchivedThenName), rulesets };
}

export interface AdminMatchRoundOption {
  id: string;
  name: string;
  round_number: number;
  bracket_side: string | null;
}

/** The rounds of one tournament for the Matches page's Round select, in play order. */
export async function listAdminMatchRounds(tournamentId: string): Promise<AdminMatchRoundOption[]> {
  assertValidUuid(tournamentId, 'tournamentId');
  const rows = await readAllRows<AdminMatchRoundOption>((from, to) =>
    supabase
      .from('rounds')
      .select('id, name, round_number, bracket_side')
      .eq('tournament_id', tournamentId)
      .order('round_number')
      .order('bracket_side')
      .order('id')
      .range(from, to)
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    round_number: row.round_number,
    bracket_side: row.bracket_side,
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

/**
 * The matches with these ids (unique, each validated as a uuid), read in chunks of `ID_CHUNK` ids. An id
 * with no match is absent from the result; the rest keep the order of `ids`.
 */
export async function getMatchesByIds(ids: string[]): Promise<MatchWithPlayers[]> {
  const unique = [...new Set(ids)];
  for (const id of unique) assertValidUuid(id, 'matchId');
  const rows = await readRowsByIds<MatchWithPlayersRow>(unique, (chunk) =>
    supabase.from('matches').select(MATCH_WITH_PLAYERS_SELECT).in('id', chunk)
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return unique.flatMap((id) => {
    const row = byId.get(id);
    return row ? [toMatchWithPlayers(row)] : [];
  });
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
      // Every status write clears the finalize marker (see updateMatchStatus).
      finalized_at: null,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toMatch(data);
}

/**
 * Hard-delete matches. Their team rows are released first
 * (`releaseTeamsFromMatches`), so a match-prep row never survives the FK's
 * `ON DELETE SET NULL` as a second planned row of its player. Errors propagate.
 */
export async function deleteMatchesByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await releaseTeamsFromMatches(ids);
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
  // Every status write clears the finalize marker: a completion starts a fresh
  // finalize run (which sets it last), and a match that leaves `completed` has
  // no finalized result any more (see markMatchFinalized).
  const updates: Record<string, unknown> = { status, finalized_at: null };
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
      finalized_at: null,
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
      finalized_at: null,
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

/**
 * Admin schedule change: set or clear `scheduled_at` while the match is not
 * completed. Returns null when the match is completed or gone, so a race with
 * a completion writes nothing. `updateMatchSchedule` stays unguarded for the
 * proposal accept flow.
 */
export async function updateOpenMatchSchedule(
  id: string,
  scheduledAt: string | null
): Promise<MatchWithPlayers | null> {
  assertValidUuid(id, 'match id');

  const { data, error } = await supabase
    .from('matches')
    .update({ scheduled_at: scheduledAt })
    .eq('id', id)
    .neq('status', 'completed')
    .select(MATCH_WITH_PLAYERS_SELECT)
    .maybeSingle();

  if (error) throw error;
  return data ? toMatchWithPlayers(data as MatchWithPlayersRow) : null;
}

/**
 * Set a match's scheduled time while the match is not completed (the matches list bulk action): the same one
 * conditional UPDATE as `updateOpenMatchSchedule` (id and status in the filter), so a completion that landed since the
 * caller's read is not overwritten. Null when no row matched (completed meanwhile, or gone); the caller re-reads to
 * tell the two apart.
 */
export async function setMatchScheduledAtIfOpen(id: string, scheduledAt: string): Promise<Match | null> {
  return updateOpenMatchSchedule(id, scheduledAt);
}

/**
 * Replace a match's notes only while the row is unchanged since it was read: a compare-and-set on `updated_at`
 * (`trg_matches_updated` bumps it on every write, so any concurrent writer, the auto-confirm cron included, makes this
 * return null). The notes text itself cannot be the filter: up to 10,000 characters would overflow the request URL.
 */
export async function updateMatchNotesIfUnchanged(
  id: string,
  expectedUpdatedAt: string,
  notes: string
): Promise<Match | null> {
  assertValidUuid(id, 'match id');
  const { data, error } = await supabase
    .from('matches')
    .update({ notes })
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? toMatch(data) : null;
}

/**
 * A non-completing status change and its confirmation timing, written as one
 * row update. `undefined` leaves a field as stored; `null` clears it.
 * Completion goes through `updateMatchStatus` (it stamps date_played /
 * confirmed_at and is followed by finalize).
 */
export interface MatchStatusTransition {
  /** Compare-and-set: the row is written only while it still has this status. */
  expectedStatus: MatchStatus;
  status: Exclude<MatchStatus, 'completed'>;
  winnerId?: string | null;
  submitterId?: string | null;
  autoConfirmAt?: string | null;
  confirmedAt?: string | null;
  datePlayed?: string | null;
}

/**
 * Change a match's status together with its winner, submitter and auto-confirm
 * timing in ONE conditional UPDATE (a PostgREST PATCH is a single statement),
 * so a failure can never leave the new status without its timer, or a stale
 * timer behind. Returns null when the row no longer has
 * `expectedStatus` (a concurrent writer moved it first); nothing is written then.
 */
export async function transitionMatchStatus(
  id: string,
  transition: MatchStatusTransition
): Promise<Match | null> {
  assertValidUuid(id, 'match id');

  const updates: Record<string, unknown> = { status: transition.status, finalized_at: null };
  if (transition.winnerId !== undefined) updates.winner_id = transition.winnerId;
  if (transition.submitterId !== undefined) updates.submitter_id = transition.submitterId;
  if (transition.autoConfirmAt !== undefined) updates.auto_confirm_at = transition.autoConfirmAt;
  if (transition.confirmedAt !== undefined) updates.confirmed_at = transition.confirmedAt;
  if (transition.datePlayed !== undefined) updates.date_played = transition.datePlayed;

  const { data, error } = await supabase
    .from('matches')
    .update(updates)
    .eq('id', id)
    .eq('status', transition.expectedStatus)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data ? toMatch(data) : null;
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

/** Keyset cursor for `listMatchesNeedingFinalize`: the last row of the previous page. */
export interface FinalizeWorklistCursor {
  updated_at: string;
  id: string;
}

/**
 * Completed matches whose finalize did not finish (`finalized_at` still NULL)
 * and that were last written at or before `updatedBeforeIso`, oldest first
 * (`updated_at`, then the unique `id` as tie-breaker). The grace period keeps
 * the heal off a finalize that is still running. Served by the partial index
 * matches_completed_unfinalized_idx.
 *
 * `after` continues a scan behind the last row of the previous page (keyset
 * paging), so a caller can walk past rows it cannot act on (needs-admin rows)
 * without re-reading them.
 */
export async function listMatchesNeedingFinalize(
  updatedBeforeIso: string,
  limit = 25,
  after?: FinalizeWorklistCursor
): Promise<MatchWithPlayers[]> {
  let query = supabase
    .from('matches')
    .select(MATCH_WITH_PLAYERS_SELECT)
    .eq('status', 'completed')
    .is('finalized_at', null)
    .lte('updated_at', updatedBeforeIso);

  if (after) {
    assertValidUuid(after.id, 'cursor match id');
    const at = postgrestQuoted(after.updated_at);
    query = query.or(`updated_at.gt.${at},and(updated_at.eq.${at},id.gt.${postgrestQuoted(after.id)})`);
  }

  const { data, error } = await query
    .order('updated_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data.map((row) => toMatchWithPlayers(row as MatchWithPlayersRow));
}

/**
 * Stamp `finalized_at` once every finalize step succeeded. Conditional on the
 * match still being `completed`: if an admin reset it meanwhile, nothing is
 * written and false is returned (the reset already cleared the marker).
 */
export async function markMatchFinalized(
  id: string,
  finalizedAt = new Date().toISOString()
): Promise<boolean> {
  assertValidUuid(id, 'match id');

  const { data, error } = await supabase
    .from('matches')
    .update({ finalized_at: finalizedAt })
    .eq('id', id)
    .eq('status', 'completed')
    .select('id');

  if (error) throw error;
  return data.length > 0;
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
 * Only returns completed matches with their winner. Pages the full result (oldest first) past the
 * PostgREST `max_rows` ceiling; a result of 1,000 rows or fewer is ONE query.
 */
export async function getCompletedMatchRecords(
  tournamentId: string
): Promise<MatchRecord[]> {
  const { rows } = await readBoundedPages(
    (from, to) =>
      supabase
        .from('matches')
        .select('id, player_1_id, player_2_id, winner_id, rounds!inner( round_number )')
        .eq('tournament_id', tournamentId)
        .eq('status', 'completed')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: `getCompletedMatchRecords tournament ${tournamentId}` },
  );

  return rows.map((row) => ({
    match_id: row.id,
    player_1_id: row.player_1_id,
    player_2_id: row.player_2_id,
    winner_id: row.winner_id,
    round_number: (row.rounds as { round_number: number }).round_number,
  }));
}

/**
 * Batch-fetch completed match records for multiple tournaments in one paged read.
 * Returns a Map keyed by tournament_id. Used by profile composition
 * to avoid N+1 queries when computing standings.
 */
export async function getCompletedMatchRecordsBatch(
  tournamentIds: string[]
): Promise<Map<string, MatchRecord[]>> {
  if (tournamentIds.length === 0) return new Map();

  const { rows } = await readBoundedPages(
    (from, to) =>
      supabase
        .from('matches')
        .select('id, tournament_id, player_1_id, player_2_id, winner_id, rounds!inner( round_number )')
        .in('tournament_id', tournamentIds)
        .eq('status', 'completed')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: `getCompletedMatchRecordsBatch ${tournamentIds.length} tournaments` },
  );

  const result = new Map<string, MatchRecord[]>();
  for (const row of rows) {
    const record: MatchRecord = {
      match_id: row.id,
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

  const { rows } = await readBoundedPages(
    (from, to) =>
      supabase
        .from('matches')
        .select('player_1_id, player_2_id')
        .in('tournament_id', tournamentIds)
        .eq('status', 'completed')
        .order('id', { ascending: true })
        .range(from, to),
    { label: `getPlayerIdsWithCompletedMatches ${tournamentIds.length} tournaments` },
  );

  const result = new Set<string>();
  for (const row of rows) {
    result.add(row.player_1_id);
    result.add(row.player_2_id);
  }
  return result;
}
