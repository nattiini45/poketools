import { describe, expect, it } from 'vitest';
import { leagueTrashLifecycleState, leagueTrashMachine } from '../lifecycle-state';
import { lastSqlFunction, sqlWriters } from '@/test/sql-functions';

/**
 * The league recycle bin's derived lifecycle and its parity with the SQL functions that own every move (ADR 0004).
 * Expired is `purge_after <= now`, as in league_trash_restore and league_trash_expire.
 */
const spec = leagueTrashMachine.spec;
const NOW = '2026-11-09T12:00:00.000Z';
const BEFORE = '2026-11-09T11:59:59.000Z';

describe('leagueTrashLifecycleState', () => {
  it.each([
    [false, '2027-01-01T00:00:00Z', 'in_bin'],
    [true, '2027-01-01T00:00:00Z', 'rebuild_pending'],
    [false, NOW, 'purgeable'],
    [false, BEFORE, 'purgeable'],
    [true, NOW, 'expired_rebuild_pending'],
  ] as const)('rebuildPending %s, purge after %s → %s', (rebuildPending, purgeAfter, state) => {
    expect(leagueTrashLifecycleState({ rebuildPending, purgeAfter }, NOW)).toBe(state);
  });

  it('offers Restore only in the bin before the purge date with the delete rebuild confirmed', () => {
    const restorable = spec.states.filter((s) =>
      leagueTrashMachine.transitionsFrom(s, 'superadmin').some((t) => t.event === 'restore'),
    );
    expect(restorable).toEqual(['in_bin']);
  });

  it('names the limbo: past the purge date with a pending rebuild only the rebuild leads out', () => {
    expect(leagueTrashMachine.transitionsFrom('expired_rebuild_pending').map((t) => [t.event, t.to])).toEqual([
      ['rebuild_done', 'purgeable'],
    ]);
  });
});

describe('league trash machine parity with the SQL functions', () => {
  it('names each SQL writer at the migration that holds its last definition', () => {
    for (const writer of sqlWriters(spec).keys()) {
      const [file, fn] = writer.split('#');
      expect({ fn, file: lastSqlFunction(fn).file }).toEqual({ fn, file });
    }
  });

  it('league_trash_restore refuses an expired entry before a pending rebuild, under the trash row lock', () => {
    expect(leagueTrashMachine.sourcesOf('restored_rebuild_pending')).toEqual(['in_bin']);
    const { body } = lastSqlFunction('league_trash_restore');
    const lock = body.indexOf('FROM public.league_trash WHERE id = p_trash_id FOR UPDATE;');
    const expired = body.indexOf("IF t.purge_after <= p_now THEN RAISE EXCEPTION 'LEAGUE_TRASH_EXPIRED'");
    const pending = body.indexOf("IF t.rebuild_pending THEN RAISE EXCEPTION 'LEAGUE_TRASH_REBUILD_PENDING'");
    expect(lock).toBeGreaterThan(-1);
    expect(expired).toBeGreaterThan(lock);
    expect(pending).toBeGreaterThan(expired);
    expect(body).toContain('INSERT INTO public.league_trash_restore_rebuilds');
    expect(body).toContain('DELETE FROM public.league_trash WHERE id = p_trash_id;');
  });

  it('league_trash_expire purges only expired entries whose delete rebuild is confirmed', () => {
    expect(leagueTrashMachine.sourcesOf('purged')).toEqual(['purgeable']);
    expect(lastSqlFunction('league_trash_expire').body).toContain(
      'SELECT id FROM public.league_trash WHERE purge_after <= p_now AND NOT rebuild_pending ORDER BY purge_after LIMIT greatest(p_limit, 1) FOR UPDATE SKIP LOCKED',
    );
  });

  it('league_trash_rebuild_done clears a pending rebuild whatever the purge date', () => {
    const froms = spec.transitions.filter((t) => t.event === 'rebuild_done').flatMap((t) => t.from);
    expect(froms.sort()).toEqual(['expired_rebuild_pending', 'rebuild_pending']);
    const { body } = lastSqlFunction('league_trash_rebuild_done');
    expect(body).toContain('UPDATE public.league_trash SET rebuild_pending = false WHERE id = p_trash_id AND rebuild_pending RETURNING 1');
    expect(body).not.toContain('purge_after');
  });

  it('league_trash_restore_rebuild_done drops the restore tombstone', () => {
    expect(leagueTrashMachine.sourcesOf('live')).toEqual(['restored_rebuild_pending']);
    expect(lastSqlFunction('league_trash_restore_rebuild_done').body).toContain(
      'DELETE FROM public.league_trash_restore_rebuilds WHERE season_id = p_season_id RETURNING 1',
    );
  });

  it('league_trash_delete trashes a live league under its advisory lock and drops a restore tombstone', () => {
    expect(leagueTrashMachine.sourcesOf('rebuild_pending', 'admin').sort()).toEqual(['live', 'restored_rebuild_pending']);
    const { body } = lastSqlFunction('league_trash_delete');
    const lock = body.indexOf('PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));');
    expect(lock).toBeGreaterThan(-1);
    expect(body.indexOf("IF NOT FOUND THEN RAISE EXCEPTION 'LEAGUE_TRASH_SEASON_NOT_FOUND'")).toBeGreaterThan(lock);
    expect(body).toContain('DELETE FROM public.league_trash_restore_rebuilds WHERE season_id = p_season_id;');
    expect(body).toContain('DELETE FROM public.seasons WHERE id = p_season_id;');
  });
});
