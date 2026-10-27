/**
 * Database signals of the league recycle bin as one typed error, plus the blocks its junction tables raise.
 *
 * - `LEAGUE_TRASH_DB_CODES` are the exception messages of `league_trash_delete` / `league_trash_restore` (SQLSTATE
 *   P0001, the message IS the code, `details` a JSON object) and two infrastructure states: `LEAGUE_TRASH_BUSY` (lock
 *   timeout 55P03 or deadlock 40P01: retry in a moment) and `LEAGUE_TRASH_TIMEOUT` (statement timeout 57014, or the
 *   request deadline of the Supabase client: the transaction rolled back, or committed after the caller stopped
 *   waiting, so a caller that cannot tell must read the trash back).
 * - `toLeagueTrashDbError` maps a PostgREST error to `LeagueTrashDbError`, matching on the code or message only,
 *   never on text a user typed. Anything else returns `null` and stays the caller's to rethrow.
 * - `leagueTrashBlockOf` reads a foreign-key violation (23503) raised by a delete of a player, a ruleset or a
 *   point-buy list version that a league in the trash still references (the junction tables
 *   `league_trash_players`, `league_trash_rulesets`, `league_trash_point_buy_versions`). A route that deletes one of
 *   these maps the answer to a precise message with it.
 *
 * Pure: no Supabase client, no `next/*`, no `server-only`. The user-facing mapping (catalogue codes, HTTP status) is
 * the route layer's.
 */
import { isSupabaseTimeoutError } from '@/lib/supabase/timeout-fetch';

export const LEAGUE_TRASH_DB_CODES = [
  'LEAGUE_TRASH_SEASON_NOT_FOUND',
  'LEAGUE_TRASH_NOT_FOUND',
  'LEAGUE_TRASH_EXPIRED',
  'LEAGUE_TRASH_SEASON_EXISTS',
  'LEAGUE_TRASH_REBUILD_PENDING',
  'LEAGUE_TRASH_SCHEMA_DRIFT',
  'LEAGUE_TRASH_PARENT_MISSING',
  'LEAGUE_TRASH_PLAN_MISMATCH',
  'LEAGUE_TRASH_INVENTORY_INCOMPLETE',
  'LEAGUE_TRASH_INVENTORY_STALE',
  'LEAGUE_TRASH_BUSY',
  'LEAGUE_TRASH_TIMEOUT',
] as const;

export type LeagueTrashDbCode = (typeof LEAGUE_TRASH_DB_CODES)[number];

/** What a catalogued database exception carries beyond its code (the DETAIL json of the RAISE). */
export type LeagueTrashDbDetail = Readonly<Record<string, unknown>>;

export class LeagueTrashDbError extends Error {
  readonly code: LeagueTrashDbCode;
  readonly detail: LeagueTrashDbDetail;

  constructor(code: LeagueTrashDbCode, detail: LeagueTrashDbDetail = {}, options?: { cause: unknown }) {
    super(code, options);
    this.name = 'LeagueTrashDbError';
    this.code = code;
    this.detail = detail;
  }
}

interface PostgrestErrorLike {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

function asPostgrestError(error: unknown): PostgrestErrorLike | null {
  return typeof error === 'object' && error !== null ? (error as PostgrestErrorLike) : null;
}

function detailOf(error: PostgrestErrorLike): LeagueTrashDbDetail {
  if (typeof error.details !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(error.details);
    if (Array.isArray(parsed)) return { items: parsed };
    return typeof parsed === 'object' && parsed !== null ? (parsed as LeagueTrashDbDetail) : {};
  } catch {
    return {};
  }
}

const DB_CODE_SET: ReadonlySet<string> = new Set(LEAGUE_TRASH_DB_CODES);

/** The typed error for a database signal of the trash functions, or `null` for anything else. */
export function toLeagueTrashDbError(error: unknown): LeagueTrashDbError | null {
  if (error instanceof LeagueTrashDbError) return error;
  const e = asPostgrestError(error);
  if (!e) return null;
  if (e.code === '55P03' || e.code === '40P01') return new LeagueTrashDbError('LEAGUE_TRASH_BUSY', {}, { cause: error });
  if (e.code === '57014' || isSupabaseTimeoutError(error)) {
    return new LeagueTrashDbError('LEAGUE_TRASH_TIMEOUT', {}, { cause: error });
  }
  if (e.code === 'P0001' && typeof e.message === 'string' && DB_CODE_SET.has(e.message)) {
    return new LeagueTrashDbError(e.message as LeagueTrashDbCode, detailOf(e), { cause: error });
  }
  return null;
}

/** The parents a league in the trash keeps alive. */
export type LeagueTrashBlock = 'player' | 'ruleset' | 'point_buy_version';

const BLOCK_BY_CONSTRAINT: Readonly<Record<string, LeagueTrashBlock>> = {
  league_trash_players_player_id_fkey: 'player',
  league_trash_rulesets_ruleset_id_fkey: 'ruleset',
  league_trash_point_buy_versions_list_version_id_fkey: 'point_buy_version',
};

/**
 * Which kind of parent a foreign-key violation (23503) protects for a league in the trash, or `null` when the error is
 * not one of the junction keys. Reads the constraint name from the Postgres message.
 */
export function leagueTrashBlockOf(error: unknown): LeagueTrashBlock | null {
  const e = asPostgrestError(error);
  if (!e || e.code !== '23503' || typeof e.message !== 'string') return null;
  const constraint = /foreign key constraint "([^"]+)"/.exec(e.message)?.[1];
  return constraint ? (BLOCK_BY_CONSTRAINT[constraint] ?? null) : null;
}
