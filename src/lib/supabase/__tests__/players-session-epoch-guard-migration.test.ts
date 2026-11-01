/**
 * The session epoch guard in SQL (20261102111000_players_session_epoch_guard.sql). No DB: reads the
 * migration text. The behaviour itself (monotonic epoch, revocation inside the guest claim) was replayed
 * against the local stack when the migration was written; grants of the new function are also covered
 * by the generic replay in migration-api-grants.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = '20261102111000_players_session_epoch_guard.sql';

/** Drop `--` line comments so prose never counts, and collapse whitespace. */
function code(sql: string): string {
  return sql
    .split('\n')
    .map((line) => (line.includes('--') ? line.slice(0, line.indexOf('--')) : line))
    .join('\n')
    .replace(/\s+/g, ' ');
}

const sql = code(readFileSync(path.join(process.cwd(), 'supabase', 'migrations', FILE), 'utf8'));
const fnStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.players_session_epoch_guard()');
const fnBody = sql.slice(fnStart, sql.indexOf('$$;', fnStart));

describe(FILE, () => {
  it('keeps the epoch monotonic with GREATEST of the old and the written value', () => {
    expect(fnBody).toMatch(/NEW\.sessions_valid_after := GREATEST\(OLD\.sessions_valid_after, NEW\.sessions_valid_after\)/);
  });

  it('moves the epoch to the database clock when a guest row becomes a registered player', () => {
    expect(fnBody).toMatch(/IF OLD\.is_guest AND NOT NEW\.is_guest THEN/);
    expect(fnBody).toMatch(
      /GREATEST\(OLD\.sessions_valid_after, NEW\.sessions_valid_after, clock_timestamp\(\)\)/,
    );
  });

  it('fires before each UPDATE that changes the epoch or the guest flag, and for no other', () => {
    expect(sql).toMatch(/CREATE TRIGGER players_session_epoch_guard BEFORE UPDATE ON public\.players FOR EACH ROW/);
    expect(sql).toMatch(
      /WHEN \( OLD\.sessions_valid_after IS DISTINCT FROM NEW\.sessions_valid_after OR \(OLD\.is_guest AND NOT NEW\.is_guest\) \)/,
    );
  });

  it('pins the search_path and is not executable by an API role', () => {
    expect(fnBody).toMatch(/SET search_path = ''/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.players_session_epoch_guard\(\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(sql).not.toMatch(/GRANT [^;]* ON FUNCTION public\.players_session_epoch_guard/i);
  });

  it('runs in one transaction with a lock timeout', () => {
    expect(sql.indexOf('BEGIN;')).toBeGreaterThan(-1);
    expect(sql).toMatch(/SET LOCAL lock_timeout = '5s';/);
    expect(sql.lastIndexOf('COMMIT;')).toBeGreaterThan(sql.indexOf('CREATE TRIGGER'));
  });
});
