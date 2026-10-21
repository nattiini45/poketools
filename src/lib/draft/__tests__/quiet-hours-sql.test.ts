/**
 * Static contract of the quiet-hours migration. No DB: reads the migration text.
 *
 * - Each replaced RPC is a verbatim copy of its latest definition except the clock lines: the lines of the base body
 *   that are gone are exactly the wall-clock arithmetic (and the declarations / insert lists the quiet columns join).
 * - Every function the file creates is revoked from the API roles and granted to service_role in the same file.
 * - Raises are coded draft errors (`errors/draft`) or internal invariants (`INTERNAL_DRAFT_CODES` or `draft__…`,
 *   a logged 500).
 * - Every wall-clock deadline formula of the draft clock now goes through the running-time helpers.
 *
 * The helpers' numbers are covered by quiet-hours.test.ts (TS mirror) and, on a local stack, by the opt-in parity
 * test quiet-hours-sql-parity.live-db.test.ts (LOCAL_DB_URL): the same vectors (fixtures/quiet-hours-vectors.json)
 * plus a sweep across both DST nights, run through the SQL helpers and the TS mirror.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTERNAL_DRAFT_CODES, isDraftErrorCode } from '@/lib/draft/errors';

const DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const read = (file: string): string => readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n');
const QUIET = read('20261018140100_draft_quiet_hours.sql');

function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  return sql.slice(start, sql.indexOf('END $$;', start) + 'END $$;'.length);
}

const BASES: Record<string, string> = {
  draft__activate_next: '20261012094028_draft_review_fixes.sql',
  draft__resume: '20261012024916_draft_rpcs.sql',
  draft_use_extension: '20261012024916_draft_rpcs.sql',
  draft_set_paused: '20261012024916_draft_rpcs.sql',
  draft__build_snapshot: '20261012024916_draft_rpcs.sql',
  draft_my_turn: '20261012065613_draft_live_turn_pings.sql',
  draft_claim_notifications: '20261012065613_draft_live_turn_pings.sql',
  draft_create_pool: '20261012024916_draft_rpcs.sql',
};

/** Base lines (trimmed) that the quiet-hours copy no longer contains. */
const EXPECTED_REMOVED: Record<string, string[]> = {
  draft__activate_next: [
    "deadline_at = CASE WHEN v_pool.paused_at IS NULL THEN p_at + v_secs * interval '1 second' ELSE NULL END,",
  ],
  draft__resume: [
    'DECLARE v_ms integer;',
    "SET deadline_at = now() + COALESCE(remaining_ms_at_pause, timer_seconds * 1000, 0) * interval '1 millisecond',",
    'RETURNING COALESCE(EXTRACT(EPOCH FROM (deadline_at - now())) * 1000, 0)::int INTO v_ms;',
  ],
  draft_use_extension: [
    "SET deadline_at = deadline_at + v_secs * interval '1 second', extension_seconds = extension_seconds + v_secs",
  ],
  draft_set_paused: [
    'SET remaining_ms_at_pause = GREATEST(0, EXTRACT(EPOCH FROM (deadline_at - now())) * 1000)::int, deadline_at = NULL',
  ],
  draft__build_snapshot: [
    "'submission_deadline_at', p_pool.submission_deadline_at, 'token_purchase_closes_at', p_pool.token_purchase_closes_at),",
  ],
  draft_my_turn: [],
  draft_claim_notifications: [
    "| ((s.deadline_at - now() <= interval '8 hours')::int)",
    "| (((s.deadline_at - now() <= interval '4 hours')::int) << 1)",
    "| (((s.deadline_at - now() <= interval '1 hour')::int) << 2))::smallint",
    'SELECT s.id,',
    "(((s.deadline_at - now() <= interval '8 hours')::int)",
    "| (((s.deadline_at - now() <= interval '4 hours')::int) << 1)",
    "| (((s.deadline_at - now() <= interval '1 hour')::int) << 2)) AS crossed,",
    's.reminder_mask',
  ],
  draft_create_pool: [
    'v_n integer; v_replaced uuid;',
    // Comment only: the copy names the league neutrally; the applied base keeps its wording (never edited).
    '-- the live EvoLiga season created its pool row before the queue engine existed. It is replaced, not a conflict.',
    'redraft_lock_no_redraft_lines, token_purchase_closes_at, created_by)',
    'v_roster, v_pick, v_makeup, v_ladder, v_ext_enabled, v_max_lines, v_lock, v_closes, p_actor_id)',
    'redraft_lock_no_redraft_lines, submission_deadline_at, created_by)',
    'v_ladder, v_ext_enabled, COALESCE(v_max_lines, 3), v_lock, v_deadline, p_actor_id)',
  ],
};

