/**
 * Static contract of the "re-roll every two rounds" migration (20261027190000). No DB: reads the migration text. The
 * behaviour on a real Postgres (rounds 1-2 on the seats, a fresh permutation per later pair, the lone last round, one slot
 * per participant per round, a Redraft still on the plain snake) is replayed by draft-start-reroll.live-db.test.ts.
 *
 * - draft_start keeps its signature (the behaviour depends on the pool alone, no parameter), is a copy of the latest
 *   earlier definition except for the slot generation and the audit payload, and is the latest definition in the tree.
 * - The privileges are re-issued: service_role only, nothing for PUBLIC / anon / authenticated.
 * - One permutation per pair is materialised (one random key per participant and pair); nothing draws per slot.
 * - A Redraft is not touched: the file defines no other function.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const read = (file: string): string => readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n');
const FILE = '20261027190000_draft_start_reroll_every_two_rounds.sql';
const BASE_FILE = '20261018140200_draft_pool_completability.sql';
const SQL = read(FILE);

function fnBody(sql: string, name: string): string {
  const start = sql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  return sql.slice(start, sql.indexOf('END $$;', start) + 'END $$;'.length);
}

const code = (body: string): string[] =>
  body
    .split('\n')
    .map((l) => l.replace(/--.*$/, '').trim())
    .filter(Boolean);

const NEW = fnBody(SQL, 'draft_start');
const BASE = fnBody(read(BASE_FILE), 'draft_start');

describe('20261027190000_draft_start_reroll_every_two_rounds.sql', () => {
  it('is the latest definition of draft_start in the tree, and the only function the file defines', () => {
    const definers = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql') && /FUNCTION public\.draft_start\(/.test(read(f)))
      .sort();
    expect(definers.at(-1)).toBe(FILE);
    expect(SQL.match(/CREATE (?:OR REPLACE )?FUNCTION/g)).toHaveLength(1);
    expect(SQL).not.toMatch(/DROP FUNCTION/);
    // No later file redefines it (other files may sort after it; 20261027100000 lives on another branch).
    expect(readdirSync(DIR).filter((f) => f.endsWith('.sql') && f > FILE && /FUNCTION public\.draft_start\(/.test(read(f)))).toEqual([]);
  });

  it('keeps the signature: no new parameter, same return type, same settings', () => {
    expect(NEW.split('\n')[0]).toBe('CREATE OR REPLACE FUNCTION public.draft_start(p_pool_id uuid, p_actor_id uuid) RETURNS jsonb');
    expect(NEW.split('\n')[1]).toBe(BASE.split('\n')[1]);
  });

  it('is a copy of the latest earlier definition except for the pair orders, the slot generation and the audit payload', () => {
    const was = code(BASE);
    const now = code(NEW);
    const removed = was.filter((l) => !now.includes(l));
    const added = now.filter((l) => !was.includes(l));
    // Gone: the declaration line (a variable is added), the one-permutation snake, and the audit payload's last line.
    expect(removed).toEqual([
      'DECLARE v_pool public.draft_pools; v_n integer; v_current uuid; v_gate jsonb;',
      'FROM (SELECT dp.player_id, r.round,',
      'row_number() OVER (ORDER BY r.round, CASE WHEN r.round % 2 = 1 THEN dp.seat ELSE -dp.seat END) AS rn',
      'FROM public.draft_participants dp CROSS JOIN generate_series(1, v_pool.roster_size) AS r(round)',
      'WHERE dp.draft_pool_id = p_pool_id) s;',
      "'roster_size', v_pool.roster_size, 'mode', v_pool.mode));",
    ]);
    expect(added.some((l) => l.startsWith('DECLARE v_pool public.draft_pools; v_n integer; v_current uuid; v_gate jsonb; v_pair_orders jsonb;'))).toBe(true);
    // Every guard, the completability gate, the state change and the activation survive verbatim.
    for (const line of [
      "IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;",
      "IF v_pool.kind <> 'initial' THEN RAISE EXCEPTION 'SUBMISSION_PHASE' USING ERRCODE = 'P0001'; END IF;",
      "IF v_pool.phase <> 'setup' THEN RAISE EXCEPTION 'DRAFT_ALREADY_STARTED' USING ERRCODE = 'P0001'; END IF;",
      "IF v_n < 2 THEN RAISE EXCEPTION 'SEATS_INVALID' USING ERRCODE = 'P0001'; END IF;",
      'v_gate := public.draft__pool_completable(p_pool_id);',
      "RAISE EXCEPTION 'LEAGUE_NOT_COMPLETABLE' USING ERRCODE = 'P0001',",
      'v_current := public.draft__activate_next(p_pool_id, now());',
    ]) {
      expect(now).toContain(line.replace(/\s+--.*$/, ''));
    }
  });

  it('draws one permutation per pair, never one per slot, and records the pairs in the existing draft_started row', () => {
    const body = code(NEW).join('\n');
    expect(body.match(/gen_random_uuid\(\)/g)).toHaveLength(1);
    expect(body).not.toMatch(/\brandom\(\)/);
    // Pair 1 keeps the seats; later pairs are keyed by the random value alone.
    expect(body).toMatch(/PARTITION BY k\.pair\s+ORDER BY CASE WHEN k\.pair = 1 THEN dp\.seat END, gen_random_uuid\(\)/);
    expect(body).toContain('generate_series(1, (v_pool.roster_size + 1) / 2) AS k(pair)');
    // Both rounds of a pair read the same stored order: first round forward, second reversed.
    expect(body).toContain('jsonb_array_elements(v_pair_orders -> ((r.round + 1) / 2 - 1)) WITH ORDINALITY AS e(pid, pos)');
    expect(body).toContain('CASE WHEN r.round % 2 = 1 THEN e.pos ELSE -e.pos END');
    expect(body).toContain("'order_mode', 'snake_reroll', 'pair_orders', v_pair_orders");
    expect(body).toContain("'draft_started'");
    // Nothing else of the queue changes: sort_key = nominal = running index, all slots materialised up front.
    expect(body).toContain('SELECT p_pool_id, s.player_id, s.rn, s.round, s.rn');
  });

  it('re-issues the privileges: service_role only', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.draft_start\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.draft_start\(uuid, uuid\) TO service_role;/);
    expect(SQL).not.toMatch(/GRANT[^;]*\b(?:anon|authenticated|PUBLIC)\b/);
    // Same shape as the original block.
    expect(read(BASE_FILE)).toMatch(/GRANT EXECUTE ON FUNCTION[^;]*public\.draft_start\(uuid, uuid\),[^;]*TO service_role;/);
  });

  it('runs in one transaction and leaves the Redraft publish alone', () => {
    expect(SQL).toMatch(/^BEGIN;$/m);
    expect(SQL).toMatch(/^COMMIT;$/m);
    expect(SQL).not.toMatch(/redraft__publish_locked/);
  });
});
