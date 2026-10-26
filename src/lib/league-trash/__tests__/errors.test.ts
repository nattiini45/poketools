/**
 * The user-facing words of the recycle bin's database signals: every code has a catalogued entry, the right status,
 * the placeholders its message needs, and the internal ones keep table names out of the message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from '@/i18n/core';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { errorsTournaments } from '@/i18n/messages/errors/tournaments';
import { LEAGUE_TRASH_DB_CODES, LeagueTrashDbError } from '../db-error';
import {
  LEAGUE_TRASH_STATUS,
  leagueTrashBlockError,
  leagueTrashRebuildPendingError,
  leagueTrashUserError,
  toLeagueTrashError,
} from '../errors';

const seasonsDe = createTranslator(errorsSeasons, 'de');
const seasonsEn = createTranslator(errorsSeasons, 'en');
const tournamentsDe = createTranslator(errorsTournaments, 'de');

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

const DETAIL = {
  LEAGUE_TRASH_SCHEMA_DRIFT: { rel: 'matches', columns: ['a', 'b'] },
  LEAGUE_TRASH_PARENT_MISSING: { rel: 'teams', column: 'player_id', parent: 'players', ids: ['x'] },
} as const;

function detailOf(code: (typeof LEAGUE_TRASH_DB_CODES)[number]) {
  return (DETAIL as Record<string, Record<string, unknown>>)[code] ?? {};
}

describe('toLeagueTrashError', () => {
  it.each(LEAGUE_TRASH_DB_CODES)('words %s with a catalogued code, its status and an English message', (code) => {
    const error = toLeagueTrashError(new LeagueTrashDbError(code, detailOf(code)));

    expect(error).not.toBeNull();
    expect(error?.statusCode).toBe(LEAGUE_TRASH_STATUS[code]);
    expect(error?.code).toBeDefined();
    expect(error?.message.length).toBeGreaterThan(10);
    // The catalogue has the German twin of the same code and placeholders.
    const catalogCode = error?.code as string;
    expect(seasonsDe.dynamic(catalogCode, error?.params as never)).not.toBe(seasonsEn.dynamic(catalogCode, error?.params as never));
  });

  it('maps the status table the design lists', () => {
    expect(LEAGUE_TRASH_STATUS).toEqual({
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
    });
  });

  it('reuses the league-not-found code for a league that does not exist', () => {
    const error = toLeagueTrashError(new LeagueTrashDbError('LEAGUE_TRASH_SEASON_NOT_FOUND'));

    expect(error).toMatchObject({ code: 'SEASON_NOT_FOUND', statusCode: 404, message: 'League not found' });
  });

  it('fills the schema-drift placeholders from the detail', () => {
    const error = toLeagueTrashError(new LeagueTrashDbError('LEAGUE_TRASH_SCHEMA_DRIFT', DETAIL.LEAGUE_TRASH_SCHEMA_DRIFT));

    expect(error?.params).toEqual({ rel: 'matches', columns: 'a, b' });
    expect(error?.message).toContain('matches');
    expect(error?.message).toContain('a, b');
  });

  it('fills the parent-missing placeholders from the detail (the parent ids stay out)', () => {
    const error = toLeagueTrashError(new LeagueTrashDbError('LEAGUE_TRASH_PARENT_MISSING', DETAIL.LEAGUE_TRASH_PARENT_MISSING));

    expect(error?.params).toEqual({ rel: 'teams', column: 'player_id', parent: 'players' });
    expect(error?.message).not.toContain('"x"');
  });

  it('tolerates a detail without the expected fields', () => {
    const error = toLeagueTrashError(new LeagueTrashDbError('LEAGUE_TRASH_SCHEMA_DRIFT', { columns: 3 }));

    expect(error?.params).toEqual({ rel: '', columns: '' });
  });

  it.each(['LEAGUE_TRASH_PLAN_MISMATCH', 'LEAGUE_TRASH_INVENTORY_INCOMPLETE', 'LEAGUE_TRASH_INVENTORY_STALE'] as const)(
    'logs the detail of %s and keeps it out of the message and params',
    (code) => {
      const error = toLeagueTrashError(new LeagueTrashDbError(code, { missing: ['secret_table'] }));

      expect(JSON.stringify([error?.message, error?.params])).not.toContain('secret_table');
      expect(JSON.stringify(errorSpy.mock.calls)).toContain('secret_table');
    },
  );

  it('words a raw PostgREST error of the functions (message is the code, details a json object)', () => {
    const error = toLeagueTrashError({
      code: 'P0001',
      message: 'LEAGUE_TRASH_EXPIRED',
      details: null,
    });

    expect(error).toMatchObject({ code: 'LEAGUE_TRASH_EXPIRED', statusCode: 410 });
  });

  it.each([
    ['a lock timeout', { code: '55P03', message: 'canceling statement due to lock timeout' }, 'LEAGUE_TRASH_BUSY', 409],
    ['a deadlock', { code: '40P01', message: 'deadlock detected' }, 'LEAGUE_TRASH_BUSY', 409],
    ['a statement timeout', { code: '57014', message: 'canceling statement due to statement timeout' }, 'LEAGUE_TRASH_TIMEOUT', 504],
    [
      'a request deadline',
      { message: 'SupabaseTimeoutError: Supabase rest request timed out after 10000 ms: POST /rest/v1/rpc/league_trash_delete' },
      'LEAGUE_TRASH_TIMEOUT',
      504,
    ],
  ])('words %s', (_name, raw, code, status) => {
    expect(toLeagueTrashError(raw)).toMatchObject({ code, statusCode: status });
  });

  it('returns null for anything that is not a trash signal', () => {
    expect(toLeagueTrashError(new Error('boom'))).toBeNull();
    expect(toLeagueTrashError({ code: 'P0001', message: 'SOMETHING_ELSE' })).toBeNull();
    expect(toLeagueTrashError({ code: '22023', message: 'LEAGUE_TRASH_BAD_RETENTION' })).toBeNull();
    expect(toLeagueTrashError(null)).toBeNull();
  });
});

describe('leagueTrashUserError / leagueTrashRebuildPendingError', () => {
  it('words an already typed error', () => {
    expect(leagueTrashUserError(new LeagueTrashDbError('LEAGUE_TRASH_NOT_FOUND'))).toMatchObject({
      code: 'LEAGUE_TRASH_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('words the refusal to restore a league whose delete rebuild is pending as a catalogued 409', () => {
    const error = leagueTrashRebuildPendingError();

    expect(error).toMatchObject({ code: 'LEAGUE_TRASH_REBUILD_PENDING', statusCode: 409 });
    expect(seasonsDe.dynamic('LEAGUE_TRASH_REBUILD_PENDING')).not.toBe(error.message);
  });
});

describe('leagueTrashBlockError', () => {
  const fk = (constraint: string, table: string) => ({
    code: '23503',
    message: `update or delete on table "x" violates foreign key constraint "${constraint}" on table "${table}"`,
  });

  it('answers the existing player_still_referenced for a player a trashed league references', () => {
    expect(leagueTrashBlockError(fk('league_trash_players_player_id_fkey', 'league_trash_players'))).toMatchObject({
      code: 'player_still_referenced',
      statusCode: 409,
      message: 'Cannot delete this player because other records still reference them.',
    });
  });

  it('answers ruleset_in_trashed_league for a ruleset a trashed league references', () => {
    const error = leagueTrashBlockError(fk('league_trash_rulesets_ruleset_id_fkey', 'league_trash_rulesets'));

    expect(error).toMatchObject({ code: 'ruleset_in_trashed_league', statusCode: 409 });
    expect(tournamentsDe.dynamic('ruleset_in_trashed_league')).not.toBe(error?.message);
  });

  it('has no route code for a point-buy list version (no route deletes one)', () => {
    expect(
      leagueTrashBlockError(fk('league_trash_point_buy_versions_list_version_id_fkey', 'league_trash_point_buy_versions')),
    ).toBeNull();
  });

  it('returns null for another foreign key and for other errors', () => {
    expect(leagueTrashBlockError(fk('teams_player_id_fkey', 'teams'))).toBeNull();
    expect(leagueTrashBlockError(new Error('boom'))).toBeNull();
    expect(leagueTrashBlockError(null)).toBeNull();
  });
});
