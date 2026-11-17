import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261117124000_phase_epb_game_credits.sql', 'utf8');

function body(name: string) {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.' + name + '(');
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf('$$;', start) + 3);
}

describe('native EPB SQL contracts', () => {
  it('uses native ownership and the shared season epoch without another ledger table', () => {
    expect(sql).not.toMatch(/CREATE TABLE/i);
    for (const name of ['phase_epb_credit_game_kills', 'phase_epb_uncredit_game_kills', 'phase_epb_sync_game_kill_credit']) {
      const fn = body(name);
      expect(fn).toContain('epb__lock_kill_credit_epoch(');
      expect(fn).toContain('SET epoch = epoch + 1');
      expect(fn).toContain('phase_games');
      expect(fn).toContain('phase_matches');
      expect(fn).toContain('league_phases');
      expect(fn).not.toMatch(/\bJOIN tournaments\b/);
      expect(fn).toContain('public.phase_storage_mode()');
      expect(fn).toContain('SET search_path = public');
    }
  });

  it('credits the marker with its ledger and debits the recorded ledger rather than remapping trackers', () => {
    expect(body('phase_epb_credit_game_kills')).toContain('evolution_credits = v_ledger');
    const debit = body('phase_epb_uncredit_game_kills');
    expect(debit).toContain('v_applied_at IS DISTINCT FROM p_expected_applied_at');
    expect(debit).toContain('jsonb_array_elements(v_ledger)');
    expect(debit).toContain('evolution_applied_at = NULL, evolution_credits = NULL');
  });

  it('serializes both stores on one epoch and rolls both syncs back on a stale result', () => {
    const mixed = body('epb_sync_mixed_game_kill_credit');
    expect(mixed.indexOf('epb__lock_kill_credit_epoch')).toBeLessThan(mixed.indexOf('UPDATE games'));
    expect(mixed).toContain('ORDER BY m.id FOR SHARE OF m');
    expect(mixed).toContain('JOIN phase_games pg ON pg.id = g.id');
    expect(mixed).toContain('duplicate identity across streams');
    expect(mixed.match(/SET epoch = epoch \+ 1/g)).toHaveLength(1);
    expect(mixed).not.toContain(':= epb_sync_game_kill_credit(');
    expect(mixed).not.toContain(':= phase_epb_sync_game_kill_credit(');
    expect(mixed.lastIndexOf("'reason', 'match_changed'")).toBeLessThan(mixed.indexOf('UPDATE games'));
    expect(mixed).toContain('ORDER BY g.id FOR UPDATE OF g');
  });

  it('closes every new function to API roles', () => {
    const revoke = sql.slice(sql.indexOf('REVOKE ALL ON FUNCTION'), sql.indexOf('FROM PUBLIC, anon, authenticated;'));
    const grant = sql.slice(sql.indexOf('GRANT EXECUTE ON FUNCTION'));
    for (const name of [
      'phase_epb_credit_game_kills', 'phase_epb_uncredit_game_kills',
      'phase_epb_sync_game_kill_credit', 'epb_sync_mixed_game_kill_credit',
    ]) {
      expect(revoke).toContain('public.' + name + '(');
      expect(grant).toContain('public.' + name + '(');
    }
    expect(grant).toContain('TO service_role');
  });
});
