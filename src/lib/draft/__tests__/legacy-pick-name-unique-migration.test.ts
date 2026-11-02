/**
 * Static contract of 20261102140100_legacy_pick_name_unique.sql (issue #47). No DB: reads the migration text.
 *
 * - The index folds names with epb_fold_id and covers live legacy picks only (voided picks and line picks are outside).
 * - It never skips silently: a pre-check aborts, naming the pools, before the index is built.
 * - The route's id fold (toID) is the same fold, pinned by the id test next to it.
 *
 * The behaviour on a real Postgres is src/lib/draft/__tests__/legacy-pick-name-unique.local.test.ts (`npm run test:db`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const SQL = readFileSync(path.join(DIR, '20261102140100_legacy_pick_name_unique.sql'), 'utf8').replace(/\r\n/g, '\n');
const body = SQL.slice(SQL.indexOf('BEGIN;'));

describe('20261102140100_legacy_pick_name_unique.sql', () => {
  it('creates the unique index on the pool and the folded name, for live legacy picks only', () => {
    expect(body).toMatch(
      /CREATE UNIQUE INDEX uq_draft_picks_legacy_name_live\s+ON public\.draft_picks \(draft_pool_id, public\.epb_fold_id\(pokemon_name\)\)\s+WHERE voided_at IS NULL AND line_id IS NULL;/,
    );
  });

  it('aborts with the offending pool ids when duplicates exist, before the index is created', () => {
    const check = body.indexOf('RAISE EXCEPTION');
    const create = body.indexOf('CREATE UNIQUE INDEX');
    expect(check).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(check);
    expect(body).toMatch(/HAVING count\(\*\) > 1/);
    expect(body).toMatch(/resolve before applying\. Pools: %/);
    expect(body).not.toMatch(/IF NOT EXISTS/);
  });

  it('documents the read-only pre-check with the same predicate as the index', () => {
    expect(SQL).toContain('PRE-CHECK');
    expect(SQL).toMatch(/GROUP BY 1, 2 HAVING count\(\*\) > 1;/);
  });

  it('runs in one transaction under a lock timeout and changes no table, data or privilege', () => {
    expect(body).toMatch(/^BEGIN;\nSET LOCAL lock_timeout = '5s';/);
    expect(body.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(body).not.toMatch(/\b(UPDATE|DELETE|INSERT|GRANT|REVOKE|ALTER)\b/);
  });
});
