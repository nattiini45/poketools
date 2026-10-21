/**
 * Shape of 20261018140300_epb_retire_trades.sql (consented trades retired). No DB: reads
 * the migration text.
 *
 * - pending requests are cancelled, the trade and legacy swap RPCs are dropped;
 * - redraft_trade_requests stays (read-only archive) with RLS on and no API-role writes;
 * - nothing is granted to anon / authenticated / PUBLIC and no function is created.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const FILE = '20261018140300_epb_retire_trades.sql';

function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

const sql = stripLineComments(readFileSync(path.join(MIGRATIONS_DIR, FILE), 'utf8'));

describe(FILE, () => {
  it('cancels every pending trade request', () => {
    expect(sql).toMatch(
      /UPDATE\s+public\.redraft_trade_requests\s+SET\s+status\s*=\s*'cancelled',\s*cancelled_at\s*=\s*now\(\)\s+WHERE\s+status\s*=\s*'pending';/,
    );
  });

  it('drops the trade execute RPC and the legacy swap RPC', () => {
    expect(sql).toMatch(/DROP\s+FUNCTION\s+public\.epb_execute_trade_request\(uuid,\s*jsonb\);/);
    expect(sql).toMatch(/DROP\s+FUNCTION\s+public\.epb_execute_redraft\(uuid,\s*jsonb\);/);
  });

  it('keeps the table (no DROP TABLE) with RLS on and as a read-only archive', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.redraft_trade_requests\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY;/);
    expect(sql).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.redraft_trade_requests\s+FROM\s+PUBLIC,\s*anon,\s*authenticated;/);
    expect(sql).toMatch(
      /REVOKE\s+INSERT,\s*UPDATE,\s*TRUNCATE\s+ON\s+TABLE\s+public\.redraft_trade_requests\s+FROM\s+service_role;/,
    );
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
  });

  it('grants nothing and creates no function', () => {
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
  });

  it('sorts after every migration that defines or replaces a dropped RPC', () => {
    const definers = readdirSync(MIGRATIONS_DIR).filter((f) => {
      if (!f.endsWith('.sql') || f === FILE) return false;
      const body = stripLineComments(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
      return /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(epb_execute_trade_request|epb_execute_redraft)\s*\(/.test(body);
    });
    expect(definers.length).toBeGreaterThan(0);
    for (const f of definers) expect(f < FILE, `${f} sorts before ${FILE}`).toBe(true);
  });
});
