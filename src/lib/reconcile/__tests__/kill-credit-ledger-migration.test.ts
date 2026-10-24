/**
 * Pins the shape of supabase/migrations/20261021100100_epb_game_kill_credit_ledger.sql
 * (the per-game kill-credit ledger). The functions run only in Postgres; their behaviour was
 * exercised against the local stack in a rolled-back transaction (credit → ledger,
 * ledger debit to the tracker that got the credit, retired tracker skipped, legacy
 * p_debits path, stale fence, match_changed, validation refusals, grants). These
 * checks keep the load-bearing parts from silently regressing in a later edit.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261021100100_epb_game_kill_credit_ledger.sql', 'utf8');

/** The body of one CREATE OR REPLACE FUNCTION, up to its closing $$. */
function functionBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const bodyStart = sql.indexOf('AS $$', start);
  const bodyEnd = sql.indexOf('$$;', bodyStart + 5);
  return sql.slice(bodyStart, bodyEnd);
}

describe('20261021100100 kill-credit ledger + season fence', () => {
  it('uncredit debits the ledger; the caller debits only for a legacy marker', () => {
    const body = functionBody('epb_uncredit_game_kills');
    const ledgerBranch = body.indexOf('IF v_ledger IS NOT NULL THEN');
    const legacyBranch = body.indexOf('ELSE', ledgerBranch);
    expect(ledgerBranch).toBeGreaterThan(0);
    expect(body.slice(ledgerBranch, legacyBranch)).toContain('jsonb_array_elements(v_ledger)');
    expect(body.slice(ledgerBranch, legacyBranch)).not.toContain('p_debits');
    expect(body.slice(legacyBranch)).toContain('jsonb_array_elements(p_debits)');
    expect(body).toContain('evolution_applied_at = NULL, evolution_credits = NULL');
  });

  it('credit records what it applied as the ledger, with the marker', () => {
    const body = functionBody('epb_credit_game_kills');
    expect(body).toContain('SET evolution_applied_at = now(), evolution_credits = v_ledger');
  });

  it('credit, debit and sync take the season fence before any game row and bump it when they write', () => {
    for (const name of ['epb_credit_game_kills', 'epb_uncredit_game_kills', 'epb_sync_game_kill_credit']) {
      const body = functionBody(name);
      const fence = body.indexOf('epb__lock_kill_credit_epoch(');
      expect(fence, name).toBeGreaterThan(0);
      const firstGameLock = body.search(/FROM games WHERE id = p_game_id FOR UPDATE|UPDATE games/);
      expect(firstGameLock, name).toBeGreaterThan(fence);
      expect(body, name).toContain('SET epoch = epoch + 1');
    }
  });

  it('the sync refuses a moved counter or a credited match that left completed, and the unfenced sync is gone', () => {
    const body = functionBody('epb_sync_game_kill_credit');
    expect(body).toContain('IF v_epoch <> p_expected_epoch THEN');
    expect(body).toContain("'reason', 'credit_changed'");
    expect(body).toContain("'reason', 'match_changed'");
    expect(sql).toContain('DROP FUNCTION public.epb_sync_game_kill_credit(uuid, uuid[]);');
  });

  it('keeps a ledger only beside a marker', () => {
    expect(sql).toMatch(/CHECK \(evolution_credits IS NULL\s+OR \(evolution_applied_at IS NOT NULL AND jsonb_typeof\(evolution_credits\) = 'array'\)\)/);
  });
});
