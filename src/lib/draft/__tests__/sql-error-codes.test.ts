/**
 * The SQL error contract of the draft RPCs. No DB: reads the draft RPC migration text and the later RPC replacements (20261018140000_epb_comeback_rules.sql).
 *
 * - Every `RAISE EXCEPTION '<CODE>'` in M5–M7 is a key of `errors/draft` or an
 *   SQL-internal invariant (`INTERNAL_DRAFT_CODES`, surfaced as a logged 500).
 * - Every raise of a code whose English message has `{placeholders}` carries
 *   them in its DETAIL json (rpc-errors.ts turns those keys into `params`).
 * - The only other raise texts are the legacy messages of the retired
 *   `epb_execute_trade_request` (applied 20261012025134; dropped by
 *   20261018140300_epb_retire_trades.sql, so no live RPC raises them).
 * - Every function a migration creates is revoked from the API roles and
 *   granted to service_role in the same file.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRAFT_ERROR_CODES, INTERNAL_DRAFT_CODES, isDraftErrorCode, paramNamesOf } from '@/lib/draft/errors';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const RPC_MIGRATION_NAMES = [
  '_draft_rpcs.sql',
  '_redraft_rpcs.sql',
  '_epb_token_rpcs.sql',
  '_epb_comeback_rules.sql',
  '_draft_pool_completability.sql',
  // League groups (group-scoped draft engine, the group guards and season_groups_replace).
  '_league_groups.sql',
  // League groups, round 4: the schedule lock, group size, coverage and the substitution guard.
  '_league_groups_locks.sql',
] as const;

/** Raise texts of the retired epb_execute_trade_request (dropped by 20261018140300_epb_retire_trades.sql). */
const LEGACY_TRADE_TEXTS: readonly string[] = [
  'Trade request not found',
  'request_not_executable',
  'phase_closed',
  'insufficient_points',
  'Source tracker % not found for this player in this season',
  'Line % is already owned by another player',
];

interface Raise {
  file: string;
  text: string;
  statement: string;
}

function loadRpcMigrations(): { file: string; sql: string }[] {
  const files = readdirSync(MIGRATIONS_DIR);
  return RPC_MIGRATION_NAMES.map((suffix) => {
    const matches = files.filter((f) => f.endsWith(suffix));
    if (matches.length !== 1) throw new Error(`expected exactly one migration *${suffix}, found ${matches.length}`);
    return { file: matches[0], sql: readFileSync(path.join(MIGRATIONS_DIR, matches[0]), 'utf8') };
  });
}

/** Drop `--` line comments so commented-out examples never count. */
function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

function raisesOf(file: string, sql: string): Raise[] {
  const body = stripLineComments(sql);
  const out: Raise[] = [];
  const re = /RAISE\s+EXCEPTION\s+'((?:[^']|'')*)'/g;
  for (const m of body.matchAll(re)) {
    const start = m.index ?? 0;
    const end = body.indexOf(';', start);
    out.push({ file, text: m[1], statement: body.slice(start, end === -1 ? undefined : end) });
  }
  return out;
}

const migrations = loadRpcMigrations();
const raises = migrations.flatMap((m) => raisesOf(m.file, m.sql));
const CODE = /^[A-Z][A-Z0-9_]*$/;
const internal: ReadonlySet<string> = new Set(INTERNAL_DRAFT_CODES);

