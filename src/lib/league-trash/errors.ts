/**
 * The user-facing side of the league recycle bin's database signals (`db-error.ts` types them, this file words them).
 *
 * - `toLeagueTrashError(error)` turns a `LeagueTrashDbError` (or a raw PostgREST error of `league_trash_delete` /
 *   `league_trash_restore`) into a `UserFacingError` with a catalogued code (`errors/seasons`), its English text, the
 *   placeholders and the HTTP status. Anything else returns `null` and stays the caller's to rethrow.
 *   `leagueTrashUserError` is the same for an error already typed, `leagueTrashRebuildPendingError` words the route-level
 *   refusal to restore a league whose delete rebuild is still pending. The internal
 *   inventory codes (`LEAGUE_TRASH_INVENTORY_INCOMPLETE` / `_STALE`) and `LEAGUE_TRASH_PLAN_MISMATCH` carry table names
 *   in their detail: the detail goes to the server log, never to the client.
 * - `leagueTrashBlockError(error)` words the foreign-key violation (23503) that a delete of a player or a ruleset gets
 *   while a league in the trash still references it (the junction tables), or returns `null` for any other error.
 * - `LEAGUE_TRASH_STATUS` gives every database code its HTTP status; a missing key fails `tsc`.
 *
 * Pure: no Supabase client, no `next/*`, no `server-only`.
 */
import { createTranslator } from '@/i18n/core';
import type { ApiErrorCode, ApiErrorParams } from '@/i18n/messages/errors';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { errorsTournaments } from '@/i18n/messages/errors/tournaments';
import { errorsPlayers } from '@/i18n/messages/errors/players';
import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  toLeagueTrashDbError,
  leagueTrashBlockOf,
  type LeagueTrashDbCode,
  type LeagueTrashDbError,
} from './db-error';

/** HTTP status per database code. A missing or extra key fails `tsc`. */
export const LEAGUE_TRASH_STATUS: { readonly [C in LeagueTrashDbCode]: number } = {
  LEAGUE_TRASH_SEASON_NOT_FOUND: 404,
  LEAGUE_TRASH_NOT_FOUND: 404,
  LEAGUE_TRASH_EXPIRED: 410,
  LEAGUE_TRASH_SEASON_EXISTS: 409,
  LEAGUE_TRASH_SCHEMA_DRIFT: 409,
  LEAGUE_TRASH_PARENT_MISSING: 409,
  LEAGUE_TRASH_PLAN_MISMATCH: 409,
  LEAGUE_TRASH_INVENTORY_INCOMPLETE: 500,
  LEAGUE_TRASH_INVENTORY_STALE: 500,
  LEAGUE_TRASH_BUSY: 409,
  LEAGUE_TRASH_TIMEOUT: 504,
};

/** Codes whose detail names tables or rows: logged, never sent. */
const INTERNAL_DETAIL: ReadonlySet<LeagueTrashDbCode> = new Set([
  'LEAGUE_TRASH_PLAN_MISMATCH',
  'LEAGUE_TRASH_INVENTORY_INCOMPLETE',
  'LEAGUE_TRASH_INVENTORY_STALE',
]);

const englishSeasons = createTranslator(errorsSeasons, 'en');
const englishTournaments = createTranslator(errorsTournaments, 'en');
const englishPlayers = createTranslator(errorsPlayers, 'en');

type Params = Readonly<Record<string, string | number>>;

/** A detail value as placeholder text (the SQL builds them from catalog names; anything unexpected reads empty). */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string').join(', ');
  return '';
}

/** The catalogue code and the placeholders of a database signal. */
function catalogEntry(error: LeagueTrashDbError): { code: ApiErrorCode; params?: Params } {
  const { detail } = error;
  switch (error.code) {
    case 'LEAGUE_TRASH_SEASON_NOT_FOUND':
      return { code: 'SEASON_NOT_FOUND' };
    case 'LEAGUE_TRASH_SCHEMA_DRIFT':
      return { code: error.code, params: { rel: text(detail.rel), columns: text(detail.columns) } };
    case 'LEAGUE_TRASH_PARENT_MISSING':
      return {
        code: error.code,
        params: { rel: text(detail.rel), column: text(detail.column), parent: text(detail.parent) },
      };
    default:
      return { code: error.code };
  }
}

/** The English catalogue text of a code (the message the server sends; clients translate by `code`). */
function englishMessage(code: ApiErrorCode, params?: Params): string {
  return englishSeasons.dynamic(code, params);
}

/** The `UserFacingError` of a typed database signal (catalogue code, English text, placeholders, status). */
export function leagueTrashUserError(dbError: LeagueTrashDbError): UserFacingError {
  if (INTERNAL_DETAIL.has(dbError.code)) {
    console.error(`[league-trash] ${dbError.code}:`, dbError.detail);
  }
  const { code, params } = catalogEntry(dbError);
  return new UserFacingError(englishMessage(code, params), {
    code,
    params: params as ApiErrorParams<ApiErrorCode> | undefined,
    status: LEAGUE_TRASH_STATUS[dbError.code],
  });
}

/**
 * The `UserFacingError` for a database signal of the trash functions, or `null` when the error is none of ours.
 * Accepts the typed error (`moveLeagueToTrash` and friends already throw it) or a raw PostgREST error.
 */
export function toLeagueTrashError(error: unknown): UserFacingError | null {
  const dbError = toLeagueTrashDbError(error);
  return dbError ? leagueTrashUserError(dbError) : null;
}

/** The 409 for a restore of a league whose rebuild after the delete is still pending (it would count twice). */
export function leagueTrashRebuildPendingError(): UserFacingError {
  return new UserFacingError(englishSeasons.dynamic('LEAGUE_TRASH_REBUILD_PENDING'), {
    code: 'LEAGUE_TRASH_REBUILD_PENDING',
    status: 409,
  });
}

/**
 * The 409 for a delete of a player or a ruleset that a league in the trash still references (the foreign key of a
 * junction table refused it), or `null` for any other error. A player answers the existing `player_still_referenced`
 * code, a ruleset `ruleset_in_trashed_league`. Point-buy list versions are never deleted by a route.
 */
export function leagueTrashBlockError(error: unknown): UserFacingError | null {
  switch (leagueTrashBlockOf(error)) {
    case 'player':
      return new UserFacingError(englishPlayers.dynamic('player_still_referenced'), {
        code: 'player_still_referenced',
        status: 409,
      });
    case 'ruleset':
      return new UserFacingError(englishTournaments.dynamic('ruleset_in_trashed_league'), {
        code: 'ruleset_in_trashed_league',
        status: 409,
      });
    default:
      return null;
  }
}
