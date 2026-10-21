import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Static guard (no database) for the aggregate queue migration (code review
// H6, M1, M2). The behaviour itself needs a Postgres; these checks pin the
// properties that make it safe, so an edit cannot drop them unnoticed.
const SQL = readFileSync(
  path.join(process.cwd(), 'supabase', 'migrations', '20261018130100_aggregate_apply_atomic.sql'),
  'utf8',
);

/** The body of one function definition, from its CREATE to the closing `$$;`. */
function functionBody(name: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const end = SQL.indexOf('$$;', SQL.indexOf('AS $$', start));
  return SQL.slice(start, end);
}

/** Strips `--` comments so assertions only see executable SQL. */
function code(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

describe('20261018130100_aggregate_apply_atomic.sql', () => {
  it('runs in one transaction', () => {
    expect(code(SQL)).toMatch(/^BEGIN;/m);
    expect(code(SQL).trim()).toMatch(/COMMIT;$/);
  });

  it('apply_aggregate_job fences on the job, locks the game, applies and marks in that order', () => {
    const body = code(functionBody('apply_aggregate_job'));
    const fence = body.search(/UPDATE aggregate_jobs\s+SET status = 'completed'[\s\S]*?WHERE id = p_job_id AND status = 'processing'/);
    const lock = body.search(/FROM games WHERE id = p_game_id FOR UPDATE/);
    const marker = body.search(/IF v_applied_at IS NOT NULL THEN\s+RETURN 'already_applied'/);
    const upsert = body.indexOf('PERFORM batch_upsert_aggregates(p_aggregate_deltas)');
    const playerUpsert = body.indexOf('PERFORM batch_upsert_player_aggregates(p_player_deltas)');
    const mark = body.indexOf('UPDATE games SET aggregate_applied_at = now() WHERE id = p_game_id');

    for (const position of [fence, lock, marker, upsert, playerUpsert, mark]) {
      expect(position).toBeGreaterThan(-1);
    }
    expect(fence).toBeLessThan(lock);
    expect(lock).toBeLessThan(marker);
    expect(marker).toBeLessThan(upsert);
    expect(upsert).toBeLessThan(playerUpsert);
    expect(playerUpsert).toBeLessThan(mark);
  });

  it('apply_aggregate_job returns exactly the outcome codes the TS wrapper knows', () => {
    const outcomes = [...code(functionBody('apply_aggregate_job')).matchAll(/RETURN '([a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(outcomes)).toEqual(new Set(['applied', 'already_applied', 'game_missing', 'job_not_processing']));
  });

  it('apply_aggregate_job refuses deltas for another game instead of applying them', () => {
    expect(code(functionBody('apply_aggregate_job'))).toMatch(
      /IF v_job_game_id IS DISTINCT FROM p_game_id THEN\s+RAISE EXCEPTION/,
    );
  });

  it('reclaim ends attempts-exhausted jobs as failed instead of stranding them pending', () => {
    const body = code(functionBody('reclaim_stale_aggregate_jobs'));
    expect(body).toMatch(/SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END/);
    expect(body).toMatch(/WHERE status = 'processing'\s+AND updated_at < now\(\) - INTERVAL '5 minutes'/);
    expect(body).toMatch(/RETURNS integer/);
  });

  it('the health probe counts unclaimable pending and long-stuck processing rows', () => {
    const body = code(functionBody('aggregate_job_health'));
    expect(body).toMatch(/status = 'pending' AND attempts >= max_attempts/);
    expect(body).toMatch(/status = 'processing' AND updated_at < now\(\) - INTERVAL '15 minutes'/);
    expect(body).toMatch(/STABLE/);
  });

  it.each(['apply_aggregate_job', 'reclaim_stale_aggregate_jobs', 'aggregate_job_health'])(
    '%s pins search_path and is not SECURITY DEFINER',
    (name) => {
      const body = code(functionBody(name));
      expect(body).toMatch(/SET search_path = public/);
      expect(body).not.toMatch(/SECURITY DEFINER/i);
    },
  );

  it('grants the three functions to service_role only', () => {
    const sql = code(SQL);
    const signatures = [
      'public.apply_aggregate_job(uuid, uuid, jsonb, jsonb)',
      'public.reclaim_stale_aggregate_jobs()',
      'public.aggregate_job_health()',
    ];
    const revoke = sql.match(/REVOKE ALL ON FUNCTION([\s\S]*?)FROM PUBLIC, anon, authenticated;/);
    const grant = sql.match(/GRANT EXECUTE ON FUNCTION([\s\S]*?)TO service_role;/);
    expect(revoke).not.toBeNull();
    expect(grant).not.toBeNull();
    for (const signature of signatures) {
      expect(revoke?.[1]).toContain(signature);
      expect(grant?.[1]).toContain(signature);
    }
    expect(sql).not.toMatch(/GRANT[^;]*\bTO\s+(anon|authenticated|PUBLIC)\b/i);
  });
});
