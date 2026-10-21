import { supabase } from '../client';

type ReplayLibraryGameRow = {
  id: string;
  game_number: number;
  replay_url: string;
  created_at: string;
  matches: {
    id: string;
    tournament_id: string;
    date_played: string | null;
    player_1: { name: string; ps_username: string | null } | null;
    player_2: { name: string; ps_username: string | null } | null;
    rounds: { name: string } | null;
    tournaments: {
      name: string;
      seasons: { name: string } | null;
    } | null;
  };
};

export interface ReplayLibraryRow {
  label: string;
  date: string;
  league: string;
  tournamentName: string;
  round: string;
  matchNumber: number;
  player1Name: string;
  player1PsUsername: string;
  player2Name: string;
  player2PsUsername: string;
  matchUrl: string;
  replayUrl: string;
}

const REPLAY_LIBRARY_SELECT = `
  id,
  game_number,
  replay_url,
  created_at,
  matches!inner (
    id,
    tournament_id,
    date_played,
    player_1:players!matches_player_1_id_fkey ( name, ps_username ),
    player_2:players!matches_player_2_id_fkey ( name, ps_username ),
    rounds!matches_round_id_fkey ( name ),
    tournaments!inner (
      name,
      seasons ( name )
    )
  )
`;

/**
 * Sentinels written for missing joins. They are English search text (the
 * row `label`); pages map them to localized copy at render.
 */
export const UNKNOWN_PLAYER = 'Unknown';
export const UNKNOWN_LEAGUE = 'Unknown league';
export const UNKNOWN_ROUND = 'Unknown round';

function toReplayLibraryRow(row: ReplayLibraryGameRow): ReplayLibraryRow {
  const player1Name = row.matches.player_1?.name ?? UNKNOWN_PLAYER;
  const player1PsUsername = row.matches.player_1?.ps_username ?? '';
  const player2Name = row.matches.player_2?.name ?? UNKNOWN_PLAYER;
  const player2PsUsername = row.matches.player_2?.ps_username ?? '';
  const league = row.matches.tournaments?.seasons?.name ?? UNKNOWN_LEAGUE;
  const tournamentName = row.matches.tournaments?.name ?? '';
  const round = row.matches.rounds?.name ?? UNKNOWN_ROUND;
  const matchNumber = row.game_number;

  const labelParts = [
    `${player1Name} vs ${player2Name}`,
    league,
    round,
    `match ${matchNumber}`,
  ];

  return {
    label: labelParts.join(', '),
    date: row.matches.date_played ?? row.created_at,
    league,
    tournamentName,
    round,
    matchNumber,
    player1Name,
    player1PsUsername,
    player2Name,
    player2PsUsername,
    matchUrl: `/tournaments/${row.matches.tournament_id}/matches/${row.matches.id}`,
    replayUrl: row.replay_url,
  };
}

/**
 * Rows per request when reading the whole library. PostgREST caps every
 * response at `max_rows` (1000 here), so a single unbounded read silently
 * dropped everything past the 1000th replay.
 */
export const REPLAY_LIBRARY_READ_CHUNK = 1000;

/** PostgREST's code for an `offset` past the end of a counted result. */
const RANGE_NOT_SATISFIABLE = 'PGRST103';

type ChunkResult = {
  data: unknown[] | null;
  error: { code?: string } | null;
  count: number | null;
};

/**
 * Read every row of a query in `REPLAY_LIBRARY_READ_CHUNK`-sized `.range()`
 * pages. The first page carries `count: 'exact'`, and paging continues until
 * that many rows arrived, so a server `max_rows` smaller than the chunk cannot
 * truncate the result either.
 */
async function readAllChunks<T>(
  fetchChunk: (from: number, to: number, withCount: boolean) => PromiseLike<ChunkResult>,
): Promise<T[]> {
  const rows: T[] = [];
  let total: number | null = null;
  while (total === null || rows.length < total) {
    const from = rows.length;
    const { data, error, count } = await fetchChunk(
      from,
      from + REPLAY_LIBRARY_READ_CHUNK - 1,
      total === null,
    );
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    if (total === null) total = count ?? chunk.length;
    if (chunk.length === 0) break; // rows were deleted while paging
    rows.push(...chunk);
  }
  return rows;
}

type CountOption = { count: 'exact'; head?: boolean };

/** The replay-library base query: parsed Showdown replays with a URL. */
function replayLibraryGames(select: string, countOption?: CountOption) {
  return supabase
    .from('games')
    .select(select, countOption)
    .eq('parsed', true)
    .eq('source', 'ps_replay')
    .neq('replay_url', '');
}

/**
 * Every replay row, newest first. Used by the filtered replay-library views,
 * which match free text across joined fields in memory. With `limit`, one
 * capped read (for widgets that show the latest few).
 */
