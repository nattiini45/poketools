/**
 * Static tests that keep the verified-session override honest (Admin Assistant plan 3.9, test 5). The override is an
 * impersonation primitive, so its limits are enforced by tests, not by convention:
 *
 * - `runAsVerifiedSession` is imported only from `src/lib/ai/admin-agent/dispatch/`;
 * - `recordAuthSession` is called only inside `session-override.ts` (through `authAndRecord`): a caller that could record
 *   a hand-built session would defeat the "only sessions auth() returned" control;
 * - `session-override.ts` exports no `AsyncLocalStorage`, and no other file declares an `AsyncLocalStorage<Session>`;
 * - `getVerifiedSession` is read by `helpers.ts` and nowhere else.
 *
 * Tests are not scanned: they exercise the module directly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import * as sessionOverride from '../session-override';

const SRC_DIR = path.resolve(__dirname, '../../..');
const MODULE = 'lib/auth/session-override.ts';
const HELPERS = 'lib/auth/helpers.ts';
/** The only directory allowed to import `runAsVerifiedSession` (relative to `src/`, forward slashes). */
const DISPATCH_DIR = 'lib/ai/admin-agent/dispatch/';

function isTestFile(rel: string): boolean {
  return /(^|\/)(__tests__|test)\//.test(rel) || /\.(test|spec)\.tsx?$/.test(rel);
}

let cachedSources: Array<[string, string]> | undefined;

/** Every non-test source file under `src/` as [path relative to src with forward slashes, text]; read once per run. */
function sourceFiles(): Array<[string, string]> {
  if (cachedSources) return cachedSources;
  const files: Array<[string, string]> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts)$/.test(entry.name)) continue;
      const rel = path.relative(SRC_DIR, full).split(path.sep).join('/');
      if (isTestFile(rel)) continue;
      files.push([rel, readFileSync(full, 'utf8')]);
    }
  };
  walk(SRC_DIR);
  cachedSources = files;
  return files;
}

/** Files (non-test) whose text matches `pattern`, minus `allowed`. */
function offenders(pattern: RegExp, allowed: (rel: string) => boolean): string[] {
  return sourceFiles()
    .filter(([rel, text]) => pattern.test(text) && !allowed(rel))
    .map(([rel]) => rel);
}

describe('the scan itself', () => {
  it('sees the override module, helpers.ts and a test-free tree', () => {
    const rels = sourceFiles().map(([rel]) => rel);
    expect(rels).toContain(MODULE);
    expect(rels).toContain(HELPERS);
    expect(rels.some((rel) => rel.includes('__tests__/'))).toBe(false);
  });
});

describe('runAsVerifiedSession: import allow-list', () => {
  it('is referenced only by session-override.ts and src/lib/ai/admin-agent/dispatch/', () => {
    const found = offenders(
      /\brunAsVerifiedSession\b/,
      (rel) => rel === MODULE || rel.startsWith(DISPATCH_DIR),
    );
    expect(found).toEqual([]);
  });

  it('the allow-list directory is the one the plan names', () => {
    expect(DISPATCH_DIR).toBe('lib/ai/admin-agent/dispatch/');
  });
});

describe('recordAuthSession / getVerifiedSession: no outside callers', () => {
  it('recordAuthSession is referenced only inside session-override.ts', () => {
    expect(offenders(/\brecordAuthSession\b/, (rel) => rel === MODULE)).toEqual([]);
  });

  it('getVerifiedSession is referenced only by helpers.ts (and its own module)', () => {
    expect(offenders(/\bgetVerifiedSession\b/, (rel) => rel === MODULE || rel === HELPERS)).toEqual([]);
  });

  it('helpers.ts reads the override outside the cached auth call', () => {
    const helpers = sourceFiles().find(([rel]) => rel === HELPERS)?.[1] ?? '';
    expect(helpers).toMatch(/getVerifiedSession\(\)\s*\?\?\s*\(await cachedAuth\(\)\)/);
    // cache() wraps auth() only
    expect(helpers).toMatch(/const cachedAuth:[^\n]*= cache\(async \(\): Promise<Session \| null> => auth\(\)\);/);
  });
});

describe('the store never leaves session-override.ts', () => {
  it('exports exactly the four functions, none of them a store', () => {
    expect(Object.keys(sessionOverride).sort()).toEqual([
      'authAndRecord',
      'getVerifiedSession',
      'recordAuthSession',
      'runAsVerifiedSession',
    ]);
    for (const value of Object.values(sessionOverride)) {
      expect(typeof value).toBe('function');
      expect(value).not.toBeInstanceOf(AsyncLocalStorage);
    }
  });

  it('declares no exported AsyncLocalStorage in its source', () => {
    const text = sourceFiles().find(([rel]) => rel === MODULE)?.[1] ?? '';
    const exportLines = text.split('\n').filter((line) => /^\s*export\b/.test(line));
    expect(exportLines.length).toBeGreaterThan(0);
    expect(exportLines.filter((line) => /AsyncLocalStorage|\bstore\b/.test(line))).toEqual([]);
    expect(text).not.toMatch(/export\s*\{/);
    expect(text).not.toMatch(/export\s+default/);
  });

  it('no other file declares an AsyncLocalStorage of Session', () => {
    expect(offenders(/AsyncLocalStorage\s*<[^;=]*\bSession\b/, (rel) => rel === MODULE)).toEqual([]);
  });

  it('the one declaration in session-override.ts exists (the pattern really matches)', () => {
    expect(offenders(/AsyncLocalStorage\s*<[^;=]*\bSession\b/, () => false)).toEqual([MODULE]);
  });
});
