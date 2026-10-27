import { describe, expect, it } from 'vitest';
import { SupabaseTimeoutError } from '@/lib/supabase/timeout-fetch';
import { LEAGUE_TRASH_DB_CODES, LeagueTrashDbError, leagueTrashBlockOf, toLeagueTrashDbError } from '../db-error';

describe('toLeagueTrashDbError', () => {
  it.each(LEAGUE_TRASH_DB_CODES.filter((c) => c !== 'LEAGUE_TRASH_BUSY' && c !== 'LEAGUE_TRASH_TIMEOUT'))(
    'maps the P0001 exception %s to its code',
    (code) => {
      const mapped = toLeagueTrashDbError({ code: 'P0001', message: code, details: null });
      expect(mapped).toBeInstanceOf(LeagueTrashDbError);
      expect(mapped?.code).toBe(code);
      expect(mapped?.detail).toEqual({});
    },
  );

  it('carries the DETAIL json of the exception', () => {
    const mapped = toLeagueTrashDbError({
      code: 'P0001',
      message: 'LEAGUE_TRASH_SCHEMA_DRIFT',
      details: JSON.stringify({ rel: 'season_storylines', columns: ['lt_req'] }),
    });
    expect(mapped?.detail).toEqual({ rel: 'season_storylines', columns: ['lt_req'] });
  });

  it('wraps a json array detail so the detail is always an object', () => {
    const mapped = toLeagueTrashDbError({ code: 'P0001', message: 'LEAGUE_TRASH_INVENTORY_INCOMPLETE', details: '["lt_probe"]' });
    expect(mapped?.detail).toEqual({ items: ['lt_probe'] });
  });

  it('ignores a detail that is not json', () => {
    expect(toLeagueTrashDbError({ code: 'P0001', message: 'LEAGUE_TRASH_EXPIRED', details: 'not json' })?.detail).toEqual({});
  });

  it('maps lock timeout and deadlock to BUSY', () => {
    expect(toLeagueTrashDbError({ code: '55P03', message: 'x' })?.code).toBe('LEAGUE_TRASH_BUSY');
    expect(toLeagueTrashDbError({ code: '40P01', message: 'x' })?.code).toBe('LEAGUE_TRASH_BUSY');
  });

  it('maps statement timeout and the client deadline to TIMEOUT', () => {
    expect(toLeagueTrashDbError({ code: '57014', message: 'canceling statement due to statement timeout' })?.code).toBe('LEAGUE_TRASH_TIMEOUT');
    expect(toLeagueTrashDbError(new SupabaseTimeoutError('rest', 'POST', '/rest/v1/rpc/league_trash_delete', 10_000, null))?.code).toBe(
      'LEAGUE_TRASH_TIMEOUT',
    );
  });

  it('leaves everything else alone', () => {
    expect(toLeagueTrashDbError({ code: 'P0001', message: 'SOME_OTHER_CODE' })).toBeNull();
    expect(toLeagueTrashDbError({ code: '23503', message: 'x' })).toBeNull();
    expect(toLeagueTrashDbError(null)).toBeNull();
    expect(toLeagueTrashDbError('boom')).toBeNull();
  });

  it('returns a typed error unchanged', () => {
    const err = new LeagueTrashDbError('LEAGUE_TRASH_EXPIRED');
    expect(toLeagueTrashDbError(err)).toBe(err);
  });
});

describe('leagueTrashBlockOf', () => {
  const violation = (constraint: string) => ({
    code: '23503',
    message: `update or delete on table "x" violates foreign key constraint "${constraint}" on table "y"`,
  });

  it('names the parent a league in the trash keeps alive', () => {
    expect(leagueTrashBlockOf(violation('league_trash_players_player_id_fkey'))).toBe('player');
    expect(leagueTrashBlockOf(violation('league_trash_rulesets_ruleset_id_fkey'))).toBe('ruleset');
    expect(leagueTrashBlockOf(violation('league_trash_point_buy_versions_list_version_id_fkey'))).toBe('point_buy_version');
  });

  it('ignores other violations and other errors', () => {
    expect(leagueTrashBlockOf(violation('matches_player_1_id_fkey'))).toBeNull();
    expect(leagueTrashBlockOf({ code: '23505', message: 'duplicate key value violates unique constraint "league_trash_players_pkey"' })).toBeNull();
    expect(leagueTrashBlockOf(undefined)).toBeNull();
  });
});
