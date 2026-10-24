import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

// The migration that stores Swiss / round robin byes on the round.
// Static check (no database). The API-role grant guard itself is
// migration-api-grants.test.ts, which replays this file with the others.
const MIGRATION = '20261023145151_rounds_bye_player_ids.sql';
const sql = readFileSync(path.join(process.cwd(), 'supabase', 'migrations', MIGRATION), 'utf8');

describe(MIGRATION, () => {
  it('adds a NOT NULL uuid[] column defaulting to the empty array, so legacy rounds hold {}', () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.rounds\s+ADD COLUMN bye_player_ids uuid\[\] NOT NULL DEFAULT '\{\}'/,
    );
  });

  it('documents the column', () => {
    expect(sql).toMatch(/COMMENT ON COLUMN public\.rounds\.bye_player_ids IS/);
  });

  it('grants nothing and touches no policy (the column inherits the table privileges)', () => {
    const code = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(code).not.toMatch(/\bGRANT\b/i);
    expect(code).not.toMatch(/\bPOLICY\b/i);
    expect(code).not.toMatch(/\b(anon|authenticated|PUBLIC)\b/);
  });
});
