import type {
  ReplayLibraryFacetRow,
  ReplayLibraryRow,
} from '@/lib/supabase/queries/replay-library';
import {
  parseSortParam,
  type ColumnSortState,
} from '@/lib/ui/table-params';

export type ReplayLibrarySortColumn = 'date' | 'players' | 'league' | 'round';

export type ReplayLibrarySort =
  | `${ReplayLibrarySortColumn}-asc`
  | `${ReplayLibrarySortColumn}-desc`;

export interface ReplayLibraryParams {
  query: string;
  league: string;
  tournament: string;
  round: string;
  startDate: string;
  endDate: string;
  sort: ReplayLibrarySort;
}

const VALID_SORT_COLUMNS: ReplayLibrarySortColumn[] = ['date', 'players', 'league', 'round'];

const DEFAULT_SORT: ColumnSortState = { key: 'date', direction: 'desc' };

function isValidDateParam(value: string | undefined): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '');
}

function toIsoDateOnly(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function toReplayLibrarySort(state: ColumnSortState): ReplayLibrarySort {
  return `${state.key as ReplayLibrarySortColumn}-${state.direction}` as ReplayLibrarySort;
}

export function parseReplayLibraryParams(
  params: Record<string, string | undefined>,
): ReplayLibraryParams {
  const legacyUsername = params.username?.trim() ?? '';
  const queryBase = params.q?.trim() ?? '';
  const query =
    legacyUsername.length > 0
      ? [queryBase, legacyUsername].filter(Boolean).join(' ').trim()
      : queryBase;

  const sortState = parseSortParam(params.sort, VALID_SORT_COLUMNS, {
    column: DEFAULT_SORT.key,
    direction: DEFAULT_SORT.direction,
  });

  return {
    query,
    league: params.league?.trim() ?? '',
    tournament: params.tournament?.trim() ?? '',
    round: params.round?.trim() ?? '',
    startDate: isValidDateParam(params.start?.trim()) ? params.start!.trim() : '',
    endDate: isValidDateParam(params.end?.trim()) ? params.end!.trim() : '',
    sort: toReplayLibrarySort(sortState),
  };
}

/**
 * True when no filter is active and the sort is by date, so the page can be
 * served straight from one `.range()` page of the database instead of
 * loading every replay (the free-text search matches joined fields and still
 * runs in memory).
 */
export function isReplayLibraryBrowseView(params: ReplayLibraryParams): boolean {
  return (
    params.query.length === 0 &&
    params.league.length === 0 &&
    params.tournament.length === 0 &&
    params.round.length === 0 &&
    params.startDate.length === 0 &&
    params.endDate.length === 0 &&
    params.sort.startsWith('date-')
  );
}

export function applyReplayLibraryParams(
  rows: ReplayLibraryRow[],
  params: ReplayLibraryParams,
): ReplayLibraryRow[] {
  const queryTokens = params.query.toLowerCase().split(/\s+/).filter(Boolean);

  const filtered = rows.filter((row) => {
    const haystack = [
      row.label,
      row.league,
      row.tournamentName,
      row.round,
      row.player1Name,
      row.player1PsUsername,
      row.player2Name,
      row.player2PsUsername,
    ]
      .join(' ')
      .toLowerCase();

    const matchesQuery =
      queryTokens.length === 0 || queryTokens.every((token) => haystack.includes(token));
    const matchesLeague = params.league.length === 0 || row.league === params.league;
    const matchesTournament =
      params.tournament.length === 0 || row.tournamentName === params.tournament;
    const matchesRound = params.round.length === 0 || row.round === params.round;
    const rowDate = toIsoDateOnly(row.date);
    const matchesStartDate = params.startDate.length === 0 || rowDate >= params.startDate;
    const matchesEndDate = params.endDate.length === 0 || rowDate <= params.endDate;
    return (
      matchesQuery &&
      matchesLeague &&
      matchesTournament &&
      matchesRound &&
      matchesStartDate &&
      matchesEndDate
    );
  });

  const sortState = parseSortParam(params.sort, VALID_SORT_COLUMNS, {
    column: DEFAULT_SORT.key,
    direction: DEFAULT_SORT.direction,
  });

  return [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortState.key === 'date') {
      cmp = a.date.localeCompare(b.date);
    } else if (sortState.key === 'league') {
      cmp = `${a.league} ${a.round}`.localeCompare(`${b.league} ${b.round}`, undefined, {
        sensitivity: 'base',
        numeric: true,
      });
    } else if (sortState.key === 'players') {
      cmp = `${a.player1Name} ${a.player2Name}`.localeCompare(
        `${b.player1Name} ${b.player2Name}`,
        undefined,
        { sensitivity: 'base', numeric: true },
      );
    } else if (sortState.key === 'round') {
      cmp = a.round.localeCompare(b.round, undefined, { sensitivity: 'base', numeric: true });
    }
    return sortState.direction === 'asc' ? cmp : -cmp;
  });
}

function getUniqueSortedValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }),
  );
}

export function getReplayLibraryLeagueOptions(rows: ReplayLibraryFacetRow[]): string[] {
  return getUniqueSortedValues(rows.map((row) => row.league));
}

export function getReplayLibraryTournamentOptions(rows: ReplayLibraryFacetRow[]): string[] {
  return getUniqueSortedValues(rows.map((row) => row.tournamentName));
}

export function getReplayLibraryRoundOptions(rows: ReplayLibraryFacetRow[]): string[] {
  return getUniqueSortedValues(rows.map((row) => row.round));
}

export function buildReplayLibraryHref(
  current: Record<string, string | undefined>,
  updates: Record<string, string | undefined>,
): string {
  const merged = { ...current, ...updates };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value && value.length > 0) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/replays?${qs}` : '/replays';
}
