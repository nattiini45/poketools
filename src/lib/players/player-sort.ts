/**
 * Sort contract of the site-admin player directory (`GET /api/players?sort=&dir=`).
 * Client-safe: the route and `listPlayers` validate and apply it, the roster
 * table maps its column headers onto it. Only the columns listed here can be
 * ordered by, so a request never names an arbitrary column.
 */

/** Columns the directory can be ordered by (database column names). */
export const PLAYER_SORT_COLUMNS = ['name', 'discord_id', 'ps_username', 'status'] as const;

export type PlayerSortColumn = (typeof PLAYER_SORT_COLUMNS)[number];
export type PlayerSortDirection = 'asc' | 'desc';

export interface PlayerSort {
  column: PlayerSortColumn;
  direction: PlayerSortDirection;
}

/** The order without a `sort` parameter. */
export const DEFAULT_PLAYER_SORT: PlayerSort = { column: 'name', direction: 'asc' };

export function isPlayerSortColumn(value: string): value is PlayerSortColumn {
  return (PLAYER_SORT_COLUMNS as readonly string[]).includes(value);
}
