import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AuthErrorCode } from '@/lib/auth/helpers';
import { REASON_CODES } from '@/lib/draft-ui/reasons';
import type commonEn from '../messages/errors/common/en';
import { ERROR_CATALOGS, errorsCommon, type ApiErrorCode } from '../messages/errors';

/**
 * The error-code contract (i18n-core §4.1, §8.1; owner G0-ERR).
 *
 * 1. Codes are flat keys, unique across every catalog.
 * 2. Every `code: '<x>'` / `code: "<x>"` literal in non-test files under
 *    `src/app/api/**` and `src/lib/**` is a key of some catalog. This also
 *    catches untyped `NextResponse.json` bodies that `tsc` cannot check.
 *    Files in NOT_API_ERROR_FILES use a `code:` field for something that is
 *    not an API error and are skipped. Two literal kinds are not API errors
 *    and pass per literal, never per file:
 *    - zod issue codes inside `ctx.addIssue({ code: '<zod code>', … })`;
 *    - draftability `ReasonCode`s (`{ code: 'SIGNED_OUT' }` ReasonDTOs, which
 *      render via `draft/shared.reasons`, not `errors/*`) under `src/lib/**`.
 *      Route bodies under `src/app/api/**` get no such pass.
 *    - Postgres SQLSTATEs (`{ code: 'P0001' }`, `'23505'`): exactly five
 *      characters of `[0-9A-Z]` with at least one digit — the shape of a
 *      SQLSTATE (2-char class + 3-char subclass) that no catalog key has
 *      (catalog keys are snake_case or UPPER_SNAKE words).
 */

const SRC = path.resolve(__dirname, '../..');
const ERRORS_DIR = path.resolve(__dirname, '../messages/errors');
const SCAN_ROOTS = [path.join(SRC, 'app', 'api'), path.join(SRC, 'lib')];
const CODE_LITERAL = /\bcode\s*:\s*(['"])([^'"\r\n]+)\1/g;
const KEY = /^[A-Za-z0-9_]+$/;
/**
 * Files whose `code: '<x>'` literals are not API error codes, relative to src/.
 * - `lib/draft/reconciliation-report.ts`: finding codes of the admin import's
 *   reconciliation report (a Markdown/JSON report field, never an HTTP error
 *   body); they belong to the report's own namespace, not to `errors/*`.
 * - `lib/supabase/queries/league-trash.ts`: the `warnings` of a league restore
 *   (`parent_missing_nulled`, `replay_hash_released`, `columns_ignored`). They
 *   are data the restore function reports next to a SUCCESSFUL restore, rendered
 *   by the trash page from its own messages, and never an HTTP error body.
 * - `lib/league-trash/client.ts`: the client side of that page; it parses the same restore `warnings` out of the
 *   restore route's answer (the type twin of the queries file's union), so the same three literals appear there.
 * - `lib/studio-core/text-schema.ts`: the `length` and `refine` params of the shared zod text schemas. They are the
 *   format kit's schema issue codes (see NOT_API_ERROR_DIRS below), kept next to the `ltext` type both kits share.
 */
const NOT_API_ERROR_FILES = new Set([
  'lib/draft/reconciliation-report.ts',
  'lib/supabase/queries/league-trash.ts',
  'lib/league-trash/client.ts',
  'lib/studio-core/text-schema.ts',
]);
/**
 * Directories whose `code: '<x>'` literals are not API error codes, relative to src/.
 * - `lib/format-kit/`: schema, expression and compile issue codes of the pure
 *   format kit. They are data returned by validators, rendered from the
 *   `format-studio` namespaces, and never reach an HTTP error body.
 */
const NOT_API_ERROR_DIRS = ['lib/format-kit/'];

/** zod's issue codes (v3 `ZodIssueCode` and v4): the only codes `ctx.addIssue` takes. */
const ZOD_ISSUE_CODES: ReadonlySet<string> = new Set([
  'custom',
  'invalid_type',
  'invalid_literal',
  'invalid_union',
  'invalid_union_discriminator',
  'invalid_enum_value',
  'invalid_arguments',
  'invalid_return_type',
  'invalid_date',
  'invalid_string',
  'invalid_format',
  'invalid_value',
  'invalid_key',
  'invalid_element',
  'invalid_intersection_types',
  'unrecognized_keys',
  'too_small',
  'too_big',
  'not_multiple_of',
  'not_finite',
]);

/** A Postgres SQLSTATE (`P0001`, `23505`, `42501`): 5 × [0-9A-Z] with a digit. */
const SQLSTATE = /^(?=[0-9A-Z]*[0-9])[0-9A-Z]{5}$/;

/** Whether a `code:` literal is a Postgres SQLSTATE, not an API error code. */
function isSqlStateLiteral(code: string): boolean {
  return SQLSTATE.test(code);
}

/** Draftability reasons (DC-0 `ReasonCode`): ReasonDTO codes, not API error codes. */
const REASON_CODE_SET: ReadonlySet<string> = new Set(REASON_CODES);

/** [start, end) spans of every `addIssue( … )` argument list in `text` (paren depth; strings skipped). */
function addIssueSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of text.matchAll(/\baddIssue\s*\(/g)) {
    const start = m.index + m[0].length;
    let depth = 1;
    let quote: string | null = null;
    let i = start;
    for (; i < text.length && depth > 0; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
      } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    spans.push([start, i]);
  }
  return spans;
}

/** Whether a `code:` literal at `index` is a zod issue code inside an `addIssue(…)` call. */
function isZodIssueLiteral(code: string, index: number, spans: readonly [number, number][]): boolean {
  return ZOD_ISSUE_CODES.has(code) && spans.some(([a, b]) => index >= a && index < b);
}

/** Whether a `code:` literal in `rel` (relative to src/) is a draftability ReasonCode outside the API routes. */
function isReasonLiteral(code: string, rel: string): boolean {
  return rel.startsWith('lib/') && REASON_CODE_SET.has(code);
}

function relToSrc(file: string): string {
  return path.relative(SRC, file).replace(/\\/g, '/');
}

function catalogKeys(): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const ns of Object.values(ERROR_CATALOGS)) {
    for (const key of Object.keys(ns.en)) owners.set(key, [...(owners.get(key) ?? []), ns.id]);
  }
  return owners;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

