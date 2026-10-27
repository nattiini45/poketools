/**
 * Constants of the league recycle bin (`supabase/migrations/20261026091000_league_trash.sql`).
 *
 * `LEAGUE_TRASH_RETENTION_DAYS` is the ONLY place that says how long a deleted league stays restorable. It is passed
 * to `league_trash_delete` as `p_retention_days` (the SQL function has no default) and the database stores the result
 * as `purge_after` when the league is deleted, so changing the constant never shortens or extends an entry that is
 * already in the trash. UI copy that names the window reads this constant too.
 *
 * Pure and client-safe: no reads, no `server-only`.
 */

/** Days a deleted league stays in the trash before the daily cron removes it. */
export const LEAGUE_TRASH_RETENTION_DAYS = 90;

/** Trash rows one run of the expiry cron removes (the function takes the oldest due rows first). */
export const LEAGUE_TRASH_EXPIRE_BATCH = 20;

/** Rows `listLeagueTrash` returns at most (the trash page lists newest first). */
export const LEAGUE_TRASH_LIST_LIMIT = 200;

/**
 * Wall-clock budget of the storage sweeps of one expiry run; leftovers are reported, never retried. The sweep checks it
 * only before it starts a chunk, and a chunk (a parallel list, then a remove) can take two storage timeouts (30 s
 * each, `SUPABASE_STORAGE_TIMEOUT_MS`), so the budget leaves that much room inside the cron route's `maxDuration` (120 s).
 */
export const LEAGUE_TRASH_SWEEP_BUDGET_MS = 45_000;
