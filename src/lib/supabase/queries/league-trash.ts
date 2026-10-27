/**
 * Queries behind the league recycle bin (`league_trash*`, `supabase/migrations/20261026091000_league_trash.sql`).
 * Server only; the routes check access first (delete: `requireAdmin`, restore: `requireSuperadmin`) and these
 * functions run as the service role and enforce nothing themselves.
 *
 * - The three RPC wrappers (`moveLeagueToTrash`, `restoreLeagueFromTrash`, `expireLeagueTrash`) are single database
 *   transactions. A database signal leaves this module as `LeagueTrashDbError` (`toLeagueTrashDbError`); anything else
 *   is rethrown unchanged.
 * - `listLeagueTrash` names its columns and NEVER selects `league_trash_tables` (the captured rows of a league are
 *   megabytes); the trash page needs the counts only.
 * - The rebuild markers: a delete leaves `league_trash.rebuild_pending` and a restore leaves a row in
 *   `league_trash_restore_rebuilds` until the app confirmed its derived-data rebuild
 *   (`markLeagueTrashRebuildDone` / `markLeagueRestoreRebuildDone`). `listPendingLeagueRebuilds` reads both kinds for the
 *   trash page and the season audit, `getPendingLeagueRebuild` reads the one of a trash id for the "run rebuild"
 *   action. An expired trash row whose rebuild is pending is not purged, and a restore refuses it
 *   (`LEAGUE_TRASH_REBUILD_PENDING`: its games would be counted twice).
 * - `countLeagueTrashForPlayer` counts the trashed leagues a player appears in, from the junction table that makes the
 *   database refuse the player's delete.
 */
import 'server-only';

import { supabase } from '../client';
import { isValidUuid } from '@/lib/utils/uuid';
import { LEAGUE_TRASH_EXPIRE_BATCH, LEAGUE_TRASH_LIST_LIMIT, LEAGUE_TRASH_RETENTION_DAYS } from '@/lib/league-trash/constants';
import { toLeagueTrashDbError } from '@/lib/league-trash/db-error';
import { isRecord, stringItems, type JsonRecord } from '@/lib/league-trash/json';
import { parseRestoreWarnings, type LeagueTrashRestoreWarning } from '@/lib/league-trash/restore-warnings';

/** Row counts per captured table, as the trash page shows them. */
export type LeagueTrashCounts = Readonly<Record<string, number>>;

export interface LeagueTrashDeleteResult {
  trash_id: string;
  season_id: string;
  season_name: string;
  deleted_at: string;
  purge_after: string;
  counts: LeagueTrashCounts;
  /** Every player the league touched: the rating and streak rebuild input. */
  player_ids: string[];
  /** The league's phases: cache tags and the tournament-scope aggregate clear. */
  phase_ids: string[];
  /** Running queue drafts that were paused by the delete. */
  frozen_pools: number;
  /** Highest applied migration at delete time (null when the database has no migration ledger). */
  schema_version: string | null;
}

export interface LeagueTrashRestoreResult {
  season_id: string;
  season_name: string;
  /** Rows restored per table. */
  restored: LeagueTrashCounts;
  /** Seconds every running deadline moved by (the time spent in the trash). */
  shift_seconds: number;
  player_ids: string[];
  phase_ids: string[];
  /** Queue drafts that came back paused (an admin resumes them). */
  paused_pools: number;
  /** Increment jobs queued for the aggregate worker (one per restored game with battle stats). */
  queued_aggregate_jobs: number;
  schema_version_at_delete: string | null;
  warnings: LeagueTrashRestoreWarning[];
}

export interface LeagueTrashExpiredRow {
  id: string;
  season_id: string;
  season_name: string;
  deleted_at: string;
  purge_after: string;
  /** The league's match ids, for the social-image storage sweep. */
  match_ids: string[];
}

/** One row of the trash page. No snapshot column. */
export interface LeagueTrashListItem {
  id: string;
  season_id: string;
  season_name: string;
  format_type: string;
  deleted_at: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
  purge_after: string;
  counts: LeagueTrashCounts;
  rebuild_pending: boolean;
  /** Highest migration applied when the league was deleted. Differs from `getLeagueTrashSchemaVersion()` after a deploy. */
  schema_version: string | null;
}

/** A derived-data rebuild the app has not confirmed yet. */
export type PendingLeagueRebuild =
  | { kind: 'delete'; trash_id: string; season_id: string; season_name: string; at: string; phase_ids: string[]; player_ids: string[] }
  | { kind: 'restore'; trash_id: string; season_id: string; season_name: string; at: string; phase_ids: string[]; player_ids: string[] };

const LIST_COLUMNS =
  'id, season_id, season_name, format_type, deleted_at, deleted_by, deleted_by_name, purge_after, counts, rebuild_pending, schema_version';

