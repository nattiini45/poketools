import { describe, expect, it } from 'vitest';
import type { MachineSpec } from '@/lib/state-machine/machine';
import {
  gameAggregateMarkerMachine,
  gameEditLeaseMachine,
  gameEvolutionCreditMachine,
  gameStatsLockMachine,
} from '../game-marker-state';
import { allSqlFunctions, lastSqlFunction, sqlWriters } from '@/test/sql-functions';

/**
 * Parity of the game marker machines with the SQL functions that own their moves (ADR 0004). Each function named as a
 * writer is read from its last CREATE OR REPLACE; its marker guard must refuse exactly the states the definition does
 * not list as sources, and every SQL function that writes a marker column must be a named writer.
 */
type AnySpec = MachineSpec<string, string>;
const transition = (spec: AnySpec, event: string) => {
  const t = spec.transitions.find((x) => x.event === event);
  if (!t) throw new Error(`no transition ${event} in ${spec.id}`);
  return t;
};

const SQL_MACHINES = [gameAggregateMarkerMachine.spec, gameEvolutionCreditMachine.spec, gameEditLeaseMachine.spec];

describe('game marker machines', () => {
  it.each(SQL_MACHINES.map((s) => [s.id, s] as const))('%s names each SQL writer at its last definition', (_id, spec) => {
    for (const writer of sqlWriters(spec).keys()) {
      const [file, fn] = writer.split('#');
      expect({ fn, file: lastSqlFunction(fn).file }).toEqual({ fn, file });
    }
  });

  it.each([
    ['aggregate_applied_at', gameAggregateMarkerMachine.spec],
    ['evolution_applied_at', gameEvolutionCreditMachine.spec],
    ['edit_lease_token', gameEditLeaseMachine.spec],
  ] as const)('every SQL function that sets games.%s is a named writer', (column, spec) => {
    const named = new Set([...sqlWriters(spec).keys()].map((w) => w.split('#')[1]));
    const writers = [...allSqlFunctions()]
      .filter(([, { body }]) => new RegExp(`UPDATE (?:public\\.)?games(?: g)? SET [^;]*\\b${column} =`, 'i').test(body))
      .map(([name]) => name);
    expect(writers.sort()).toEqual([...named].sort());
  });

  describe('aggregate marker', () => {
    const spec = gameAggregateMarkerMachine.spec;

    it('apply_aggregate_job counts only an uncounted game, marker and counts in one transaction', () => {
      const t = transition(spec, 'apply');
      expect(t.from).toEqual(['uncounted']);
      const { body } = lastSqlFunction('apply_aggregate_job');
      expect(body).toContain('SELECT aggregate_applied_at INTO v_applied_at FROM games WHERE id = p_game_id FOR UPDATE;');
      expect(body).toContain("IF v_applied_at IS NOT NULL THEN RETURN 'already_applied';");
      expect(body.indexOf('batch_upsert_aggregates')).toBeLessThan(body.indexOf('UPDATE games SET aggregate_applied_at = now()'));
    });

    it('rollback_game_aggregates rolls back only a counted game, fenced on the expected marker', () => {
      const t = transition(spec, 'rollback');
      expect(t.from).toEqual(['counted']);
      const { body } = lastSqlFunction('rollback_game_aggregates');
      expect(body).toContain('FROM games WHERE id = p_game_id FOR UPDATE;');
      expect(body).toContain("IF v_applied_at IS NULL THEN RETURN 'not_applied';");
      expect(body).toContain("IF v_applied_at IS DISTINCT FROM p_expected_applied_at THEN RETURN 'marker_changed';");
      expect(body).toContain('UPDATE games SET aggregate_applied_at = NULL WHERE id = p_game_id;');
    });
  });

  describe('evolution credit marker', () => {
    const spec = gameEvolutionCreditMachine.spec;

    it('epb_credit_game_kills credits only an uncredited game of a completed match', () => {
      expect(transition(spec, 'credit').from).toEqual(['uncredited']);
      const { body } = lastSqlFunction('epb_credit_game_kills');
      expect(body).toContain('SELECT evolution_applied_at INTO v_applied_at FROM games WHERE id = p_game_id FOR UPDATE;');
      expect(body).toContain("IF v_applied_at IS NOT NULL THEN RETURN 'already_applied';");
      expect(body).toContain("IF v_status IS DISTINCT FROM 'completed' THEN RETURN 'match_not_completed';");
      expect(body).toContain('UPDATE games SET evolution_applied_at = now(), evolution_credits = v_ledger WHERE id = p_game_id;');
    });

    it('epb_uncredit_game_kills uncredits a credited or legacy game, fenced on the expected marker', () => {
      expect(transition(spec, 'uncredit').from).toEqual(['credited', 'legacy_credited']);
      const { body } = lastSqlFunction('epb_uncredit_game_kills');
      expect(body).toContain("IF v_applied_at IS NULL THEN RETURN 'not_applied';");
      expect(body).toContain("IF v_applied_at IS DISTINCT FROM p_expected_applied_at THEN RETURN 'marker_changed';");
      expect(body).toContain('IF v_ledger IS NOT NULL THEN');
      expect(body).toContain('UPDATE games SET evolution_applied_at = NULL, evolution_credits = NULL WHERE id = p_game_id;');
    });

    it('epb_sync_game_kill_credit marks uncredited, rewrites credited and clears, fenced on the season epoch', () => {
      expect(transition(spec, 'sync_mark').from).toEqual(['uncredited']);
      expect(transition(spec, 'sync_rewrite').from).toEqual(['credited', 'legacy_credited']);
      expect(transition(spec, 'sync_clear').from).toEqual(['credited', 'legacy_credited']);
      const { body } = lastSqlFunction('epb_sync_game_kill_credit');
      expect(body).toContain("IF v_epoch <> p_expected_epoch THEN RETURN jsonb_build_object('status', 'stale', 'reason', 'credit_changed');");
      expect(body).toMatch(/SET evolution_applied_at = now\(\), evolution_credits = [^;]*AND g\.evolution_applied_at IS NULL;/);
      expect(body).toMatch(/SET evolution_credits = [^;]*AND g\.evolution_applied_at IS NOT NULL AND g\.evolution_credits IS DISTINCT FROM/);
      expect(body).toMatch(/SET evolution_applied_at = NULL, evolution_credits = NULL [^;]*AND \(g\.evolution_applied_at IS NOT NULL OR g\.evolution_credits IS NOT NULL\);/);
    });
  });

  describe('edit lease', () => {
    const spec = gameEditLeaseMachine.spec;

    it('claim_game_edit_lease takes a free or expired lease together with the editor version', () => {
      expect(transition(spec, 'claim').from).toEqual(['free', 'expired']);
      const { body } = lastSqlFunction('claim_game_edit_lease');
      expect(body).toContain(
        'WHERE id = p_game_id AND updated_at = p_expected_updated_at AND (edit_lease_until IS NULL OR edit_lease_until <= now());',
      );
    });

    it('release_game_edit_lease frees only its own token, expired or not', () => {
      expect(transition(spec, 'release').from).toEqual(['leased', 'expired']);
      const { body } = lastSqlFunction('release_game_edit_lease');
      expect(body).toContain('SET edit_lease_token = NULL, edit_lease_until = NULL WHERE id = p_game_id AND edit_lease_token = p_token;');
      expect(body).not.toContain('edit_lease_until >');
    });
  });

  it('stats lock is one-way: nothing in the app unlocks a game', () => {
    expect(gameStatsLockMachine.sourcesOf('unlocked')).toEqual([]);
    expect(gameStatsLockMachine.can('locked', 'locked', 'admin')).toBe(true);
  });
});
