import type { Player } from '@/types/player';
import type { TablePageSize } from '@/lib/ui/table-params';

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

/** Query string of the player directory request: one page, optionally filtered. */
export function rosterQuery(params: { page: number; perPage: number; search: string }): string {
  const query = new URLSearchParams({
    limit: String(params.perPage),
    offset: String((Math.max(params.page, 1) - 1) * params.perPage),
  });
  const search = params.search.trim();
  if (search) query.set('search', search);
  return query.toString();
}

/** The last page that still holds rows, for stepping back after the final row of a page goes. */
export function lastPage(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage));
}
