/**
 * The client side of the league trash page: the counts column, the "schema changed since delete" rule, the two requests
 * (restore, run rebuild) with a mocked fetch, and the page state (`leagueTrashReducer`).
 */
import { describe, expect, it, vi } from 'vitest';
import { apiErrorText } from '@/i18n/api-errors';
import { errorsAdmin, errorsSeasons, errorsTournaments } from '@/i18n/messages/errors';
import {
  INITIAL_LEAGUE_TRASH_STATE,
  headlineCounts,
  isSchemaChanged,
  leagueTrashReducer,
  pendingKey,
  requestLeagueRebuild,
  requestLeagueRestore,
  type LeagueRestoreView,
} from '../client';

const catalogs = [errorsSeasons, errorsTournaments, errorsAdmin];

/** A fetch that answers one POST with `status` and `body` (a string is sent raw). */
function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe('POST');
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe('headlineCounts', () => {
  it('reads the participants, phases, matches, games and draft pools from the captured table counts', () => {
    expect(
      headlineCounts({ season_participants: 12, tournaments: 3, matches: 40, games: 88, draft_pools: 2, battle_stats: 900 }),
    ).toEqual({ players: 12, phases: 3, matches: 40, games: 88, draftPools: 2 });
  });

  it('is zero for tables the trash row does not list', () => {
    expect(headlineCounts({})).toEqual({ players: 0, phases: 0, matches: 0, games: 0, draftPools: 0 });
  });
});

describe('isSchemaChanged', () => {
  it('is true only when both versions are known and differ', () => {
    expect(isSchemaChanged('20261026091500', '20261101000000')).toBe(true);
    expect(isSchemaChanged('20261026091500', '20261026091500')).toBe(false);
    expect(isSchemaChanged(null, '20261026091500')).toBe(false);
    expect(isSchemaChanged('20261026091500', null)).toBe(false);
    expect(isSchemaChanged(null, null)).toBe(false);
  });
});

describe('requestLeagueRestore', () => {
  const body = {
    success: true,
    data: {
      season_id: 's1',
      season_name: 'Summer League',
      paused_pools: 2,
      warnings: [
        { code: 'parent_missing_nulled', rel: 'teams', column: 'ruleset_id', count: 3 },
        { code: 'replay_hash_released', count: 1 },
        { code: 'columns_ignored', rel: 'games', columns: ['legacy_flag'] },
        { code: 'something_new', count: 9 },
        { code: 'parent_missing_nulled', rel: 'teams' },
      ],
      rebuild_warning: { code: 'restore_rebuild_ratings_failed', error: 'Ratings failed.', params: { n: 2, bogus: { x: 1 } } },
    },
  };

  it('posts to the restore route of the trash id and parses the outcome (unknown warning kinds and malformed ones are dropped)', async () => {
    const fetchImpl = fakeFetch(200, body);
    const outcome = await requestLeagueRestore('t/1', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('/api/admin/league-trash/t%2F1/restore', { method: 'POST' });
    expect(outcome).toEqual({
      kind: 'ok',
      value: {
        seasonId: 's1',
        seasonName: 'Summer League',
        pausedPools: 2,
        warnings: [
          { code: 'parent_missing_nulled', rel: 'teams', column: 'ruleset_id', count: 3 },
          { code: 'replay_hash_released', count: 1 },
          { code: 'columns_ignored', rel: 'games', columns: ['legacy_flag'] },
        ],
        rebuildWarning: { code: 'restore_rebuild_ratings_failed', error: 'Ratings failed.', params: { n: 2 } },
      },
    });
  });

  it('a restore without warnings or rebuild warning', async () => {
    const outcome = await requestLeagueRestore(
      't1',
      fakeFetch(200, { success: true, data: { season_id: 's1', season_name: 'X', paused_pools: 0, warnings: [], rebuild_warning: null } }),
    );
    expect(outcome).toEqual({ kind: 'ok', value: { seasonId: 's1', seasonName: 'X', pausedPools: 0, warnings: [], rebuildWarning: null } });
  });

  it('a restore settled after a request deadline keeps the unknown paused drafts as null', async () => {
    const outcome = await requestLeagueRestore(
      't1',
      fakeFetch(200, { success: true, data: { season_id: 's1', season_name: 'X', paused_pools: null, warnings: [], rebuild_warning: null } }),
    );
    expect(outcome).toMatchObject({ kind: 'ok', value: { pausedPools: null } });
  });

  it.each([
    ['LEAGUE_TRASH_EXPIRED', 410, 'The restore window of this league has ended', 'Die Frist zum Wiederherstellen'],
    ['LEAGUE_TRASH_REBUILD_PENDING', 409, 'Run the pending rebuild first', 'Neuaufbau'],
    ['LEAGUE_TRASH_SCHEMA_DRIFT', 409, 'Nothing was restored', 'Es wurde nichts wiederhergestellt'],
  ])('a refusal (%s, %s): nothing restored, the catalogued error rendered in both languages', async (code, status, en, de) => {
    const outcome = await requestLeagueRestore(
      't1',
      fakeFetch(status, { success: false, error: 'English fallback', code, params: { rel: 'games', columns: 'x' } }),
    );
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.error?.code).toBe(code);
    // English keeps the server's own text, German comes from the catalogue by code.
    expect(apiErrorText({ ...outcome.error, error: undefined }, { locale: 'en', catalogs })).toContain(en);
    expect(apiErrorText(outcome.error, { locale: 'de', catalogs })).toContain(de);
  });

  it('a failure without a readable body is refused with no error (the generic text), the body is logged', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const outcome = await requestLeagueRestore('t1', fakeFetch(502, '<html>Bad gateway</html>'));
    expect(outcome).toEqual({ kind: 'refused', error: null });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('answered 502 with a body that is not JSON'), expect.anything());
    logged.mockRestore();
  });

  it('a 200 without the season is refused rather than reported as a restore', async () => {
    expect(await requestLeagueRestore('t1', fakeFetch(200, { success: true, data: {} }))).toEqual({ kind: 'refused', error: null });
  });

  it('a network failure rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(requestLeagueRestore('t1', fetchImpl)).rejects.toThrow('Failed to fetch');
  });
});

