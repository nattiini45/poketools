/**
 * Contract of the admin command-menu index (`GET /api/admin/command-index`) shared by the route and the menu. Pure
 * and client-safe: no server-only imports.
 */

/** Entries the index carries at most, newest first; an admin with more competitions finds the rest through the lists. */
export const COMMAND_INDEX_LIMIT = 500;

/** One competition the viewer may open from the command menu. Ids and names only: no player or ruleset data. */
export interface CommandIndexEntry {
  id: string;
  name: string;
  /** A league, or a tournament that belongs to no league (a league's phases are reached through the league). */
  kind: 'league' | 'tournament';
  archived: boolean;
}

/** The admin page of an entry: the league workspace, or the standalone tournament's rounds page. */
export function commandIndexHref(entry: Pick<CommandIndexEntry, 'id' | 'kind'>): string {
  return entry.kind === 'league' ? `/admin/leagues/${entry.id}` : `/admin/tournaments/${entry.id}/rounds`;
}
