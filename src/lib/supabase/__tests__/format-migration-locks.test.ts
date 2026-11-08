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

  it('refuses a started guarded stage under the season_formats row lock, for an addition as for a removal, before the history row', () => {
    const rowLock = body.indexOf('PERFORM public.format__check_revision_for_update(p_season_id, p_expected_revision)');
    const guard = body.indexOf("'stage_start:' || g.k");
    const insert = body.indexOf('INSERT INTO public.format_adjustments');
    expect(guard).toBeGreaterThan(rowLock);
    expect(guard).toBeLessThan(insert);
    // Not inside the removal-only branch: the application's rule counts a stage start whatever the amendment does.
    const removal = body.indexOf("jsonb_typeof(p_delta -> 'remove') = 'array'");
    expect(guard).toBeGreaterThan(body.indexOf('END IF;\n    END IF;', removal));
    expect(body.slice(guard - 200, guard + 400)).toMatch(/format_event_log e[\s\S]*RAISE EXCEPTION 'domain_in_use'/);
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
  const keysStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.format__lock_op_keys(');
  const keys = sql.slice(keysStart, sql.indexOf('CREATE OR REPLACE FUNCTION public.format__apply_ops(', keysStart));
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.format__apply_ops(');
  const body = sql.slice(start, sql.indexOf('-- Events', start));

  it('takes the per-relation advisory lock (same key as the adjustment) before the first op is applied', () => {
    const lock = keys.indexOf("pg_advisory_xact_lock(hashtextextended('format_relation:'");
    const call = body.indexOf('PERFORM public.format__lock_op_keys(p_season_id, p_ops)');
    const loop = body.indexOf('FOR v_op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP');
    expect(keysStart).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(keysStart);
    expect(lock).toBeGreaterThan(-1);
    // The op applier takes them through the helper that events and adjustments also call before their revision check.
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(loop);
    // Sorted and deduplicated, so every caller (event or adjustment) locks relations in one order.
    expect(keys.slice(0, lock)).toMatch(/SELECT DISTINCT[\s\S]*ORDER BY relation_key/);
    // Same key text as format_apply_adjustment, so the two paths exclude each other.
    expect(sql).toContain("hashtextextended('format_relation:' || p_season_id::text || ':' || v_rel, 0)");
    expect(body.indexOf('IF NOT EXISTS (SELECT 1 FROM public.format_relation_links')).toBeGreaterThan(call);
  });
});

describe('format_fire_event and format_apply_adjustment revision check', () => {
  const sql = read('20261105090000_format_runtime.sql');
  const slice = (from: string, to: string) => {
    const start = sql.indexOf(from);
    return sql.slice(start, sql.indexOf(to, start));
  };

  it('checks the revision of the format before the event is logged, after the relation and action locks of its ops', () => {
    const body = slice('CREATE OR REPLACE FUNCTION public.format_fire_event(', 'CREATE OR REPLACE FUNCTION public.format__action_flag_locked(');
    expect(body).toContain('p_fired_by uuid, p_expected_revision bigint');
    const keys = body.indexOf('PERFORM public.format__lock_op_keys(p_season_id, p_ops)');
    const check = body.indexOf('PERFORM public.format__check_revision(p_season_id, p_expected_revision)');
    const insert = body.indexOf('INSERT INTO public.format_event_log');
    const apply = body.indexOf('public.format__apply_ops(');
    expect(keys).toBeGreaterThan(-1);
    // A stale event raises before its key is inserted, so the key stays free for the new format's event.
    expect(check).toBeGreaterThan(keys);
    expect(insert).toBeGreaterThan(check);
    expect(apply).toBeGreaterThan(insert);
    // An event applies its ops tolerantly (a grant a concurrent writer made impossible is skipped and recorded, not a rollback
    // of the whole event), and records what it skipped in the payload under the same transaction.
    expect(body).toContain("coalesce(p_ops, '[]'::jsonb), false, true)");
    expect(body).toContain("jsonb_build_object('skipped_grants', v_skipped)");
  });

  it('checks it in an adjustment before the history row, with the locks in the order of a submit (action lock, then the row)', () => {
    const body = slice('CREATE OR REPLACE FUNCTION public.format_apply_adjustment(', '-- Checks');
    expect(body).toContain('p_guard_actions text[],\n  p_guard_stages text[], p_expected_revision bigint\n) RETURNS uuid');
    const insert = body.indexOf('INSERT INTO public.format_adjustments');
    const other = body.indexOf('-- Every other kind plans its ops');
    const keys = body.indexOf('PERFORM public.format__lock_op_keys(p_season_id, p_ops)');
    const shared = body.indexOf('PERFORM public.format__check_revision(p_season_id, p_expected_revision)');
    const actionLocks = body.indexOf('PERFORM public.format__lock_action(p_season_id, g.k)');
    const exclusive = body.indexOf('PERFORM public.format__check_revision_for_update(p_season_id, p_expected_revision)');
    expect(other).toBeGreaterThan(-1);
    // Every kind but domain: the ops' relation and action locks, then the share-locked check, before anything else reads or writes.
    expect(keys).toBeGreaterThan(other);
    expect(shared).toBeGreaterThan(keys);
    expect(shared).toBeLessThan(body.indexOf("RAISE EXCEPTION 'relation_has_links'"));
    expect(shared).toBeLessThan(insert);
    // A domain amendment updates the row itself: it takes the guarded actions' locks, then the row FOR UPDATE (two amendments
    // that both held the share lock would wait on each other), before the guard reads the lock state.
    expect(body.lastIndexOf("IF p_kind = 'domain' THEN", actionLocks)).toBeGreaterThan(-1);
    expect(actionLocks).toBeLessThan(other);
    expect(exclusive).toBeGreaterThan(actionLocks);
    expect(exclusive).toBeLessThan(other);
    expect(exclusive).toBeLessThan(body.indexOf('format__action_flag_locked(p_season_id, g.k)'));
    expect(exclusive).toBeLessThan(insert);
  });

  it('locks the row FOR UPDATE in the amendment variant of the check, after the seasons row, and raises the same signal', () => {
    const body = slice('CREATE OR REPLACE FUNCTION public.format__check_revision_for_update(', 'CREATE OR REPLACE FUNCTION public.format__lock_holding(');
    expect(body.indexOf('FROM public.seasons WHERE id = p_season_id FOR KEY SHARE')).toBeGreaterThan(-1);
    expect(body.indexOf('FOR KEY SHARE')).toBeLessThan(body.indexOf('FROM public.season_formats f WHERE f.season_id = p_season_id FOR UPDATE'));
    expect(body).toMatch(/IF NOT FOUND OR v_revision <> p_expected_revision THEN\s+RAISE EXCEPTION 'format_context_stale' USING ERRCODE = 'P0001'/);
    expect(body).toMatch(/p_expected_revision IS NULL THEN\s+RAISE EXCEPTION 'invalid_op'/);
  });

  it('drops the old fire-event and apply-adjustment overloads before creating the new ones (a new argument is an overload)', () => {
    const fireDrop = sql.indexOf('DROP FUNCTION IF EXISTS public.format_fire_event(uuid, text, text, jsonb, jsonb, uuid);');
    const fireCreate = sql.indexOf('CREATE OR REPLACE FUNCTION public.format_fire_event(');
    const adjDrop = sql.indexOf(
      'DROP FUNCTION IF EXISTS public.format_apply_adjustment(uuid, text, jsonb, jsonb, text, uuid, jsonb, text[]);',
    );
    const adjDropNine = sql.indexOf(
      'DROP FUNCTION IF EXISTS public.format_apply_adjustment(uuid, text, jsonb, jsonb, text, uuid, jsonb, text[], bigint);',
    );
    const adjCreate = sql.indexOf('CREATE OR REPLACE FUNCTION public.format_apply_adjustment(');
    expect(adjDropNine).toBeGreaterThan(-1);
    expect(adjCreate).toBeGreaterThan(adjDropNine);
    expect(fireDrop).toBeGreaterThan(-1);
    expect(fireCreate).toBeGreaterThan(fireDrop);
    expect(adjDrop).toBeGreaterThan(-1);
    expect(adjCreate).toBeGreaterThan(adjDrop);
  });

  it('grants and comments only the new signatures (the old overloads are dropped, never granted)', () => {
    expect(sql).toContain('public.format_fire_event(uuid, text, text, jsonb, jsonb, uuid, bigint, uuid, timestamptz)');
    expect(sql).toContain('public.format_apply_adjustment(uuid, text, jsonb, jsonb, text, uuid, jsonb, text[], text[], bigint)');
    const statements = sql.split(';').filter((st) => !/^\s*DROP FUNCTION/m.test(st) && /(?:REVOKE|GRANT|COMMENT ON FUNCTION)/.test(st));
    const text = statements.join(';');
    expect(text).not.toMatch(/format_fire_event\(uuid, text, text, jsonb, jsonb, uuid\)/);
    expect(text).not.toMatch(/format_apply_adjustment\(uuid, text, jsonb, jsonb, text, uuid, jsonb, text\[\]\)/);
    expect(text).not.toMatch(/format_apply_adjustment\(uuid, text, jsonb, jsonb, text, uuid, jsonb, text\[\], bigint\)/);
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
