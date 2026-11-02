/**
 * Static contract of 20261102150000_draft_list_due_pools.sql (issue #49). No DB: reads the migration text.
 *
 * - The cron list and draft__tick decide "due" with the same two helpers, so they cannot drift apart.
 * - draft__tick is the 20261018140200 body except for the lines the helpers replace.
 * - Everything the file creates is revoked from the API roles and granted to service_role only.
 *
 * The behaviour on a real Postgres (30 open pools, only the 30th overdue) is
 * src/lib/draft/__tests__/draft-due-pools.local.test.ts (`npm run test:db`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const read = (file: string): string => readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = read('20261102150000_draft_list_due_pools.sql');
const BASE = read('20261018140200_draft_pool_completability.sql');

function fnBody(sql: string, signature: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${signature}`);
  if (start < 0) throw new Error(`missing ${signature}`);
  const dollar = sql.indexOf('$$', start);
  const end = sql.indexOf('$$', dollar + 2);
  return sql.slice(start, end + 2);
}

const lines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean);

describe('20261102150000_draft_list_due_pools.sql', () => {
  const lister = fnBody(MIGRATION, 'draft_list_due_pools(');
  const tick = fnBody(MIGRATION, 'draft__tick(');

  it('lists queue pools in submissions or drafting, due by the shared helpers, with the publish backoff', () => {
    expect(lister).toContain("p.engine = 'queue'");
    expect(lister).toContain("p.phase IN ('submissions', 'drafting')");
    expect(lister).toContain('public.draft__due_timeout(p)');
    expect(lister).toContain('public.draft__publish_deadline_passed(p)');
    expect(lister).toContain('public.draft__publish_retry_due(p)');
    expect(lister).toMatch(/LIMIT GREATEST\(COALESCE\(p_limit, 0\), 0\)/);
  });

  it('is read-only and stable', () => {
    expect(lister).toMatch(/LANGUAGE sql STABLE/);
    expect(lister).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it('draft__tick decides with the same helpers as the list', () => {
    expect(tick).toContain('v_due_timeout := public.draft__due_timeout(v_pool);');
    expect(tick).toContain('v_due_publish := public.draft__publish_deadline_passed(v_pool);');
    expect(tick).toContain('IF public.draft__publish_deadline_passed(v_pool) THEN');
  });

  it('the helpers are the conditions draft__tick used to spell out', () => {
    const timeout = fnBody(MIGRATION, 'draft__due_timeout(');
    expect(timeout).toContain("p_pool.phase = 'drafting' AND p_pool.paused_at IS NULL");
    expect(timeout).toContain("s.status = 'active' AND s.deadline_at <= now()");
    const publish = fnBody(MIGRATION, 'draft__publish_deadline_passed(');
    expect(publish).toContain("p_pool.kind = 'redraft' AND p_pool.phase = 'submissions' AND p_pool.submission_deadline_at <= now()");
  });

  it('draft__tick differs from its base only where the helpers replace the inline predicates', () => {
    const base = fnBody(BASE, 'draft__tick(');
    const baseLines = lines(base);
    const newLines = lines(tick);
    const removed = baseLines.filter((l) => !newLines.includes(l));
    const added = newLines.filter((l) => !baseLines.includes(l));
    expect(removed).toEqual([
      "v_due_timeout := v_pool.phase = 'drafting' AND v_pool.paused_at IS NULL AND EXISTS (",
      "SELECT 1 FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status = 'active' AND deadline_at <= now());",
      "v_due_publish := v_pool.kind = 'redraft' AND v_pool.phase = 'submissions' AND v_pool.submission_deadline_at <= now();",
      "IF v_pool.kind = 'redraft' AND v_pool.phase = 'submissions' AND v_pool.submission_deadline_at <= now() THEN",
    ]);
    expect(added).toEqual([
      'v_due_timeout := public.draft__due_timeout(v_pool);',
      'v_due_publish := public.draft__publish_deadline_passed(v_pool);',
      'IF public.draft__publish_deadline_passed(v_pool) THEN',
    ]);
  });

  it('every function it creates is service_role only', () => {
    const created = [...MIGRATION.matchAll(/CREATE OR REPLACE FUNCTION (public\.\w+\([^)]*\))/g)].map((m) => m[1]);
    expect(created.length).toBe(4);
    const revoke = MIGRATION.slice(MIGRATION.indexOf('REVOKE ALL ON FUNCTION'), MIGRATION.indexOf('GRANT EXECUTE'));
    const grant = MIGRATION.slice(MIGRATION.indexOf('GRANT EXECUTE'));
    for (const name of ['draft__due_timeout', 'draft__publish_deadline_passed', 'draft__tick', 'draft_list_due_pools']) {
      expect(revoke, name).toContain(`public.${name}(`);
      expect(grant, name).toContain(`public.${name}(`);
    }
    expect(revoke).toContain('FROM PUBLIC, anon, authenticated');
    expect(grant).toContain('TO service_role');
    expect(MIGRATION).not.toMatch(/TO (anon|authenticated|PUBLIC)\b/);
  });
});
