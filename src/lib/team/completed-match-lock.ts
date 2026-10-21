import { UserFacingError } from '@/lib/api/user-facing-error';
import type { MatchStatus } from '@/types/match';

/**
 * Teams linked to a COMPLETED match are immutable for non-admins (lead ruling
 * round 5, spec §7): the roster is public from then on and feeds the world
 * aces, item usage and EPB participation. The rule is enforced twice:
 *
 * - the routes pre-check the linked match's status and answer 409
 *   `team_match_completed` (`PATCH` / `DELETE /api/teams/[id]`);
 * - the database refuses every other write of such a row with P0001
 *   `TEAM_MATCH_COMPLETED` (trigger `teams_completed_match_lock`, migration
 *   `20261019120000_teams_completed_match_lock.sql`), so a write racing the
 *   match's completion, or a path that forgot the pre-check, cannot bypass it.
 *
 * Site admins keep corrections: the query modules route their writes through
 * `team_correct_update` / `team_correct_delete`, which the trigger lets through.
 */

/** The linked match's status, or null for a row that is linked to no match. */
export function isCompletedMatchLocked(matchStatus: MatchStatus | null | undefined): boolean {
  return matchStatus === 'completed';
}

/** 409: the team is linked to a completed match (catalogue `errors/teams`). */
export class TeamMatchCompletedError extends UserFacingError<'team_match_completed'> {
  constructor() {
    super('This team belongs to a completed match and can no longer be changed', {
      code: 'team_match_completed',
      status: 409,
    });
    this.name = 'TeamMatchCompletedError';
  }
}

/** The SQL message the trigger raises (SQLSTATE P0001). */
export const TEAM_MATCH_COMPLETED_DB_MESSAGE = 'TEAM_MATCH_COMPLETED';

/** True for the trigger's refusal as PostgREST reports it (`{ code: 'P0001', message: 'TEAM_MATCH_COMPLETED' }`). */
export function isTeamMatchCompletedDbError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  return code === 'P0001' && message === TEAM_MATCH_COMPLETED_DB_MESSAGE;
}

/**
 * Rethrow a failed team write: the trigger's refusal becomes the catalogued
 * `TeamMatchCompletedError` (logged by `safeErrorResponse` like every
 * `UserFacingError`), anything else propagates unchanged.
 */
export function throwTeamWriteError(err: unknown): never {
  if (isTeamMatchCompletedDbError(err)) throw new TeamMatchCompletedError();
  throw err;
}
