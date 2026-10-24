import type { Player } from '@/types/player';
import { TABLE_PAGE_SIZES, type ColumnSortState, type TablePageSize } from '@/lib/ui/table-params';
import { isPlayerSortColumn } from '@/lib/players/player-sort';

/** Rows per roster page at first: one of the table's page sizes, within the API's limit of 200. */
export const DEFAULT_ROSTER_PAGE_SIZE: TablePageSize = 50;

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

/**
 * An `<input type="datetime-local">` value is wall-clock time in the admin's
 * zone with no offset. Sent as it is, the server would read it in its own
 * zone. This turns it into the instant it means, as an ISO 8601 string with an
 * offset (`...Z`), or null when it is empty or not a valid local date-time.
 */
export function localDateTimeToIso(local: string): string | null {
  if (!LOCAL_DATETIME.test(local)) return null;
  // A date-time without an offset is read as local time (ECMAScript date-time string format).
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export type RosterDialog = 'suspend' | 'ban';

/** Which discipline dialog is open: exactly one, or none without a target. */
export function openDialog(target: Player | null, action: RosterDialog): RosterDialog | null {
  return target ? action : null;
}

/**
 * Query string of the player directory request: one page, optionally filtered
 * and ordered. The table's sortable column keys are the API's sort columns, so
 * `sort` goes out as `sort=<column>&dir=<direction>`; no sort (or a key the API
 * does not order by) leaves the server's default order.
 */
export function rosterQuery(params: {
  page: number;
  perPage: number;
  search: string;
  sort?: ColumnSortState | null;
}): string {
  const query = new URLSearchParams({
    limit: String(params.perPage),
    offset: String((Math.max(params.page, 1) - 1) * params.perPage),
  });
  const search = params.search.trim();
  if (search) query.set('search', search);
  if (params.sort && isPlayerSortColumn(params.sort.key)) {
    query.set('sort', params.sort.key);
    query.set('dir', params.sort.direction);
  }
  return query.toString();
}

/** The last page that still holds rows, for stepping back after the final row of a page goes. */
export function lastPage(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage));
}

/** What the roster shows: the loading line, a first-load failure on its own, or the table. */
export type RosterView = 'loading' | 'blocked' | 'table';

/**
 * `loaded`: the first request settled. `hasLoadedOnce`: some request returned rows. `hasLoadError`:
 * the latest request failed. A failed first load has nothing to show (and no way to tell an empty
 * directory from an unreachable one), so it blocks; a refresh that fails after rows arrived keeps
 * those rows on screen.
 */
export function rosterView(state: { loaded: boolean; hasLoadedOnce: boolean; hasLoadError: boolean }): RosterView {
  if (!state.loaded) return 'loading';
  if (state.hasLoadError && !state.hasLoadedOnce) return 'blocked';
  return 'table';
}

export type RosterConfirmKind =
  | 'makeAdmin'
  | 'removeAdmin'
  | 'makeCreator'
  | 'removeCreator'
  | 'delete'
  | 'reinstate';

/** Which confirmation a click on a role badge opens: granting or revoking, from the current flag. */
export function roleConfirmKind(
  player: Pick<Player, 'is_admin' | 'is_creator'>,
  field: 'is_admin' | 'is_creator',
): Extract<RosterConfirmKind, 'makeAdmin' | 'removeAdmin' | 'makeCreator' | 'removeCreator'> {
  if (field === 'is_admin') return player.is_admin ? 'removeAdmin' : 'makeAdmin';
  return player.is_creator ? 'removeCreator' : 'makeCreator';
}

/** The roster's URL state: the search text, the server sort, the 1-based page and the page size. */
export interface RosterUrlState {
  q: string;
  sort: ColumnSortState | null;
  page: number;
  perPage: TablePageSize;
}

export const ROSTER_SEARCH_MAX_LENGTH = 100;
/** The last page a URL may name; a larger value is a bad link and falls back to page 1. */
export const ROSTER_MAX_PAGE = 1000;

/**
 * Reads the roster's query string (`q`, `sort`, `dir`, `page`, `perPage`). A value that is not
 * valid degrades to its default instead of failing, so a hand-edited link still opens the roster.
 */
export function parseRosterUrl(params: { get(name: string): string | null }): RosterUrlState {
  const sortKey = params.get('sort') ?? '';
  const dir = params.get('dir');
  const rawPage = params.get('page') ?? '';
  const page = /^\d{1,6}$/.test(rawPage) ? Number(rawPage) : 1;
  const rawPerPage = Number(params.get('perPage') ?? '');
  return {
    q: (params.get('q') ?? '').slice(0, ROSTER_SEARCH_MAX_LENGTH),
    sort: isPlayerSortColumn(sortKey) ? { key: sortKey, direction: dir === 'desc' ? 'desc' : 'asc' } : null,
    page: page >= 1 && page <= ROSTER_MAX_PAGE ? page : 1,
    perPage: TABLE_PAGE_SIZES.find((size) => size === rawPerPage) ?? DEFAULT_ROSTER_PAGE_SIZE,
  };
}

/** The query string (without `?`) for a roster state; defaults are left out. */
export function buildRosterSearch(state: RosterUrlState): string {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q);
  if (state.sort && isPlayerSortColumn(state.sort.key)) {
    params.set('sort', state.sort.key);
    params.set('dir', state.sort.direction);
  }
  if (state.page > 1) params.set('page', String(state.page));
  if (state.perPage !== DEFAULT_ROSTER_PAGE_SIZE) params.set('perPage', String(state.perPage));
  return params.toString();
}

/**
 * Brings a freshly shown notice into view: on a long page the table pushes it off screen. Does
 * nothing for a missing node or an environment without `scrollIntoView`.
 */
export function revealNotice(node: { scrollIntoView?: (options?: ScrollIntoViewOptions) => void } | null): void {
  node?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
}
