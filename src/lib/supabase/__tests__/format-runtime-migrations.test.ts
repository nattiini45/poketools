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
    // A new argument is an overload: the seven-argument form is dropped first and only the eight-argument form is granted.
    expect(text).toMatch(/DROP FUNCTION IF EXISTS public\.format_action_submit\(uuid, text, uuid, uuid, jsonb, jsonb, boolean\);/);
    expect(text.indexOf('DROP FUNCTION IF EXISTS public.format_action_submit(')).toBeLessThan(
      text.indexOf('CREATE OR REPLACE FUNCTION public.format_action_submit('),
    );
    expect(text).toMatch(/p_lock boolean,\s+p_only_if_unsubmitted boolean DEFAULT false\s*\) RETURNS public\.format_action_submissions/);
    expect(text).not.toMatch(/(?:GRANT|REVOKE|COMMENT)[^;]*format_action_submit\(uuid, text, uuid, uuid, jsonb, jsonb, boolean\)[^,]/);
    expect(text).toContain('public.format_action_submit(uuid, text, uuid, uuid, jsonb, jsonb, boolean, boolean)');

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

  it('keeps the internal helpers service-role only', () => {
    for (const fn of ['format__lock_action(uuid, text)', 'format__clear_runtime(uuid)']) {
      expect(text).toContain(`public.${fn}`);
    }
    expect(text).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*format__clear_runtime\(uuid\)[\s\S]*FROM PUBLIC, anon, authenticated/);
  });
});

describe('20261105120000 attach and detach', () => {
  const text = sql('20261105120000_format_foreach_group.sql');
  const attach = text.slice(text.indexOf('FUNCTION public.format_attach_season('), text.indexOf('FUNCTION public.format_detach_season('));
  const detach = text.slice(text.indexOf('FUNCTION public.format_detach_season('));

  it('clears the runtime tables when an attach replaces a format and on detach', () => {
    expect(attach).toMatch(/IF v_replaced THEN[\s\S]*PERFORM public\.format__clear_runtime\(p_season_id\)/);
    expect(detach).toMatch(/PERFORM public\.format__clear_runtime\(p_season_id\)/);
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

    expect(attach).toMatch(/p_confirm_clear boolean DEFAULT false\)/);
    expect(attach).toMatch(
      /IF v_replaced THEN\s+v_cleared := public\.format__guard_runtime_clear\(p_season_id, coalesce\(p_confirm_clear, false\)\);\s+PERFORM public\.format__clear_runtime\(p_season_id\)/,
    );
    expect(attach).toMatch(/'removed_ruleset_ids', to_jsonb\(v_removed_rulesets\),\s+'cleared', v_cleared\)/);
    expect(detach).toMatch(/format_detach_season\(p_season_id uuid, p_confirm_clear boolean DEFAULT false\)/);
    expect(detach).toMatch(
      /v_cleared := public\.format__guard_runtime_clear\(p_season_id, coalesce\(p_confirm_clear, false\)\);[\s\S]*DELETE FROM public\.tournaments[\s\S]*PERFORM public\.format__clear_runtime\(p_season_id\)/,
    );
    expect(detach).toMatch(/'removed_ruleset_ids', to_jsonb\(v_removed_rulesets\),\s+'cleared', v_cleared\)/);
  });

  it('drops the two old signatures before it defines the new ones (a new argument is an overload)', () => {
    expect(text).toMatch(/DROP FUNCTION IF EXISTS public\.format_attach_season\(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb\);/);
    expect(text).toMatch(/DROP FUNCTION IF EXISTS public\.format_detach_season\(uuid\);/);
    expect(text.indexOf('DROP FUNCTION IF EXISTS public.format_attach_season(')).toBeLessThan(text.indexOf('CREATE OR REPLACE FUNCTION public.format_attach_season('));
    expect(text.indexOf('DROP FUNCTION IF EXISTS public.format_detach_season(')).toBeLessThan(text.indexOf('CREATE OR REPLACE FUNCTION public.format_detach_season('));
  });

  it('keeps the guard and both functions service-role only, on their new signatures', () => {
    expect(text).toContain(
      'REVOKE ALL ON FUNCTION public.format_attach_season(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb, boolean) FROM PUBLIC, anon, authenticated;',
    );
    expect(text).toContain(
      'GRANT EXECUTE ON FUNCTION public.format_attach_season(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb, boolean) TO service_role;',
    );
    expect(text).toContain('REVOKE ALL ON FUNCTION public.format_detach_season(uuid, boolean) FROM PUBLIC, anon, authenticated;');
    expect(text).toContain('GRANT EXECUTE ON FUNCTION public.format_detach_season(uuid, boolean) TO service_role;');
    expect(text).toContain('REVOKE ALL ON FUNCTION public.format__guard_runtime_clear(uuid, boolean) FROM PUBLIC, anon, authenticated;');
    expect(text).toContain('GRANT EXECUTE ON FUNCTION public.format__guard_runtime_clear(uuid, boolean) TO service_role;');
    // No grant of the old, one-argument detach or the eight-argument attach survives.
    expect(text).not.toMatch(/(?:GRANT|REVOKE)[^;]*format_detach_season\(uuid\)/);
    expect(text).not.toMatch(/(?:GRANT|REVOKE)[^;]*format_attach_season\(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb\)[^,]/);
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
});