describe('draft RPC error codes (M5–M7)', () => {
  it('finds the RPC migrations and their raises', () => {
    expect(migrations).toHaveLength(RPC_MIGRATION_NAMES.length);
    expect(raises.length).toBeGreaterThan(50);
  });

  it('raises only catalog codes, internal invariants or the legacy trade texts', () => {
    const unknown = raises.filter((r) =>
      CODE.test(r.text) ? !isDraftErrorCode(r.text) && !internal.has(r.text) : !LEGACY_TRADE_TEXTS.includes(r.text),
    );
    expect(unknown.map((r) => `${r.file}: ${r.text}`)).toEqual([]);
  });

  it('keeps the legacy trade texts inside the retired epb_execute_trade_request only', () => {
    const legacy = raises.filter((r) => !CODE.test(r.text));
    for (const r of legacy) expect(r.file, r.text).toMatch(/_epb_token_rpcs\.sql$/);
    const tradeBody = migrations[2].sql.slice(migrations[2].sql.indexOf('FUNCTION public.epb_execute_trade_request'));
    for (const r of legacy) expect(tradeBody, r.text).toContain(`'${r.text}'`);
  });

  it('drops epb_execute_trade_request in a later migration, so the legacy texts are dead', () => {
    const retire = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('_epb_retire_trades.sql'));
    expect(retire).toHaveLength(1);
    const sql = stripLineComments(readFileSync(path.join(MIGRATIONS_DIR, retire[0]), 'utf8'));
    expect(sql).toMatch(/DROP\s+FUNCTION\s+public\.epb_execute_trade_request\(uuid,\s*jsonb\);/);
    expect(retire[0] > migrations[2].file, 'the drop sorts after the last trade body').toBe(true);
  });

  it('every raise uses SQLSTATE P0001', () => {
    const wrong = raises.filter((r) => !/USING\s+ERRCODE\s*=\s*'P0001'/.test(r.statement));
    expect(wrong.map((r) => `${r.file}: ${r.text}`)).toEqual([]);
  });

  it('passes every {placeholder} of the English message in DETAIL', () => {
    const missing: string[] = [];
    for (const r of raises) {
      if (!CODE.test(r.text) || !isDraftErrorCode(r.text)) continue;
      for (const name of paramNamesOf(r.text)) {
        if (!new RegExp(`DETAIL\\s*=[\\s\\S]*'${name}'`).test(r.statement)) missing.push(`${r.file}: ${r.text} {${name}}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('raises every queue-engine, redraft and token code that SQL owns', () => {
    const raised = new Set(raises.map((r) => r.text));
    const sqlOwned = [
      'POOL_NOT_FOUND', 'POOL_ENGINE_LEGACY', 'ACTOR_NOT_ALLOWED', 'OVERRIDE_REASON_REQUIRED', 'DRAFT_NOT_ACTIVE',
      'DRAFT_NOT_STARTED', 'DRAFT_ALREADY_STARTED', 'DRAFT_COMPLETE', 'SUBMISSION_PHASE', 'DRAFT_PAUSED', 'ALREADY_PAUSED',
      'NOT_PAUSED', 'BLOCKED_SLOT_UNRESOLVED', 'STALE_SLOT', 'NOT_YOUR_TURN', 'NOT_PARTICIPANT', 'SLOT_BLOCKED',
      'SLOT_NOT_BLOCKED', 'NOT_IN_LIST', 'LINE_TAKEN', 'OWN_REDRAFT_DROP', 'LINE_RESTRICTED', 'COSMOG_REDRAFT_LOCKED',
      'ROSTER_FULL', 'INSUFFICIENT_BUDGET', 'BUDGET_INFEASIBLE', 'NOT_ENOUGH_LINES', 'REDRAFT_SLOT_REQUIRED',
      'REDRAFT_SLOT_INVALID', 'REDRAFT_SLOT_FILLED', 'REQUEST_ID_REUSED', 'EXTENSION_NOT_ALLOWED', 'EXTENSION_USED',
      'PICK_NOT_FOUND', 'PICK_ALREADY_VOIDED', 'CORRECTION_REQUIRES_PAUSE', 'VOID_BLOCKED_PROGRESS', 'SUBMISSION_LOCKED',
      'REDRAFT_MAX_EXCEEDED', 'TRACKER_NOT_OWNED', 'LINE_NOT_DROPPABLE', 'SUBMISSIONS_NOT_DUE',
      'SUBMISSIONS_ALREADY_PUBLISHED', 'INITIAL_DRAFT_NOT_COMPLETE', 'RESTORE_WOULD_OVERDRAW', 'POOL_EXISTS',
      'SEASON_HAS_NO_LIST', 'SEATS_INVALID', 'INVALID_CONFIG', 'TOKEN_WINDOW_CLOSED', 'TOKEN_PLAYER_LIMIT',
      'TOKEN_LINE_LIMIT', 'TOKEN_POINTS_SHORT', 'TOKEN_WOULD_EVOLVE', 'LINE_FULLY_EVOLVED', 'COMEBACK_NOT_YET',
      'COMEBACK_BALANCE_SHORT', 'COMEBACK_TOKENS_NOT_MULTIPLE', 'THRESHOLDS_REQUIRED', 'ACTIVE_SLOT_EXISTS',
      'POOL_NOT_COMPLETABLE', 'POOL_CHECK_LIMIT', 'LEAGUE_NOT_COMPLETABLE', 'REDRAFT_NOT_COMPLETABLE',
      'DRAFT_ABORT_NOT_ALLOWED', 'COMPLETABILITY_INVARIANT',
    ];
    for (const code of sqlOwned) {
      expect(isDraftErrorCode(code) || internal.has(code), `${code} is a catalog or internal code`).toBe(true);
      expect(raised.has(code), `${code} raised by M5–M7`).toBe(true);
    }
    expect(DRAFT_ERROR_CODES.length).toBeGreaterThan(sqlOwned.length - INTERNAL_DRAFT_CODES.length);
  });

  it('revokes every created function from the API roles and grants it to service_role', () => {
    for (const { file, sql } of migrations) {
      const body = stripLineComments(sql);
      const created = [...body.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\s*\(/g)].map((m) => m[1]);
      const revoke = body.slice(body.lastIndexOf('REVOKE ALL ON FUNCTION'));
      const grantStart = revoke.indexOf('GRANT EXECUTE ON FUNCTION');
      expect(grantStart, file).toBeGreaterThan(0);
      const revokeList = revoke.slice(0, grantStart);
      const grantList = revoke.slice(grantStart);
      expect(revokeList, file).toMatch(/FROM PUBLIC, anon, authenticated;/);
      expect(grantList, file).toMatch(/TO service_role;/);
      for (const fn of new Set(created)) {
        expect(revokeList, `${file}: REVOKE ${fn}`).toContain(`public.${fn}(`);
        expect(grantList, `${file}: GRANT ${fn}`).toContain(`public.${fn}(`);
      }
      expect(body, file).not.toMatch(/\bGRANT\b[^;]*\bTO\s+(anon|authenticated|PUBLIC)\b/i);
    }
  });
});