function asRecord(value: unknown, what: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`[league-trash] ${what} returned an unexpected shape`);
  return value;
}

function str(rec: JsonRecord, key: string): string {
  const v = rec[key];
  if (typeof v !== 'string') throw new Error(`[league-trash] expected a string at "${key}"`);
  return v;
}

function strOrNull(rec: JsonRecord, key: string): string | null {
  const v = rec[key];
  return typeof v === 'string' ? v : null;
}

function num(rec: JsonRecord, key: string): number {
  const v = rec[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`[league-trash] expected a number at "${key}"`);
  return v;
}

function counts(value: unknown): LeagueTrashCounts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(value)) if (typeof n === 'number') out[key] = n;
  return out;
}

/** Rethrows a database error as the typed trash error when it is one of ours, unchanged otherwise. */
function fail(error: unknown): never {
  throw toLeagueTrashDbError(error) ?? error;
}

/**
 * Moves a league to the trash: one transaction freezes its running drafts, captures its rows and deletes them. The
 * retention window is `LEAGUE_TRASH_RETENTION_DAYS`. The caller runs the derived-data rebuild next and then confirms it
 * with `markLeagueTrashRebuildDone`.
 */
export async function moveLeagueToTrash(seasonId: string, actorId: string): Promise<LeagueTrashDeleteResult> {
  const { data, error } = await supabase.rpc('league_trash_delete', {
    p_season_id: seasonId,
    p_actor: actorId,
    p_retention_days: LEAGUE_TRASH_RETENTION_DAYS,
  });
  if (error) fail(error);
  const rec = asRecord(data, 'league_trash_delete');
  return {
    trash_id: str(rec, 'trash_id'),
    season_id: str(rec, 'season_id'),
    season_name: str(rec, 'season_name'),
    deleted_at: str(rec, 'deleted_at'),
    purge_after: str(rec, 'purge_after'),
    counts: counts(rec.counts),
    player_ids: stringItems(rec.player_ids),
    phase_ids: stringItems(rec.phase_ids),
    frozen_pools: num(rec, 'frozen_pools'),
    schema_version: strOrNull(rec, 'schema_version'),
  };
}

/**
 * Restores a league from the trash: one transaction re-inserts its rows with their ids, moves every running deadline by
 * the time spent in the trash and queues the games for the aggregate worker. The caller runs the derived-data rebuild
 * next and then confirms it with `markLeagueRestoreRebuildDone`.
 */
export async function restoreLeagueFromTrash(trashId: string): Promise<LeagueTrashRestoreResult> {
  const { data, error } = await supabase.rpc('league_trash_restore', { p_trash_id: trashId });
  if (error) fail(error);
  const rec = asRecord(data, 'league_trash_restore');
  return {
    season_id: str(rec, 'season_id'),
    season_name: str(rec, 'season_name'),
    restored: counts(rec.restored),
    shift_seconds: num(rec, 'shift_seconds'),
    player_ids: stringItems(rec.player_ids),
    phase_ids: stringItems(rec.phase_ids),
    paused_pools: num(rec, 'paused_pools'),
    queued_aggregate_jobs: num(rec, 'queued_aggregate_jobs'),
    schema_version_at_delete: strOrNull(rec, 'schema_version_at_delete'),
    warnings: parseRestoreWarnings(rec.warnings),
  };
}

/** Removes the trash rows whose retention ended (oldest first, at most `limit`), rebuild-confirmed ones only. */
export async function expireLeagueTrash(now: Date = new Date(), limit: number = LEAGUE_TRASH_EXPIRE_BATCH): Promise<LeagueTrashExpiredRow[]> {
  const { data, error } = await supabase.rpc('league_trash_expire', { p_now: now.toISOString(), p_limit: limit });
  if (error) fail(error);
  if (!Array.isArray(data)) throw new Error('[league-trash] league_trash_expire returned an unexpected shape');
  return data.map((item) => {
    const rec = asRecord(item, 'league_trash_expire row');
    return {
      id: str(rec, 'id'),
      season_id: str(rec, 'season_id'),
      season_name: str(rec, 'season_name'),
      deleted_at: str(rec, 'deleted_at'),
      purge_after: str(rec, 'purge_after'),
      match_ids: stringItems(rec.match_ids),
    };
  });
}

/** The trash page's rows, newest first. Never selects the captured rows. */
export async function listLeagueTrash(): Promise<LeagueTrashListItem[]> {
  const { data, error } = await supabase
    .from('league_trash')
    .select(LIST_COLUMNS)
    .order('deleted_at', { ascending: false })
    .limit(LEAGUE_TRASH_LIST_LIMIT);
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, counts: counts(row.counts) }));
}

