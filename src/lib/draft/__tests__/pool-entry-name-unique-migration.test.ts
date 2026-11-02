/**
 * Static contract of 20261102150200_draft_pool_entries_folded_name_unique.sql. No DB: reads the migration text.
 * The behaviour on a real Postgres is pool-entry-name-unique.local.test.ts (`npm run test:db`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../../../../supabase/migrations/20261102150200_draft_pool_entries_folded_name_unique.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('20261102150200_draft_pool_entries_folded_name_unique.sql', () => {
  it('is a unique index on the season and the folded name, over the whole list', () => {
    expect(MIGRATION).toMatch(
      /CREATE UNIQUE INDEX uq_draft_pool_entries_season_folded_name\s+ON public\.draft_pool_entries \(season_id, public\.epb_fold_id\(pokemon_name\)\);/,
    );
  });

  it('aborts loudly on existing duplicates before it creates the index, under a lock timeout', () => {
    const check = MIGRATION.indexOf('RAISE EXCEPTION');
    const index = MIGRATION.indexOf('CREATE UNIQUE INDEX');
    expect(MIGRATION).toContain("SET LOCAL lock_timeout = '5s'");
    expect(check).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(check);
    expect(MIGRATION).toMatch(/HAVING count\(\*\) > 1/);
  });

  it('changes no data, table, policy or grant', () => {
    const statements = MIGRATION.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
    expect(statements).not.toMatch(/\b(INSERT INTO|UPDATE public|DELETE FROM)\b/i);
    expect(statements).not.toMatch(/CREATE TABLE|ALTER TABLE|POLICY|GRANT|REVOKE/i);
  });
});
