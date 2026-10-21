import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isCompletedMatchLocked,
  isTeamMatchCompletedDbError,
  TEAM_MATCH_COMPLETED_DB_MESSAGE,
  TeamMatchCompletedError,
  throwTeamWriteError,
} from '../completed-match-lock';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { errorsTeams } from '@/i18n/messages/errors/teams';

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261019120000_teams_completed_match_lock.sql'),
  'utf8',
);

describe('completed-match lock (lead ruling round 5)', () => {
  it('locks only a completed match', () => {
    expect(isCompletedMatchLocked('completed')).toBe(true);
    for (const status of ['scheduled', 'in_progress', 'pending_confirmation', 'disputed', null, undefined] as const) {
      expect(isCompletedMatchLocked(status as never)).toBe(false);
    }
  });

  it('TeamMatchCompletedError is a catalogued 409 (en + de)', () => {
    const err = new TeamMatchCompletedError();
    expect(err).toBeInstanceOf(UserFacingError);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('team_match_completed');
    expect(err.message).toBe(errorsTeams.en.team_match_completed);
    expect(errorsTeams.de.team_match_completed).toBeTruthy();
  });

  it('recognises exactly the trigger refusal', () => {
    expect(isTeamMatchCompletedDbError({ code: 'P0001', message: 'TEAM_MATCH_COMPLETED' })).toBe(true);
    expect(isTeamMatchCompletedDbError({ code: 'P0001', message: 'SEASON_GROUP_LOCKED' })).toBe(false);
    expect(isTeamMatchCompletedDbError({ code: '23505', message: 'TEAM_MATCH_COMPLETED' })).toBe(false);
    expect(isTeamMatchCompletedDbError(new Error('TEAM_MATCH_COMPLETED'))).toBe(false);
    expect(isTeamMatchCompletedDbError(null)).toBe(false);
  });

  it('throwTeamWriteError maps the refusal and rethrows anything else unchanged', () => {
    expect(() => throwTeamWriteError({ code: 'P0001', message: 'TEAM_MATCH_COMPLETED' })).toThrow(
      TeamMatchCompletedError,
    );
    const other = { code: '57014', message: 'canceling statement due to statement timeout' };
    let thrown: unknown;
    try {
      throwTeamWriteError(other);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBe(other);
  });

  it('the migration raises the message the server maps, and guards UPDATE and DELETE', () => {
    expect(MIGRATION).toContain(`RAISE EXCEPTION '${TEAM_MATCH_COMPLETED_DB_MESSAGE}' USING ERRCODE = 'P0001'`);
    expect(MIGRATION).toMatch(/BEFORE UPDATE OR DELETE ON public\.teams/);
    // Only the server role may run the corrections.
    expect(MIGRATION).toMatch(/GRANT EXECUTE ON FUNCTION public\.team_correct_update\([^)]*\) TO service_role;/);
    expect(MIGRATION).toMatch(/GRANT EXECUTE ON FUNCTION public\.team_correct_delete\(uuid\) TO service_role;/);
    expect(MIGRATION).not.toMatch(/TO (anon|authenticated|PUBLIC)\b/);
  });
});
