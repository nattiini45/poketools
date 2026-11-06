import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// Static guards on two Format Studio engine migrations that are edited in place (none of them has shipped).
const read = (name: string) => readFileSync(join(process.cwd(), 'supabase', 'migrations', name), 'utf8').replace(/\r\n/g, '\n');

describe('format_apply_adjustment domain guard', () => {
  const sql = read('20261105090000_format_runtime.sql');
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.format_apply_adjustment(');
  const body = sql.slice(start, sql.indexOf('-- Checks', start));

  it('takes the per-action advisory lock of every guarded action, sorted, before it reads the lock state', () => {
    const lock = body.indexOf('PERFORM public.format__lock_action(p_season_id, g.k)');
    const guard = body.indexOf('format__action_flag_locked(p_season_id, g.k)');
    expect(start).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(lock);
    expect(body.slice(lock, guard)).toMatch(/ORDER BY k/);
    // Inside the domain branch, not for every adjustment kind.
    expect(body.lastIndexOf("IF p_kind = 'domain' THEN", lock)).toBeGreaterThan(-1);
  });

  it('locks before it inserts the adjustment or appends the amendment', () => {
    const lock = body.indexOf('format__lock_action');
    expect(lock).toBeLessThan(body.indexOf('INSERT INTO public.format_adjustments'));
    expect(lock).toBeLessThan(body.indexOf('UPDATE public.season_formats'));
  });

  it('refuses a set_relation over links and a revoke over a short holding before it inserts the adjustment row', () => {
    const insert = body.indexOf('INSERT INTO public.format_adjustments');
    const relation = body.indexOf("RAISE EXCEPTION 'relation_has_links'");
    const holding = body.indexOf("RAISE EXCEPTION 'insufficient_holding'");
    expect(relation).toBeGreaterThan(-1);
    expect(holding).toBeGreaterThan(-1);
    expect(relation).toBeLessThan(insert);
    expect(holding).toBeLessThan(insert);
    // Each decision is made under a transaction lock, so a concurrent adjustment waits and then sees the committed rows.
    expect(body.lastIndexOf("pg_advisory_xact_lock(hashtextextended('format_relation:'", relation)).toBeGreaterThan(-1);
    expect(body.lastIndexOf("PERFORM public.format__lock_holding(p_season_id, v_op ->> 'resource'", holding)).toBeGreaterThan(-1);
    // Only an adjustment refuses: the shared op still skips quietly for an event that fires twice.
    expect(sql.slice(0, start)).toMatch(/IF NOT EXISTS \(SELECT 1 FROM public\.format_relation_links/);
  });
});

describe('format__apply_ops relation lock', () => {
  const sql = read('20261105090000_format_runtime.sql');
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.format__apply_ops(');
  const body = sql.slice(start, sql.indexOf('-- Events', start));

  it('takes the per-relation advisory lock (same key as the adjustment) before the first op is applied', () => {
    const lock = body.indexOf("pg_advisory_xact_lock(hashtextextended('format_relation:'");
    const loop = body.indexOf('FOR v_op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP');
    expect(start).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(loop);
    // Sorted and deduplicated, so every caller (event or adjustment) locks relations in one order.
    expect(body.slice(0, lock)).toMatch(/SELECT DISTINCT[\s\S]*ORDER BY relation_key/);
    // Same key text as format_apply_adjustment, so the two paths exclude each other.
    expect(sql).toContain("hashtextextended('format_relation:' || p_season_id::text || ':' || v_rel, 0)");
    expect(body.indexOf('IF NOT EXISTS (SELECT 1 FROM public.format_relation_links')).toBeGreaterThan(lock);
  });
});

describe('match_outcome_record signature', () => {
  const sql = read('20261104090000_match_outcomes.sql');

  it('drops the 8-argument form before creating the 9-argument one (no second overload)', () => {
    const drop = sql.indexOf(
      'DROP FUNCTION IF EXISTS public.match_outcome_record(uuid, text, text, boolean, smallint, smallint, text, uuid);',
    );
    const create = sql.indexOf('CREATE OR REPLACE FUNCTION public.match_outcome_record(');
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
  });

  it('grants and comments target the 9-argument signature only', () => {
    const nine = 'public.match_outcome_record(uuid, text, text, boolean, smallint, smallint, text, uuid, boolean)';
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${nine}`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${nine}`);
    expect(sql).not.toMatch(/(?:REVOKE|GRANT)[^;]*match_outcome_record\(uuid, text, text, boolean, smallint, smallint, text, uuid\)/);
  });
});