// Compile-time: every AuthError code is an errorsCommon key, and every
// errorsCommon key is an ApiErrorCode.
type AuthCodesInCommon = AuthErrorCode extends keyof typeof commonEn ? true : false;
type CommonInApiCodes = keyof typeof commonEn extends ApiErrorCode ? true : false;
const authCodesInCommon: AuthCodesInCommon = true;
const commonInApiCodes: CommonInApiCodes = true;

// Walks the source tree: under a loaded full suite or a cold clone the walk can pass the
// 5 s default (engine-r3-contract.test.ts uses the same bound).
const FILE_WALK_TIMEOUT_MS = 30_000;

describe('error catalogs', { timeout: FILE_WALK_TIMEOUT_MS }, () => {
  it('registers every errors/* catalog in ERROR_CATALOGS', () => {
    const onDisk = fs
      .readdirSync(ERRORS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(ERRORS_DIR, e.name, 'index.ts')))
      .map((e) => `errors/${e.name}`)
      .sort();
    const registered = Object.values(ERROR_CATALOGS)
      .map((ns) => ns.id)
      .sort();
    expect(registered).toEqual(onDisk);
  });

  it('keeps codes flat and unique across catalogs', () => {
    const problems: string[] = [];
    for (const ns of Object.values(ERROR_CATALOGS)) {
      for (const [key, value] of Object.entries(ns.en)) {
        if (!KEY.test(key)) problems.push(`${ns.id}: key "${key}" is not [A-Za-z0-9_]+`);
        const isLeaf =
          typeof value === 'string' ||
          (typeof value === 'object' && value !== null && 'one' in value && 'other' in value);
        if (!isLeaf) problems.push(`${ns.id}: "${key}" is a group; codes are flat keys`);
      }
    }
    for (const [key, owners] of catalogKeys()) {
      if (owners.length > 1) problems.push(`"${key}" is in ${owners.join(' and ')}`);
    }
    expect(problems).toEqual([]);
  });

  it('covers the auth-guard and language-route codes in errors/common', () => {
    expect(authCodesInCommon && commonInApiCodes).toBe(true);
    for (const code of ['unauthenticated', 'forbidden', 'account_banned', 'account_suspended']) {
      expect(errorsCommon.en).toHaveProperty(code);
    }
    for (const code of ['locale_invalid', 'locale_cross_origin', 'locale_save_failed']) {
      expect(errorsCommon.en).toHaveProperty(code);
    }
  });

  it('has a catalog key for every code literal in src/app/api and src/lib', () => {
    const known = catalogKeys();
    const missing: string[] = [];
    let seen = 0;
    for (const root of SCAN_ROOTS) {
      for (const file of sourceFiles(root)) {
        const rel = relToSrc(file);
        if (NOT_API_ERROR_FILES.has(rel)) continue;
        if (NOT_API_ERROR_DIRS.some((dir) => rel.startsWith(dir))) continue;
        const text = fs.readFileSync(file, 'utf8');
        const spans = addIssueSpans(text);
        for (const match of text.matchAll(CODE_LITERAL)) {
          seen++;
          const code = match[2];
          if (known.has(code)) continue;
          if (isZodIssueLiteral(code, match.index, spans) || isReasonLiteral(code, rel)) continue;
          if (isSqlStateLiteral(code)) continue;
          missing.push(`${rel}:${lineOf(text, match.index)} '${code}'`);
        }
      }
    }
    expect(seen).toBeGreaterThan(50); // the scan really ran over the tree
    expect(missing).toEqual([]);
  });

  it('skips only files that exist, so a stale exclusion cannot hide anything', () => {
    for (const rel of NOT_API_ERROR_FILES) expect(fs.existsSync(path.join(SRC, rel))).toBe(true);
    for (const rel of NOT_API_ERROR_DIRS) expect(fs.statSync(path.join(SRC, rel)).isDirectory()).toBe(true);
  });

  it('the scan pattern matches the shapes routes use, and nothing else', () => {
    const sample = [
      "{ success: false, error: 'x', code: 'a_code' }",
      '{ code: "b_code", status: 409 }',
      'code:\n  \'c_code\'',
      "error.code === 'not_this'",
      "postal_code: 'not_this_either'",
    ].join('\n');
    expect([...sample.matchAll(CODE_LITERAL)].map((m) => m[2])).toEqual(['a_code', 'b_code', 'c_code']);
  });

  it('passes zod issue codes only inside addIssue(…), and ReasonCodes only under src/lib', () => {
    const text = [
      "ctx.addIssue({ code: 'custom', path: ['x'], message: 'a (b))' });",
      "return { code: 'custom' };",
      "ctx.addIssue({ code: 'not_a_zod_code' });",
    ].join('\n');
    const spans = addIssueSpans(text);
    expect([...text.matchAll(CODE_LITERAL)].map((m) => isZodIssueLiteral(m[2], m.index, spans))).toEqual([
      true,
      false,
      false,
    ]);

    expect(isReasonLiteral('SIGNED_OUT', 'lib/draft/draftability.ts')).toBe(true);
    expect(isReasonLiteral('NO_OPEN_REDRAFT_SLOT', 'lib/draft/draftability.ts')).toBe(true);
    expect(isReasonLiteral('SIGNED_OUT', 'app/api/drafts/[id]/route.ts')).toBe(false);
    expect(isReasonLiteral('SOME_NEW_API_CODE', 'lib/draft/draftability.ts')).toBe(false);
  });

  it('passes Postgres SQLSTATEs and nothing shaped like an API code', () => {
    for (const code of ['P0001', '23505', '23503', '42501', '22P02', '40001']) {
      expect(isSqlStateLiteral(code)).toBe(true);
    }
    for (const code of ['PGRST116', 'TOKEN', 'ABCDE', 'p0001', 'P001', 'P00011', 'a_code', 'POOL_NOT_FOUND', 'E_42']) {
      expect(isSqlStateLiteral(code)).toBe(false);
    }
  });
});