describe('requestLeagueRebuild', () => {
  it('posts to the rebuild route and parses the kind and the warning', async () => {
    const fetchImpl = fakeFetch(200, { success: true, data: { kind: 'delete', rebuild_warning: null } });
    expect(await requestLeagueRebuild('t1', fetchImpl)).toEqual({ kind: 'ok', value: { kind: 'delete', rebuildWarning: null } });
    expect(fetchImpl).toHaveBeenCalledWith('/api/admin/league-trash/t1/rebuild', { method: 'POST' });

    const warned = await requestLeagueRebuild(
      't1',
      fakeFetch(200, { success: true, data: { kind: 'restore', rebuild_warning: { code: 'restore_rebuild_failed', error: 'E' } } }),
    );
    expect(warned).toEqual({ kind: 'ok', value: { kind: 'restore', rebuildWarning: { code: 'restore_rebuild_failed', error: 'E' } } });
  });

  it('nothing pending for the id: refused with the catalogued 404', async () => {
    const outcome = await requestLeagueRebuild('t1', fakeFetch(404, { success: false, error: 'Not in the trash', code: 'LEAGUE_TRASH_NOT_FOUND' }));
    expect(outcome).toEqual({ kind: 'refused', error: { code: 'LEAGUE_TRASH_NOT_FOUND', error: 'Not in the trash' } });
  });

  it('an unknown kind is refused', async () => {
    expect(await requestLeagueRebuild('t1', fakeFetch(200, { success: true, data: { kind: 'other' } }))).toEqual({
      kind: 'refused',
      error: null,
    });
  });
});

describe('leagueTrashReducer', () => {
  const restore: LeagueRestoreView = { seasonId: 's1', seasonName: 'Summer League', pausedPools: 1, warnings: [], rebuildWarning: null };

  it('a restore adds a notice (newest first) and takes the row off the table', () => {
    const first = leagueTrashReducer(INITIAL_LEAGUE_TRASH_STATE, { type: 'restored', trashId: 't1', restore });
    const second = leagueTrashReducer(first, { type: 'restored', trashId: 't2', restore: { ...restore, seasonName: 'Winter' } });
    expect(second.restored).toEqual(['t1', 't2']);
    expect(second.notices.map((notice) => notice.id)).toEqual([2, 1]);
    expect(second.notices[0]).toMatchObject({ kind: 'restored', trashId: 't2' });
  });

  it('a finished rebuild is done; one that came back with a warning stays pending', () => {
    const done = leagueTrashReducer(INITIAL_LEAGUE_TRASH_STATE, {
      type: 'rebuilt',
      trashId: 't1',
      name: 'A',
      rebuild: { kind: 'delete', rebuildWarning: null },
    });
    expect(done.rebuilt).toEqual([pendingKey('delete', 't1')]);
    const warned = leagueTrashReducer(done, {
      type: 'rebuilt',
      trashId: 't2',
      name: 'B',
      rebuild: { kind: 'restore', rebuildWarning: { code: 'restore_rebuild_failed' } },
    });
    expect(warned.rebuilt).toEqual([pendingKey('delete', 't1')]);
    expect(warned.notices).toHaveLength(2);
  });

  it('a failure adds an error notice and changes nothing else', () => {
    const next = leagueTrashReducer(INITIAL_LEAGUE_TRASH_STATE, {
      type: 'failed',
      action: 'restore',
      name: 'A',
      error: { code: 'LEAGUE_TRASH_BUSY' },
    });
    expect(next.restored).toEqual([]);
    expect(next.rebuilt).toEqual([]);
    expect(next.notices[0]).toMatchObject({ kind: 'error', action: 'restore', name: 'A' });
  });

  it('dismiss removes just that notice', () => {
    let state = leagueTrashReducer(INITIAL_LEAGUE_TRASH_STATE, { type: 'failed', action: 'rebuild', name: 'A', error: null });
    state = leagueTrashReducer(state, { type: 'failed', action: 'rebuild', name: 'B', error: null });
    const next = leagueTrashReducer(state, { type: 'dismiss', id: 1 });
    expect(next.notices.map((notice) => notice.id)).toEqual([2]);
  });
});