/** The trash entry of a league as the routes need it after a delete: its name, end of retention and rebuild inputs. */
export interface LeagueTrashEntry {
  id: string;
  season_name: string;
  purge_after: string;
  phase_ids: string[];
  player_ids: string[];
}

/** The trash entry of a league, or null. Used to tell whether a timed-out delete committed. */
export async function getLeagueTrashBySeason(seasonId: string): Promise<LeagueTrashEntry | null> {
  if (!isValidUuid(seasonId)) return null;
  const { data, error } = await supabase
    .from('league_trash')
    .select('id, season_name, purge_after, phase_ids, player_ids')
    .eq('season_id', seasonId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** How many leagues in the trash a player appears in. The database refuses to delete such a player. */
export async function countLeagueTrashForPlayer(playerId: string): Promise<number> {
  if (!isValidUuid(playerId)) return 0;
  const { count, error } = await supabase
    .from('league_trash_players')
    .select('trash_id', { count: 'exact', head: true })
    .eq('player_id', playerId);
  if (error) throw error;
  return count ?? 0;
}

/** Derived-data rebuilds the app has not confirmed: after a delete (trash rows) and after a restore (tombstones). */
export async function listPendingLeagueRebuilds(): Promise<PendingLeagueRebuild[]> {
  const [trash, restored] = await Promise.all([
    supabase
      .from('league_trash')
      .select('id, season_id, season_name, deleted_at, phase_ids, player_ids')
      .eq('rebuild_pending', true)
      .order('deleted_at')
      .limit(LEAGUE_TRASH_LIST_LIMIT),
    supabase
      .from('league_trash_restore_rebuilds')
      .select('trash_id, season_id, season_name, restored_at, phase_ids, player_ids')
      .order('restored_at')
      .limit(LEAGUE_TRASH_LIST_LIMIT),
  ]);
  if (trash.error) throw trash.error;
  if (restored.error) throw restored.error;
  return [
    ...(trash.data ?? []).map((r): PendingLeagueRebuild => ({
      kind: 'delete',
      trash_id: r.id,
      season_id: r.season_id,
      season_name: r.season_name,
      at: r.deleted_at,
      phase_ids: r.phase_ids,
      player_ids: r.player_ids,
    })),
    ...(restored.data ?? []).map((r): PendingLeagueRebuild => ({
      kind: 'restore',
      trash_id: r.trash_id,
      season_id: r.season_id,
      season_name: r.season_name,
      at: r.restored_at,
      phase_ids: r.phase_ids,
      player_ids: r.player_ids,
    })),
  ];
}

/**
 * The unconfirmed rebuild of one trash id: the delete's (the trash row still has `rebuild_pending`) or, after the
 * restore, the restore's (its tombstone carries the trash id). Null when nothing is pending for the id.
 */
export async function getPendingLeagueRebuild(trashId: string): Promise<PendingLeagueRebuild | null> {
  if (!isValidUuid(trashId)) return null;
  const [trash, restored] = await Promise.all([
    supabase
      .from('league_trash')
      .select('id, season_id, season_name, deleted_at, phase_ids, player_ids')
      .eq('id', trashId)
      .eq('rebuild_pending', true)
      .maybeSingle(),
    supabase
      .from('league_trash_restore_rebuilds')
      .select('trash_id, season_id, season_name, restored_at, phase_ids, player_ids')
      .eq('trash_id', trashId)
      .maybeSingle(),
  ]);
  if (trash.error) throw trash.error;
  if (restored.error) throw restored.error;
  if (trash.data) {
    const r = trash.data;
    return { kind: 'delete', trash_id: r.id, season_id: r.season_id, season_name: r.season_name, at: r.deleted_at, phase_ids: r.phase_ids, player_ids: r.player_ids };
  }
  if (restored.data) {
    const r = restored.data;
    return { kind: 'restore', trash_id: r.trash_id, season_id: r.season_id, season_name: r.season_name, at: r.restored_at, phase_ids: r.phase_ids, player_ids: r.player_ids };
  }
  return null;
}

/** Confirms the derived-data rebuild after a delete. True when a pending marker was cleared. */
export async function markLeagueTrashRebuildDone(trashId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('league_trash_rebuild_done', { p_trash_id: trashId });
  if (error) throw error;
  return data === true;
}

/** Confirms the derived-data rebuild after a restore. True when a tombstone was removed. */
export async function markLeagueRestoreRebuildDone(seasonId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('league_trash_restore_rebuild_done', { p_season_id: seasonId });
  if (error) throw error;
  return data === true;
}

/** Highest applied migration version, or null when the database has no migration ledger. */
export async function getLeagueTrashSchemaVersion(): Promise<string | null> {
  const { data, error } = await supabase.rpc('league_trash_schema_version');
  if (error) throw error;
  return typeof data === 'string' ? data : null;
}
