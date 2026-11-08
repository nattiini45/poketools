import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Static guards (no database) for the branch migrations that are edited in place before they are applied live. The
// behaviour itself is proved by the local-stack suites (format-runtime.local, format-runtime-attach.local,
// format-challenges.local); these keep the pieces those suites cannot see from drifting.
const DIR = path.join(process.cwd(), 'supabase', 'migrations');
const sql = (name: string): string =>
  readFileSync(path.join(DIR, name), 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

describe('20261104100100 engine backfill', () => {
  const text = sql('20261104100100_season_format_engine_backfill.sql');

  it('moves the live rows and the league recycle bin snapshots to legacy', () => {
    expect(text).toMatch(/UPDATE public\.season_formats SET engine = 'legacy'/);
    expect(text).toMatch(/UPDATE public\.league_trash_tables/);
    expect(text).toMatch(/rel = 'season_formats'/);
    expect(text).toMatch(/jsonb_set\(r\.value, '\{engine\}', '"legacy"'/);
  });
});

describe('20261105090000 format runtime', () => {
  const text = sql('20261105090000_format_runtime.sql');

  it('serialises save, submit and the lock_action op of one action under one advisory lock', () => {
    expect(text).toMatch(/FUNCTION public\.format__lock_action\(p_season_id uuid, p_action_key text\)/);
    // The lock is taken before the flag check in save and submit, and first in the lock_action op.
    for (const fn of ['format_action_save', 'format_action_submit']) {
      const body = text.slice(text.indexOf(`FUNCTION public.${fn}(`));
      expect(body.indexOf('format__lock_action')).toBeGreaterThan(-1);
      expect(body.indexOf('format__lock_action')).toBeLessThan(body.indexOf('format__action_flag_locked'));
    }
    expect(text).toMatch(/ELSIF v_kind = 'lock_action' THEN\s+PERFORM public\.format__lock_action/);
  });

  it('lets the cron draw refuse to overwrite a submitted pick, under the action lock, in the submit function itself', () => {
    // A new argument is an overload: the earlier forms are dropped first and only the nine-argument form is granted.
    expect(text).toMatch(/DROP FUNCTION IF EXISTS public\.format_action_submit\(uuid, text, uuid, uuid, jsonb, jsonb, boolean\);/);
    expect(text).toMatch(/DROP FUNCTION IF EXISTS public\.format_action_submit\(uuid, text, uuid, uuid, jsonb, jsonb, boolean, boolean\);/);
    expect(text).toMatch(/DROP FUNCTION IF EXISTS public\.format_action_save\(uuid, text, uuid, uuid, jsonb\);/);
    expect(text.indexOf('DROP FUNCTION IF EXISTS public.format_action_submit(')).toBeLessThan(
      text.indexOf('CREATE OR REPLACE FUNCTION public.format_action_submit('),
    );
    expect(text).toMatch(/p_lock boolean,\s+p_expected_revision bigint, p_only_if_unsubmitted boolean DEFAULT false\s*\) RETURNS public\.format_action_submissions/);
    expect(text).not.toMatch(/(?:GRANT|REVOKE|COMMENT)[^;]*format_action_submit\(uuid, text, uuid, uuid, jsonb, jsonb, boolean\)[^,]/);
    expect(text).toContain('public.format_action_submit(uuid, text, uuid, uuid, jsonb, jsonb, boolean, bigint, boolean)');
    expect(text).not.toMatch(/(?:GRANT|REVOKE|COMMENT)[^;]*format_action_submit\(uuid, text, uuid, uuid, jsonb, jsonb, boolean, boolean\)/);
    expect(text).not.toMatch(/(?:GRANT|REVOKE|COMMENT)[^;]*format_action_save\(uuid, text, uuid, uuid, jsonb\)/);

    const body = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.format_action_submit('), text.indexOf('FUNCTION public.format_apply_adjustment('));
    // The refusal sits after the row lock (the existing row is read FOR UPDATE under the advisory lock) and before any write.
    const select = body.indexOf('FOR UPDATE');
    const refusal = body.indexOf("IF p_only_if_unsubmitted AND v_row.status <> 'draft' THEN");
    expect(select).toBeGreaterThan(body.indexOf('format__lock_action'));
    expect(refusal).toBeGreaterThan(select);
    expect(body.slice(refusal)).toMatch(/^[^;]*THEN\s+RAISE EXCEPTION 'action_already_submitted' USING ERRCODE = 'P0001'/);
    expect(refusal).toBeLessThan(body.indexOf('DELETE FROM public.format_resource_items'));
    expect(refusal).toBeLessThan(body.indexOf('UPDATE public.format_action_submissions'));
  });

  it('checks the revision of the format under the action lock, before any flag read or write, in save and submit', () => {
    for (const fn of ['format_action_save', 'format_action_submit']) {
      const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      const body = text.slice(start, text.indexOf('END $$;', start));
      expect(body).toContain('p_expected_revision bigint');
      const lock = body.indexOf('format__lock_action');
      const check = body.indexOf('format__check_revision(p_season_id, p_expected_revision)');
      expect(check).toBeGreaterThan(lock);
      expect(check).toBeLessThan(body.indexOf('format__action_flag_locked'));
      expect(check).toBeLessThan(body.indexOf('INSERT INTO public.format_action_submissions'));
    }
    const check = text.slice(text.indexOf('FUNCTION public.format__check_revision('), text.indexOf('FUNCTION public.format__lock_holding('));
    // The seasons row is share-locked before the season_formats row (the attach locks them in that order), and the
    // season_formats row is read FOR SHARE so an attach, a detach or an amendment waits for the write.
    expect(check.indexOf('FROM public.seasons WHERE id = p_season_id FOR KEY SHARE')).toBeGreaterThan(-1);
    expect(check.indexOf('FOR KEY SHARE')).toBeLessThan(check.indexOf('FROM public.season_formats f WHERE f.season_id = p_season_id FOR SHARE'));
    expect(check).toMatch(/IF NOT FOUND OR v_revision <> p_expected_revision THEN\s+RAISE EXCEPTION 'format_context_stale' USING ERRCODE = 'P0001'/);
    // A missing revision is a caller bug, not a stale write.
    expect(check).toMatch(/p_expected_revision IS NULL THEN\s+RAISE EXCEPTION 'invalid_op'/);
  });

  it('draws the revision from one sequence on every insert and update of season_formats, so a number is never reused', () => {
    expect(text).toMatch(/CREATE SEQUENCE public\.season_format_revision_seq;/);
    expect(text).toMatch(/REVOKE ALL ON SEQUENCE public\.season_format_revision_seq FROM PUBLIC, anon, authenticated;/);
    expect(text).toMatch(/GRANT USAGE ON SEQUENCE public\.season_format_revision_seq TO service_role;/);
    expect(text).toMatch(/ALTER TABLE public\.season_formats ADD COLUMN revision bigint NOT NULL DEFAULT 0;/);
    expect(text).toMatch(/NEW\.revision := nextval\('public\.season_format_revision_seq'\)/);
    expect(text).toMatch(/CREATE TRIGGER trg_season_formats_revision BEFORE INSERT OR UPDATE ON public\.season_formats\s+FOR EACH ROW/);
  });

  it('caps every grant under the holding lock: one insert function for events, actions and adjustments', () => {
    const insert = text.slice(text.indexOf('FUNCTION public.format__insert_item('), text.indexOf('FUNCTION public.format__apply_ops('));
    const lock = insert.indexOf('format__lock_holding(p_season_id, p_resource, p_player)');
    const read = insert.indexOf('FROM public.format_resource_items i');
    const refuse = insert.indexOf("RAISE EXCEPTION 'resource_capacity_reached'");
    const write = insert.indexOf('INSERT INTO public.format_resource_items');
    expect(lock).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(lock);
    expect(refuse).toBeGreaterThan(read);
    expect(write).toBeGreaterThan(refuse);
    expect(insert).toContain('public.format__resource_capacity(p_season_id, p_resource)');
    expect(insert).toContain('v_held + p_amount > v_capacity');
    // The adjustment's revoke check takes the same lock through the same helper, not a copy of its key.
    expect(text.match(/hashtextextended\('format_holding:'/g)).toHaveLength(1);

    // apply_ops (events and adjustments) and submit lock the holdings sorted before the first grant, relation and action locks
    // first (format__lock_op_keys: relation, then action, each sorted).
    const keys = text.slice(text.indexOf('FUNCTION public.format__lock_op_keys('), text.indexOf('FUNCTION public.format__apply_ops('));
    expect(keys.indexOf('format__lock_action(p_season_id, v_lock.action_key)')).toBeGreaterThan(
      keys.indexOf("pg_advisory_xact_lock(hashtextextended('format_relation:'"),
    );
    expect(keys).toMatch(/ORDER BY action_key/);
    // The sorted holding and exclusive-key locks are one helper: holdings (resource, player) first, then the exclusive keys
    // (resource, item), each ORDER BY, so a grant, a revoke and the release of an earlier submission never wait in a cycle.
    const grants = text.slice(text.indexOf('FUNCTION public.format__lock_grants('), text.indexOf('FUNCTION public.format__resource_capacity('));
    const holdingLoop = grants.indexOf('format__lock_holding(p_season_id, v_lock.resource_key, v_lock.player_id)');
    const exclusiveLoop = grants.indexOf('format__lock_exclusive(p_season_id, v_lock.resource_key, v_lock.item_id)');
    expect(holdingLoop).toBeGreaterThan(-1);
    expect(exclusiveLoop).toBeGreaterThan(holdingLoop);
    expect(grants.slice(0, holdingLoop)).toMatch(/ORDER BY resource_key, player_id/);
    expect(grants.slice(holdingLoop, exclusiveLoop)).toMatch(/ORDER BY resource_key, item_id/);
    // The exclusive key is part of the lock order: format__insert_item takes it too (a no-op after the pre-pass).
    expect(insert).toMatch(/IF p_exclusive AND p_item IS NOT NULL THEN\s+PERFORM public\.format__lock_exclusive\(p_season_id, p_resource, p_item\)/);

    const ops = text.slice(text.indexOf('FUNCTION public.format__apply_ops('), text.indexOf('FUNCTION public.format_fire_event('));
    const actionLocks = ops.indexOf('PERFORM public.format__lock_op_keys(p_season_id, p_ops)');
    const holdingLocks = ops.indexOf('PERFORM public.format__lock_grants(p_season_id');
    expect(actionLocks).toBeGreaterThan(-1);
    expect(holdingLocks).toBeGreaterThan(actionLocks);
    expect(holdingLocks).toBeLessThan(ops.indexOf('FOR v_op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP'));
    // A revoke takes the holding lock too (a grant of the same holding and another removal are serialised with it).
    expect(ops.slice(holdingLocks, ops.indexOf('FOR v_op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP'))).toMatch(
      /o ->> 'op' IN \('grant_item', 'revoke_item'\)/,
    );

    // An inverse revoke names the grant's source: its rows are taken before another source's, then oldest first.
    const revoke = ops.slice(ops.indexOf("ELSIF v_kind = 'revoke_item' THEN"), ops.indexOf("ELSIF v_kind = 'set_attr' THEN"));
    expect(revoke).toMatch(/ORDER BY \(CASE WHEN v_op ->> 'source' IS NOT NULL[\s\S]*source_ref IS NOT DISTINCT FROM \(v_op ->> 'source_ref'\)[\s\S]*THEN 0 ELSE 1 END\),\s+created_at, id/);

    const submit = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.format_action_submit('), text.indexOf('FUNCTION public.format_apply_adjustment('));
    const submitLocks = submit.indexOf('PERFORM public.format__lock_grants(p_season_id');
    expect(submitLocks).toBeGreaterThan(submit.indexOf('format__check_revision'));
    // The new items and the items the earlier submission granted (deleted below) are locked together.
    expect(submit.slice(submitLocks, submit.indexOf('DELETE FROM public.format_resource_items'))).toMatch(/UNION ALL[\s\S]*o\.source_ref = v_row\.id::text/);
    expect(submitLocks).toBeLessThan(submit.indexOf('DELETE FROM public.format_resource_items'));
    expect(submitLocks).toBeLessThan(submit.indexOf('PERFORM public.format__insert_item('));

    // A save releases the items of a submitted pick under the same locks.
    const save = text.slice(text.indexOf('FUNCTION public.format_action_save('), text.indexOf('FUNCTION public.format_action_submit('));
    expect(save.indexOf('format__lock_grants(p_season_id')).toBeGreaterThan(-1);
    expect(save.indexOf('format__lock_grants(p_season_id')).toBeLessThan(save.indexOf('DELETE FROM public.format_resource_items'));
  });

  it('releases the items and the submitted_at of a submitted pick that a save turns into a draft', () => {
    const save = text.slice(text.indexOf('FUNCTION public.format_action_save('), text.indexOf('FUNCTION public.format_action_submit('));
    expect(save).toMatch(/submitted_at = NULL/);
    expect(save).toMatch(/DELETE FROM public\.format_resource_items[\s\S]*source = 'action'[\s\S]*source_ref = v_row\.id::text/);
  });

  it('resolves a check only inside its league', () => {
    expect(text).toMatch(/format_check_resolve\(p_season_id uuid, p_check_id uuid, p_status text, p_admin uuid, p_note text\)/);
    expect(text).toMatch(/WHERE id = p_check_id AND season_id = p_season_id AND status = 'open'/);
    // A new argument is an overload: the old four-argument form is dropped before the new one is created, and nothing
    // grants, revokes or comments on it.
    expect(text).toMatch(/DROP FUNCTION IF EXISTS public\.format_check_resolve\(uuid, text, uuid, text\);/);
    expect(text.indexOf('DROP FUNCTION IF EXISTS public.format_check_resolve(')).toBeLessThan(
      text.indexOf('CREATE OR REPLACE FUNCTION public.format_check_resolve('),
    );
    expect(text).not.toMatch(/(?:GRANT|REVOKE|COMMENT)[^;]*format_check_resolve\(uuid, text, uuid, text\)/);
  });

  it('replaces a phase roster and its enrollment source as a compare-and-set under a row lock, service-role only', () => {
    const start = text.indexOf('CREATE OR REPLACE FUNCTION public.tournament_enrollment_replace(');
    expect(start).toBeGreaterThan(-1);
    const body = text.slice(start, text.indexOf('REVOKE ALL ON FUNCTION public.tournament_enrollment_replace', start));
    const lock = body.indexOf('FOR UPDATE');
    const compare = body.indexOf("(v_current ->> 'synced_at') IS DISTINCT FROM p_expected_synced_at");
    expect(lock).toBeGreaterThan(-1);
    expect(compare).toBeGreaterThan(lock);
    // A lost race writes nothing: the roster and the source change only after the comparison.
    expect(body.indexOf('RETURN false')).toBeLessThan(body.indexOf('DELETE FROM public.tournament_participants'));
    expect(body.indexOf('DELETE FROM public.tournament_participants')).toBeLessThan(body.indexOf('INSERT INTO public.tournament_participants'));
    expect(body.indexOf('INSERT INTO public.tournament_participants')).toBeLessThan(body.search(/UPDATE public\.tournaments\s+SET enrollment_source/));
    // "Not frozen, no rounds" is decided under the row lock (not from the application's earlier read) unless the sync is forced,
    // before anything is deleted, and the stored frozen flag is the one kept.
    const frozen = body.indexOf("RAISE EXCEPTION 'enrollment_frozen'");
    const rounds = body.indexOf("RAISE EXCEPTION 'enrollment_rounds_exist'");
    expect(frozen).toBeGreaterThan(compare);
    expect(rounds).toBeGreaterThan(frozen);
    expect(rounds).toBeLessThan(body.indexOf('DELETE FROM public.tournament_participants'));
    expect(body).toContain('IF NOT coalesce(p_force, false) THEN');
    expect(body).toMatch(/jsonb_build_object\('frozen', coalesce\(v_current ->> 'frozen', 'false'\) = 'true'\)/);
    expect(text).toContain('REVOKE ALL ON FUNCTION public.tournament_enrollment_replace(uuid, jsonb, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;');
    expect(text).toContain('GRANT EXECUTE ON FUNCTION public.tournament_enrollment_replace(uuid, jsonb, jsonb, text, boolean) TO service_role;');
    // The freeze is one atomic jsonb update under the same row lock, service-role only.
    expect(text).toMatch(/UPDATE public\.tournaments\s+SET enrollment_source = jsonb_set\(enrollment_source, '\{frozen\}', 'true'::jsonb\)/);
    expect(text).toContain('GRANT EXECUTE ON FUNCTION public.tournament_enrollment_freeze(uuid) TO service_role;');
  });

  it('keeps the internal helpers service-role only', () => {
    for (const fn of [
      'format__lock_action(uuid, text)',
      'format__clear_runtime(uuid)',
      'format__check_revision(uuid, bigint)',
      'format__check_revision_for_update(uuid, bigint)',
      'format__lock_op_keys(uuid, jsonb)',
      'format__lock_holding(uuid, text, uuid)',
      'format__resource_capacity(uuid, text)',
    ]) {
      expect(text).toContain(`public.${fn}`);
    }
    expect(text).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*format__clear_runtime\(uuid\)[\s\S]*FROM PUBLIC, anon, authenticated/);
  });
});

describe('20261105120000 attach and detach', () => {
  const text = sql('20261105120000_format_foreach_group.sql');
  const attach = text.slice(text.indexOf('FUNCTION public.format_attach_season('), text.indexOf('FUNCTION public.format_detach_season('));
  const detach = text.slice(text.indexOf('FUNCTION public.format_detach_season('));

  it('clears the runtime tables on every attach (a first one too: rows without a format belong to none) and on detach', () => {
    expect(attach).toMatch(/PERFORM public\.format__clear_runtime\(p_season_id\)/);
    // The confirmation guard only covers a replace; a first attach clears silently.
    expect(attach).toMatch(/IF v_replaced THEN\s+v_cleared := public\.format__guard_runtime_clear\([^;]*;\s+END IF;/);
    expect(detach).toMatch(/PERFORM public\.format__clear_runtime\(p_season_id\)/);
  });

  it('locks every phase row of the league FOR UPDATE, after the seasons row and before the started check, in attach and detach', () => {
    const helper = text.slice(text.indexOf('FUNCTION public.format__lock_phases('), text.indexOf('FUNCTION public.format__guard_runtime_clear('));
    expect(helper).toMatch(/FROM public\.tournaments t WHERE t\.season_id = p_season_id ORDER BY t\.id FOR UPDATE/);
    for (const [name, body] of [['attach', attach], ['detach', detach]] as const) {
      const seasons = body.indexOf('FOR UPDATE');
      const phases = body.indexOf('PERFORM public.format__lock_phases(p_season_id)');
      const started = body.indexOf('public.format_season_started(p_season_id)');
      expect(seasons, name).toBeGreaterThan(-1);
      expect(phases, name).toBeGreaterThan(seasons);
      expect(started, name).toBeGreaterThan(phases);
    }
  });

  it('binds a confirmed clear to the counts the admin saw: a table that grew since raises the signal again', () => {
    const guard = text.slice(text.indexOf('FUNCTION public.format__guard_runtime_clear('), text.indexOf('FUNCTION public.format_attach_season('));
    expect(guard).toMatch(/p_confirmed_counts jsonb DEFAULT NULL/);
    expect(guard).toMatch(/IF p_confirm AND p_confirmed_counts IS NOT NULL[\s\S]*v_links > coalesce\(\(p_confirmed_counts ->> 'links'\)::integer, 0\)[\s\S]*RAISE EXCEPTION 'FORMAT_RUNTIME_HAS_DATA'/);
    expect(attach).toMatch(/p_confirm_clear boolean DEFAULT false, p_confirmed_counts jsonb DEFAULT NULL\)/);
    expect(detach).toMatch(/p_confirm_clear boolean DEFAULT false, p_confirmed_counts jsonb DEFAULT NULL\) RETURNS jsonb/);
  });

  it('refuses to change format_type from or to custom under a format or after the start, in the database', () => {
    expect(text).toMatch(/CREATE TRIGGER trg_seasons_guard_format_type BEFORE UPDATE OF format_type ON public\.seasons/);
    expect(text).toMatch(/OLD\.format_type = 'custom' OR NEW\.format_type = 'custom'[\s\S]*season_formats f WHERE f\.season_id = OLD\.id[\s\S]*format_season_started\(OLD\.id\)[\s\S]*RAISE EXCEPTION 'season_format_type_locked'/);
  });

  it('refuses a replace and a detach over runtime data unless the caller confirms, before anything is deleted', () => {
    const guard = text.slice(text.indexOf('FUNCTION public.format__guard_runtime_clear('), text.indexOf('FUNCTION public.format_attach_season('));
    // The four tables a person or a draw fills, counted per league, and the signal with the four counts.
    for (const table of ['format_relation_links', 'format_resource_items', 'format_action_submissions', 'format_adjustments']) {
      expect(guard).toMatch(new RegExp(String.raw`FROM public\.${table}\s+WHERE season_id = p_season_id`));
    }
    expect(guard).toMatch(/RETURNS jsonb/);
    expect(guard).toMatch(/IF NOT p_confirm AND v_links \+ v_items \+ v_submissions \+ v_adjustments > 0 THEN/);
    expect(guard).toMatch(/RAISE EXCEPTION 'FORMAT_RUNTIME_HAS_DATA' USING ERRCODE = 'P0001', DETAIL = v_counts::text/);
    expect(guard).toMatch(/v_counts := jsonb_build_object\('links', v_links, 'items', v_items, 'submissions', v_submissions,\s+'adjustments', v_adjustments\)/);
    // The counts come back confirmed or not, so the caller can record what a confirmed clear deleted.
    expect(guard).toMatch(/RETURN v_counts;/);
    expect(guard).not.toMatch(/IF p_confirm THEN/);
    expect(guard).toMatch(/SET search_path = public, pg_temp/);
    expect(guard).not.toMatch(/SECURITY DEFINER/);

    expect(attach).toMatch(/p_confirm_clear boolean DEFAULT false, p_confirmed_counts jsonb DEFAULT NULL\)/);
    expect(attach).toMatch(
      /IF v_replaced THEN\s+v_cleared := public\.format__guard_runtime_clear\(p_season_id, coalesce\(p_confirm_clear, false\), p_confirmed_counts\);\s+END IF;/,
    );
    expect(attach).toMatch(/'removed_ruleset_ids', to_jsonb\(v_removed_rulesets\),\s+'cleared', v_cleared\)/);
    expect(detach).toMatch(/format_detach_season\(p_season_id uuid, p_confirm_clear boolean DEFAULT false, p_confirmed_counts jsonb DEFAULT NULL\)/);
    expect(detach).toMatch(
      /v_cleared := public\.format__guard_runtime_clear\(p_season_id, coalesce\(p_confirm_clear, false\), p_confirmed_counts\);[\s\S]*DELETE FROM public\.tournaments[\s\S]*PERFORM public\.format__clear_runtime\(p_season_id\)/,
    );
    expect(detach).toMatch(/'removed_ruleset_ids', to_jsonb\(v_removed_rulesets\),\s+'cleared', v_cleared\)/);
  });

  it('drops the two old signatures before it defines the new ones (a new argument is an overload)', () => {
    expect(text).toMatch(/DROP FUNCTION IF EXISTS public\.format_attach_season\(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb\);/);
    expect(text).toMatch(/DROP FUNCTION IF EXISTS public\.format_attach_season\(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb, boolean\);/);
    expect(text).toMatch(/DROP FUNCTION IF EXISTS public\.format_detach_season\(uuid\);/);
    expect(text).toMatch(/DROP FUNCTION IF EXISTS public\.format_detach_season\(uuid, boolean\);/);
    expect(text.indexOf('DROP FUNCTION IF EXISTS public.format_attach_season(')).toBeLessThan(text.indexOf('CREATE OR REPLACE FUNCTION public.format_attach_season('));
    expect(text.indexOf('DROP FUNCTION IF EXISTS public.format_detach_season(')).toBeLessThan(text.indexOf('CREATE OR REPLACE FUNCTION public.format_detach_season('));
  });

  it('keeps the guard and both functions service-role only, on their new signatures', () => {
    expect(text).toContain(
      'REVOKE ALL ON FUNCTION public.format_attach_season(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb, boolean, jsonb) FROM PUBLIC, anon, authenticated;',
    );
    expect(text).toContain(
      'GRANT EXECUTE ON FUNCTION public.format_attach_season(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb, boolean, jsonb) TO service_role;',
    );
    expect(text).toContain('REVOKE ALL ON FUNCTION public.format_detach_season(uuid, boolean, jsonb) FROM PUBLIC, anon, authenticated;');
    expect(text).toContain('GRANT EXECUTE ON FUNCTION public.format_detach_season(uuid, boolean, jsonb) TO service_role;');
    expect(text).toContain('REVOKE ALL ON FUNCTION public.format__guard_runtime_clear(uuid, boolean, jsonb) FROM PUBLIC, anon, authenticated;');
    expect(text).toContain('GRANT EXECUTE ON FUNCTION public.format__guard_runtime_clear(uuid, boolean, jsonb) TO service_role;');
    // No grant of an older detach or attach signature survives.
    expect(text).not.toMatch(/(?:GRANT|REVOKE)[^;]*format_detach_season\(uuid\)/);
    expect(text).not.toMatch(/(?:GRANT|REVOKE)[^;]*format_detach_season\(uuid, boolean\)/);
    expect(text).not.toMatch(/(?:GRANT|REVOKE)[^;]*format_attach_season\(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb\)[^,]/);
    expect(text).not.toMatch(/(?:GRANT|REVOKE)[^;]*format_attach_season\(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb, boolean\)[^,]/);
  });
});

describe('20261105120000 group numbers', () => {
  const text = sql('20261105120000_format_foreach_group.sql');

  it('gives a phase one group per number, so concurrent group forming collides instead of duplicating', () => {
    expect(text).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_groups_tournament_group_number\s+ON public\.tournament_groups \(tournament_id, group_number\)/,
    );
    // The index sits in the same transaction as the columns it belongs with, before the functions that use it.
    expect(text.indexOf('uq_tournament_groups_tournament_group_number')).toBeLessThan(text.indexOf('FUNCTION public.format_attach_season('));
    expect(text.indexOf('uq_tournament_groups_tournament_group_number')).toBeLessThan(text.lastIndexOf('COMMIT;'));
  });
});

