/**
 * The warnings a league restore returns (`league_trash_restore` -> `warnings`, and the same list in the body of the
 * restore route), and the one parser of them. The server-only queries parse the RPC result with it and the client
 * parses the route body with it, so a new warning code is added here once.
 *
 * Pure and client-safe: no reads, no `server-only`.
 */
import { isRecord, stringItems } from './json';

/** A thing the restore did that the superadmin should read. */
export type LeagueTrashRestoreWarning =
  | { code: 'parent_missing_nulled'; rel: string; column: string; count: number }
  | { code: 'replay_hash_released'; count: number }
  | { code: 'columns_ignored'; rel: string; columns: string[] };

/** The known warnings of a JSON value; a malformed or unknown entry is dropped. */
export function parseRestoreWarnings(value: unknown): LeagueTrashRestoreWarning[] {
  if (!Array.isArray(value)) return [];
  const out: LeagueTrashRestoreWarning[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    if (raw.code === 'parent_missing_nulled' && typeof raw.rel === 'string' && typeof raw.column === 'string' && typeof raw.count === 'number') {
      out.push({ code: 'parent_missing_nulled', rel: raw.rel, column: raw.column, count: raw.count });
    } else if (raw.code === 'replay_hash_released' && typeof raw.count === 'number') {
      out.push({ code: 'replay_hash_released', count: raw.count });
    } else if (raw.code === 'columns_ignored' && typeof raw.rel === 'string') {
      out.push({ code: 'columns_ignored', rel: raw.rel, columns: stringItems(raw.columns) });
    }
  }
  return out;
}