export async function listReplayLibraryRows(limit?: number): Promise<ReplayLibraryRow[]> {
  if (typeof limit === 'number') {
    const { data, error } = await supabase
      .from('games')
      .select(REPLAY_LIBRARY_SELECT)
      .eq('parsed', true)
      .eq('source', 'ps_replay')
      .neq('replay_url', '')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data.map((row) => toReplayLibraryRow(row as ReplayLibraryGameRow));
  }

  const rows = await readAllChunks<ReplayLibraryGameRow>((from, to, withCount) =>
    replayLibraryGames(REPLAY_LIBRARY_SELECT, withCount ? { count: 'exact' } : undefined)
      .order('created_at', { ascending: false })
      // Unique tiebreaker so rows sharing a created_at never repeat or vanish between chunks.
      .order('id', { ascending: false })
      .range(from, to),
  );

  // A replay inserted mid-read shifts later offsets by one; drop the repeat.
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  return unique.map(toReplayLibraryRow);
}

export interface ReplayLibraryPage {
  rows: ReplayLibraryRow[];
  /** Replays in the whole library (for the pager). */
  total: number;
  /** The page actually served: a page past the end is clamped to the last one. */
  page: number;
}

export interface ReplayLibraryPageOptions {
  page: number;
  perPage: number;
  /** Date sort direction; the date is the match's play date, else the game's creation time. */
  ascending: boolean;
}

async function fetchReplayLibraryPage(
  page: number,
  perPage: number,
  ascending: boolean,
): Promise<ChunkResult> {
  const from = (page - 1) * perPage;
  const { data, error, count } = await replayLibraryGames(REPLAY_LIBRARY_SELECT, { count: 'exact' })
    // Sort by the match's play date (a to-one related column). A null date
    // means the match is still in progress, so it counts as the newest.
    .order('matches(date_played)', { ascending, nullsFirst: !ascending })
    .order('created_at', { ascending })
    .order('id', { ascending })
    .range(from, from + perPage - 1);
  return { data: data as unknown[] | null, error, count };
}

/**
 * One page of the unfiltered library, read with `.range()` and an exact
 * count instead of loading every replay and slicing in memory.
 */
export async function listReplayLibraryPage(
  options: ReplayLibraryPageOptions,
): Promise<ReplayLibraryPage> {
  const perPage = Math.max(1, Math.floor(options.perPage));
  let page = Math.max(1, Math.floor(options.page));

  let result = await fetchReplayLibraryPage(page, perPage, options.ascending);
  const pastEnd =
    result.error?.code === RANGE_NOT_SATISFIABLE ||
    (!result.error && page > 1 && (result.data ?? []).length === 0);

  if (pastEnd) {
    // A stale or hand-typed ?page= beyond the end: serve the last page.
    let total = result.error ? null : result.count;
    if (total === null) {
      const { count, error } = await replayLibraryGames(REPLAY_LIBRARY_SELECT, {
        count: 'exact',
        head: true,
      });
      if (error) throw error;
      total = count ?? 0;
    }
    page = Math.max(1, Math.ceil(total / perPage));
    result = await fetchReplayLibraryPage(page, perPage, options.ascending);
  }

  if (result.error) throw result.error;
  const data = (result.data ?? []) as ReplayLibraryGameRow[];
  return {
    rows: data.map(toReplayLibraryRow),
    total: result.count ?? data.length,
    page,
  };
}

/** The fields the replay-library filter dropdowns are built from. */
export type ReplayLibraryFacetRow = Pick<ReplayLibraryRow, 'league' | 'tournamentName' | 'round'>;

type ReplayLibraryFacetGameRow = {
  matches: {
    rounds: { name: string } | null;
    tournaments: { name: string; seasons: { name: string } | null } | null;
  };
};

const REPLAY_LIBRARY_FACET_SELECT = `
  matches!inner (
    rounds!matches_round_id_fkey ( name ),
    tournaments!inner (
      name,
      seasons ( name )
    )
  )
`;

/**
 * League, tournament and round names for every replay (about a fifth of a
 * full row), so the unfiltered page can fill its dropdowns without loading
 * whole rows. Same fallbacks as {@link listReplayLibraryRows}.
 */
export async function listReplayLibraryFacetRows(): Promise<ReplayLibraryFacetRow[]> {
  const rows = await readAllChunks<ReplayLibraryFacetGameRow>((from, to, withCount) =>
    replayLibraryGames(REPLAY_LIBRARY_FACET_SELECT, withCount ? { count: 'exact' } : undefined)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  );
  return rows.map((row) => ({
    league: row.matches.tournaments?.seasons?.name ?? UNKNOWN_LEAGUE,
    tournamentName: row.matches.tournaments?.name ?? '',
    round: row.matches.rounds?.name ?? UNKNOWN_ROUND,
  }));
}