describe('20261106090000 challenges', () => {
  const text = sql('20261106090000_format_challenges.sql');

  it('cancels a challenge only inside its league', () => {
    expect(text).toMatch(/format_challenge_cancel\(p_season_id uuid, p_challenge_id uuid, p_player uuid\)/);
    expect(text).toMatch(/WHERE id = p_challenge_id AND season_id = p_season_id FOR UPDATE/);
    expect(text).toMatch(/DROP FUNCTION IF EXISTS public\.format_challenge_cancel\(uuid, uuid\);/);
    expect(text.indexOf('DROP FUNCTION IF EXISTS public.format_challenge_cancel(')).toBeLessThan(
      text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_cancel('),
    );
    expect(text).not.toMatch(/(?:GRANT|REVOKE|COMMENT)[^;]*format_challenge_cancel\(uuid, uuid\)/);
  });

  it('answers a challenge only inside its league', () => {
    expect(text).toMatch(/format_challenge_respond\(p_season_id uuid, p_challenge_id uuid, p_player uuid, p_accept boolean\)/);
    expect(text).toMatch(/WHERE id = p_challenge_id AND season_id = p_season_id FOR UPDATE/);
    expect(text).toMatch(/DROP FUNCTION IF EXISTS public\.format_challenge_respond\(uuid, uuid, boolean\);/);
    expect(text.indexOf('DROP FUNCTION IF EXISTS public.format_challenge_respond(')).toBeLessThan(
      text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_respond('),
    );
    expect(text).not.toMatch(/(?:GRANT|REVOKE|COMMENT)[^;]*format_challenge_respond\(uuid, uuid, boolean\)/);
    expect(text).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*format_challenge_respond\(uuid, uuid, uuid, boolean\)[\s\S]*TO service_role/);
  });

  it('locks the phase row and both enrollment rows before the match insert, so a removal cannot slip in between', () => {
    const start = text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_respond(');
    const respond = text.slice(start, text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_cancel(', start));
    const phaseLock = respond.search(/FROM public\.tournaments t WHERE t\.id = v_row\.phase_id FOR SHARE;/);
    const enrolled = respond.search(/FROM public\.tournament_participants tp\s+WHERE tp\.tournament_id = v_row\.phase_id AND tp\.player_id IN \(v_row\.challenger_id, v_row\.defender_id\)\s+FOR KEY SHARE/);
    const insert = respond.indexOf('INSERT INTO public.matches');
    expect(phaseLock).toBeGreaterThan(-1);
    expect(enrolled).toBeGreaterThan(phaseLock);
    expect(insert).toBeGreaterThan(enrolled);
    // a challenge whose player left is cancelled before any match is made
    expect(respond.slice(enrolled, insert)).toMatch(/IF v_enrolled < 2 THEN[\s\S]*SET status = 'cancelled'[\s\S]*RETURN v_row;/);
  });

  it('reads the phase status under FOR SHARE, which conflicts with a status update, in create and in accept', () => {
    const create = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_create('), text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_respond('));
    const respond = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_respond('), text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_cancel('));
    // A FOR KEY SHARE does not conflict with the FOR NO KEY UPDATE of `UPDATE tournaments SET status`, so a completion could
    // slip between the read and the write that depends on it.
    expect(create).toMatch(/FROM public\.tournaments t WHERE t\.id = p_phase_id AND t\.season_id = p_season_id FOR SHARE;/);
    expect(create.indexOf('FOR SHARE;')).toBeGreaterThan(create.indexOf('pg_advisory_xact_lock'));
    expect(create.indexOf('FOR SHARE;')).toBeLessThan(create.indexOf("IF v_status = 'completed'"));
    expect(respond).toMatch(/FROM public\.tournaments t WHERE t\.id = v_row\.phase_id FOR SHARE;/);
    expect(text).not.toMatch(/FROM public\.tournaments t WHERE [^;]*FOR KEY SHARE;/);
  });

  it('locks the round row FOR SHARE and re-checks it is not completed before the accepted match is inserted', () => {
    const respond = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_respond('), text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_cancel('));
    const phaseLock = respond.indexOf('v_row.phase_id FOR SHARE;');
    const loop = respond.indexOf('LOOP\n');
    const roundLock = respond.search(/SELECT \(r\.status = 'completed'\) INTO v_round_done FROM public\.rounds r WHERE r\.id = v_round_id FOR SHARE;/);
    const insert = respond.indexOf('INSERT INTO public.matches');
    // lock order: the phase row, then the round row, then matches
    expect(phaseLock).toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(phaseLock);
    expect(roundLock).toBeGreaterThan(loop);
    expect(insert).toBeGreaterThan(roundLock);
    // a round that completed meanwhile is looked up again; none left is challenge_no_open_round
    expect(respond.slice(loop, insert)).toMatch(/EXIT WHEN v_round_done IS FALSE;\s+END LOOP;/);
    expect(respond.slice(loop, insert)).toMatch(/IF v_round_id IS NULL THEN\s+RAISE EXCEPTION 'challenge_no_open_round'/);
  });

  it('completes a round only under FOR UPDATE on its row, counting the unfinished matches after the lock', () => {
    const start = text.indexOf('CREATE OR REPLACE FUNCTION public.round_complete(');
    const fn = text.slice(start, text.indexOf('END $$;', start));
    const lock = fn.search(/FROM public\.rounds WHERE id = p_round_id FOR UPDATE;/);
    const count = fn.search(/count\(\*\) INTO v_unfinished FROM public\.matches m WHERE m\.round_id = p_round_id AND m\.status <> 'completed'/);
    const write = fn.indexOf("UPDATE public.rounds SET status = 'completed' WHERE id = p_round_id");
    expect(lock).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(lock);
    expect(write).toBeGreaterThan(count);
    // a refusal writes nothing; force completes with the count for the audit entry
    expect(fn.slice(count, write)).toMatch(/IF v_unfinished > 0 AND NOT p_force THEN\s+RETURN jsonb_build_object\('outcome', 'unfinished'/);
    expect(fn).toMatch(/'outcome', 'completed', 'round', to_jsonb\(v_row\), 'unfinished', v_unfinished/);
    // a repeat or a lost race changes nothing
    expect(fn.slice(lock, count)).toMatch(/v_row\.status = 'completed' THEN\s+RETURN jsonb_build_object\('outcome', 'already_completed'\)/);
  });

  it('ends a phase at its stage end only under FOR UPDATE on the phase row and only while no unseen match is unfinished', () => {
    const start = text.indexOf('CREATE OR REPLACE FUNCTION public.phase_complete_at_stage_end(');
    const fn = text.slice(start, text.indexOf('END $$;', start));
    const lock = fn.search(/FROM public\.tournaments WHERE id = p_phase_id FOR UPDATE;/);
    const unknown = fn.search(/m\.tournament_id = p_phase_id AND m\.status <> 'completed' AND m\.id <> ALL \(p_known_unfinished\)/);
    const write = fn.indexOf("UPDATE public.tournaments SET status = 'completed' WHERE id = p_phase_id");
    expect(lock).toBeGreaterThan(-1);
    expect(unknown).toBeGreaterThan(lock);
    expect(write).toBeGreaterThan(unknown);
    // only an active phase moves; an unseen unfinished match leaves it active
    expect(fn.slice(lock, unknown)).toMatch(/v_row\.status <> 'active' THEN\s+RETURN jsonb_build_object\('outcome', 'not_active'\)/);
    expect(fn.slice(unknown, write)).toMatch(/IF v_unknown > 0 THEN\s+RETURN jsonb_build_object\('outcome', 'unsettled'/);
    // a NULL id list would make `<> ALL` unknown for every match and complete the phase: it is refused
    expect(fn).toMatch(/p_known_unfinished IS NULL THEN\s+RAISE EXCEPTION 'invalid_op'/);
  });

  it('writes a round and its matches in one function that reads the phase status FOR NO KEY UPDATE before the first insert', () => {
    const start = text.indexOf('CREATE OR REPLACE FUNCTION public.round_write(');
    const fn = text.slice(start, text.indexOf('END $$;', start));
    const lock = fn.search(/FROM public\.tournaments t WHERE t\.id = p_tournament_id FOR NO KEY UPDATE;/);
    const refusal = fn.indexOf("RAISE EXCEPTION 'rounds_phase_completed'");
    const roundInsert = fn.indexOf('INSERT INTO public.rounds');
    const matchInsert = fn.indexOf('INSERT INTO public.matches');
    // The status is read under the lock a stage-end completion (FOR UPDATE) and a status write conflict with, then the round
    // and the matches go in, all in this one transaction: a completion either commits first (refused here) or waits for the
    // matches and finds them (`unsettled`).
    expect(lock).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(lock);
    expect(roundInsert).toBeGreaterThan(refusal);
    expect(matchInsert).toBeGreaterThan(roundInsert);
    expect(fn.slice(lock, refusal)).toMatch(/IF NOT FOUND THEN\s+RAISE EXCEPTION 'tournament_not_found'[\s\S]*IF v_status = 'completed' THEN\s+$/);
    // The phase row is never read FOR KEY SHARE (it would not conflict with a status UPDATE); the seasons row is, on purpose.
    expect(fn).not.toMatch(/FROM public\.tournaments[^;]*FOR KEY SHARE/);
    // a round that already exists (an interrupted call left it empty) gets the matches under the same lock, and must be the phase's own
    expect(fn).toMatch(/SELECT \* INTO v_round FROM public\.rounds r WHERE r\.id = p_round_id AND r\.tournament_id = p_tournament_id FOR UPDATE;\s+IF NOT FOUND THEN\s+RAISE EXCEPTION 'round_not_found'/);
    expect(fn.search(/p_round_id IS NULL THEN\s+INSERT INTO public\.rounds/)).toBeGreaterThan(refusal);
    // the matches are inserted in array order, with the phase and round the function resolved (not caller-supplied ids)
    expect(fn).toMatch(/INSERT INTO public\.matches \(round_id, tournament_id, player_1_id, player_2_id\)\s+SELECT v_round\.id, p_tournament_id, m\.player_1_id, m\.player_2_id[\s\S]*ORDER BY m\.ord;/);
    // a NULL or non-array match list would insert nothing and still return a round: refused
    expect(fn).toMatch(/p_matches IS NULL OR jsonb_typeof\(p_matches\) <> 'array'[\s\S]*RAISE EXCEPTION 'invalid_op'/);
  });

  it('locks an existing round FOR UPDATE after the phase and re-checks it under the lock before any match goes in', () => {
    const start = text.indexOf('CREATE OR REPLACE FUNCTION public.round_write(');
    const fn = text.slice(start, text.indexOf('END $$;', start));
    const phaseLock = fn.search(/FROM public\.tournaments t WHERE t\.id = p_tournament_id FOR NO KEY UPDATE;/);
    const roundLock = fn.search(/FROM public\.rounds r WHERE r\.id = p_round_id AND r\.tournament_id = p_tournament_id FOR UPDATE;/);
    const completed = fn.indexOf("RAISE EXCEPTION 'rounds_round_completed'");
    const filled = fn.search(/IF EXISTS \(SELECT 1 FROM public\.matches m WHERE m\.round_id = v_round\.id\) THEN\s+RAISE EXCEPTION 'rounds_round_already_written'/);
    const byes = fn.indexOf('UPDATE public.rounds SET bye_player_ids');
    const matchInsert = fn.indexOf('INSERT INTO public.matches');
    // lock order: the phase row, then the round row, then the matches; the byes are replaced only after both checks, so a
    // refused retry changes nothing
    expect(phaseLock).toBeGreaterThan(-1);
    expect(roundLock).toBeGreaterThan(phaseLock);
    expect(completed).toBeGreaterThan(roundLock);
    expect(filled).toBeGreaterThan(completed);
    expect(byes).toBeGreaterThan(filled);
    expect(matchInsert).toBeGreaterThan(byes);
    expect(fn.slice(completed - 70, completed)).toMatch(/IF v_round\.status = 'completed' THEN\s+$/);
  });

  it('reads the league engine FOR SHARE (after the seasons row, before the challenge row) and refuses a make or an accept unless it is kit', () => {
    const lockStart = text.indexOf('CREATE OR REPLACE FUNCTION public.format__lock_engine(');
    const lock = text.slice(lockStart, text.indexOf('END $$;', lockStart));
    // the lock order of format__check_revision: seasons KEY SHARE, then season_formats FOR SHARE
    expect(lock).toMatch(/FROM public\.seasons s WHERE s\.id = p_season_id FOR KEY SHARE;\s+SELECT f\.engine INTO v_engine FROM public\.season_formats f WHERE f\.season_id = p_season_id FOR SHARE;/);

    const create = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_create('), text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_respond('));
    const advisory = create.indexOf('pg_advisory_xact_lock');
    const createEngine = create.indexOf('public.format__lock_engine(p_season_id)');
    expect(createEngine).toBeGreaterThan(advisory);
    expect(createEngine).toBeLessThan(create.indexOf('FROM public.tournaments t WHERE t.id = p_phase_id'));
    expect(create).toMatch(/IF v_engine IS DISTINCT FROM 'kit' THEN[\s\S]*RAISE EXCEPTION 'challenge_phase_not_found'[\s\S]*RAISE EXCEPTION 'challenge_ladder_inactive'/);

    const respond = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_respond('), text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_cancel('));
    const respondEngine = respond.indexOf('v_engine := public.format__lock_engine(p_season_id);');
    const challengeLock = respond.indexOf('FROM public.format_challenges WHERE id = p_challenge_id AND season_id = p_season_id FOR UPDATE;');
    const decline = respond.indexOf("SET status = 'declined'");
    const refusal = respond.indexOf("RAISE EXCEPTION 'challenge_ladder_inactive'");
    const matchInsert = respond.indexOf('INSERT INTO public.matches');
    // A decline needs no engine, but it takes the seasons row FOR KEY SHARE (a league delete waits for it).
    expect(respond).toMatch(/IF p_accept THEN\s+v_engine := public\.format__lock_engine\(p_season_id\);\s+ELSE\s+PERFORM 1 FROM public\.seasons s WHERE s\.id = p_season_id FOR KEY SHARE;\s+END IF;/);
    // engine lock before the challenge row; a decline returns before the engine check (it only closes the challenge); the
    // refusal comes before the phase lock and the match insert
    expect(respondEngine).toBeGreaterThan(-1);
    expect(challengeLock).toBeGreaterThan(respondEngine);
    expect(refusal).toBeGreaterThan(decline);
    expect(refusal).toBeLessThan(respond.indexOf('v_row.phase_id FOR SHARE;'));
    expect(refusal).toBeLessThan(matchInsert);
    expect(respond.slice(refusal - 60, refusal)).toMatch(/IF v_engine IS DISTINCT FROM 'kit' THEN\s+$/);

    // withdrawing and expiring close a challenge and need no engine
    const cancel = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_cancel('), text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenges_expire('));
    expect(cancel).not.toMatch(/format__lock_engine|ladder_inactive/);
  });

  it('grants the engine lock helper to service_role only', () => {
    expect(text).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*public\.format__lock_engine\(uuid\),[^;]*FROM PUBLIC, anon, authenticated;/);
    expect(text).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*public\.format__lock_engine\(uuid\),[^;]*TO service_role;/);
  });

  it('does not put a status guard on every round and match insert: the writes into a completed tournament that are legitimate stay possible', () => {
    // A BEFORE INSERT trigger on rounds or matches would also refuse the league recycle bin restoring a completed league, the dev
    // seed, the bracket materialisation after an admin's result edit and the bracket regeneration. The guard lives in round_write,
    // which only the three round generators call.
    expect(text).not.toMatch(/CREATE TRIGGER[^;]*ON public\.(rounds|matches)/);
  });

  it('grants round_write and round_delete to service_role only', () => {
    expect(text).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*public\.round_write\(uuid, uuid, text, integer, integer, uuid\[\], jsonb, bigint\),\s+public\.round_delete\(uuid\)\s+FROM PUBLIC, anon, authenticated;/);
    expect(text).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*public\.round_write\(uuid, uuid, text, integer, integer, uuid\[\], jsonb, bigint\),\s+public\.round_delete\(uuid\)\s+TO service_role;/);
    // The seven-argument form is dropped, never granted.
    expect(text).toMatch(/DROP FUNCTION IF EXISTS public\.round_write\(uuid, uuid, text, integer, integer, uuid\[\], jsonb\);/);
  });

  it('takes the league locks before any phase lock in round_write: advisory lock, seasons KEY SHARE, then the revision, then the phase', () => {
    const start = text.indexOf('CREATE OR REPLACE FUNCTION public.round_write(');
    const fn = text.slice(start, text.indexOf('END $$;', start));
    const advisory = fn.indexOf('pg_advisory_xact_lock(hashtext(v_season::text))');
    const seasons = fn.indexOf('FROM public.seasons s WHERE s.id = v_season FOR KEY SHARE');
    const revision = fn.indexOf('PERFORM public.format__check_revision(v_season, p_expected_revision)');
    const phase = fn.search(/FROM public\.tournaments t WHERE t\.id = p_tournament_id FOR NO KEY UPDATE;/);
    expect(advisory).toBeGreaterThan(-1);
    expect(seasons).toBeGreaterThan(advisory);
    expect(revision).toBeGreaterThan(seasons);
    expect(phase).toBeGreaterThan(revision);
    // The phase moves with its first round, in the same transaction, after the matches are in.
    expect(fn.indexOf('INSERT INTO public.matches')).toBeLessThan(fn.search(/UPDATE public\.tournaments t\s+SET status = CASE WHEN t\.status = 'upcoming'/));
    expect(fn).toMatch(/current_round = GREATEST\(t\.current_round, v_round\.round_number\)/);
  });

  it('takes the seasons row FOR KEY SHARE in round_delete before the challenge, phase and round locks (league_trash_delete locks rounds before phases)', () => {
    const start = text.indexOf('CREATE OR REPLACE FUNCTION public.round_delete(');
    const fn = text.slice(start, text.indexOf('END $$;', start));
    const seasons = fn.indexOf('FROM public.seasons s WHERE s.id = v_season FOR KEY SHARE');
    const challenges = fn.indexOf('FROM public.format_challenges c WHERE c.phase_id = v_phase');
    const phase = fn.indexOf('FROM public.tournaments t WHERE t.id = v_phase FOR SHARE');
    const round = fn.indexOf('FROM public.rounds r WHERE r.id = p_round_id FOR UPDATE');
    expect(seasons).toBeGreaterThan(-1);
    expect(challenges).toBeGreaterThan(seasons);
    expect(phase).toBeGreaterThan(challenges);
    expect(round).toBeGreaterThan(phase);
  });

  it('locks challenge rows in id order in every bulk sweep, and clears format_challenges with the other runtime tables', () => {
    const create = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_create('), text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_respond('));
    expect(create.match(/ORDER BY x\.id FOR UPDATE\) ids/g)).toHaveLength(2);
    const expire = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenges_expire('), text.indexOf('CREATE OR REPLACE FUNCTION public.format__clear_runtime('));
    expect(expire).toMatch(/ORDER BY c\.season_id/);
    expect(expire).toMatch(/FROM public\.seasons s WHERE s\.id = v_season FOR KEY SHARE;[\s\S]*ORDER BY x\.id FOR UPDATE\) ids/);
    expect(text).toMatch(/CREATE OR REPLACE FUNCTION public\.format__clear_runtime\(p_season_id uuid\)[\s\S]*DELETE FROM public\.format_challenges\s+WHERE season_id = p_season_id;/);
  });

  it('shifts the stage calendar of a restored league through season_formats.clock_shift_seconds', () => {
    expect(text).toMatch(/p_rel = 'season_formats' THEN[\s\S]*jsonb_set\(r, '\{clock_shift_seconds\}'/);
    expect(text).toMatch(/IF p\.rel IN \([^)]*'season_formats'\) THEN/);
  });

  it('grants the two completion functions to service_role only', () => {
    expect(text).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*public\.round_complete\(uuid, boolean\),\s+public\.phase_complete_at_stage_end\(uuid, uuid\[\]\),[^;]*FROM PUBLIC, anon, authenticated;/);
    expect(text).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*public\.round_complete\(uuid, boolean\),\s+public\.phase_complete_at_stage_end\(uuid, uuid\[\]\),[^;]*TO service_role;/);
  });

  it('stores a withdrawal of a lapsed challenge as expired, which the cooldown counts, never as cancelled', () => {
    const cancel = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenge_cancel('), text.indexOf('CREATE OR REPLACE FUNCTION public.format_challenges_expire('));
    const lapsed = cancel.indexOf('IF v_row.expires_at <= now() THEN');
    expect(lapsed).toBeGreaterThan(cancel.indexOf("IF v_row.status <> 'open' THEN"));
    expect(cancel.slice(lapsed, cancel.indexOf('END IF;', lapsed))).toMatch(/SET status = 'expired' WHERE id = v_row\.id RETURNING \* INTO v_row;\s+RETURN v_row;/);
    expect(lapsed).toBeLessThan(cancel.indexOf("SET status = 'cancelled'"));
    // The cooldown counts everything but a withdrawal.
    expect(text).toMatch(/status <> 'cancelled' AND v_round - round < p_cooldown_rounds/);
  });
});