describe('quiet-hours migration: replaced RPCs are verbatim copies except the clock', () => {
  it.each(Object.entries(BASES))('%s', (name, baseFile) => {
    const base = fnBody(read(baseFile), name).split('\n');
    const copy = new Set(fnBody(QUIET, name).split('\n'));
    const removed = base.filter((line) => !copy.has(line)).map((line) => line.trim());
    expect(removed).toEqual(EXPECTED_REMOVED[name]);
  });

  it('every replaced clock formula now uses the running-time helpers', () => {
    expect(fnBody(QUIET, 'draft__activate_next')).toContain('public.draft__add_running_ms(p_at, v_secs::bigint * 1000,');
    expect(fnBody(QUIET, 'draft__resume')).toMatch(/draft__add_running_ms\(now\(\)[\s\S]*draft__running_ms\(now\(\), deadline_at/);
    expect(fnBody(QUIET, 'draft_use_extension')).toContain('public.draft__add_running_ms(deadline_at, v_secs::bigint * 1000,');
    expect(fnBody(QUIET, 'draft_set_paused')).toContain('public.draft__running_ms(now(), deadline_at,');
    const claim = fnBody(QUIET, 'draft_claim_notifications');
    expect(claim.match(/draft__quiet_window_end\(now\(\), p\.quiet_start_hour/g)).toHaveLength(2); // turn_started + reminders
    expect(claim).not.toMatch(/deadline_at - now\(\)/);
    expect(fnBody(QUIET, 'draft_create_pool')).toContain('FROM public.draft__cfg_quiet(p_config) q;');
  });
});

describe('quiet-hours migration: privileges, columns and raises', () => {
  const created = [...QUIET.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
  const revokeBlock = QUIET.slice(QUIET.indexOf('REVOKE ALL ON FUNCTION'), QUIET.indexOf('FROM PUBLIC, anon, authenticated;'));
  const grantBlock = QUIET.slice(QUIET.indexOf('GRANT EXECUTE ON FUNCTION'), QUIET.indexOf('TO service_role;'));

  it('creates the seven helpers and replaces the eight RPCs', () => {
    expect(new Set(created)).toEqual(
      new Set([
        'draft__quiet_bounds',
        'draft__quiet_window_end',
        'draft__quiet_next_start',
        'draft__running_ms',
        'draft__add_running_ms',
        'draft__quiet_hours_json',
        'draft__cfg_quiet',
        ...Object.keys(BASES),
      ]),
    );
  });

  it.each(created)('%s is revoked from the API roles and granted to service_role only', (name) => {
    expect(revokeBlock).toContain(`public.${name}(`);
    expect(grantBlock).toContain(`public.${name}(`);
  });

  it('grants nothing to anon or authenticated', () => {
    expect(QUIET).not.toMatch(/GRANT[^;]*\b(anon|authenticated)\b/);
  });

  it('adds the three nullable pool columns with an all-or-nothing CHECK that keeps the clock running daily', () => {
    expect(QUIET).toContain('ADD COLUMN quiet_start_hour smallint,');
    expect(QUIET).toContain('ADD COLUMN quiet_end_hour smallint,');
    expect(QUIET).toContain('ADD COLUMN quiet_timezone text,');
    expect(QUIET).toContain('(quiet_start_hour IS NULL AND quiet_end_hour IS NULL AND quiet_timezone IS NULL)');
    expect(QUIET).toContain('quiet_end_hour - quiet_start_hour <= 23');
  });

  it('raises only coded draft errors (with their {field}) or internal invariants', () => {
    const raises = [...QUIET.matchAll(/RAISE EXCEPTION '([^']+)'([^;]*);/g)];
    expect(raises.length).toBeGreaterThan(5);
    for (const [, text, rest] of raises) {
      if (text.startsWith('draft__')) {
        expect(rest).toContain("ERRCODE = 'XX000'");
        continue;
      }
      expect(isDraftErrorCode(text) || (INTERNAL_DRAFT_CODES as readonly string[]).includes(text)).toBe(true);
      if (text === 'INVALID_CONFIG') expect(rest).toContain("jsonb_build_object('field',");
    }
  });

  it('leaves draft_configure untouched (quiet hours are creation-only)', () => {
    expect(QUIET).not.toContain('FUNCTION public.draft_configure(');
  });
});
