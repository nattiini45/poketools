/**
 * db-types.mjs: generates the database types only from the local stack and never writes a failed
 * or empty CLI result over src/types/database.ts. The CLI itself is not run here (it needs Docker).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GEN_ARGS, interpretGenResult, normalizeTypes, supabaseCliEntry, typesUpToDate } from '../db-types.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = 'export type Json = string\nexport type Database = { public: {} }\n';

describe('db-types', () => {
  it('asks the CLI for the local stack and the public schema only', () => {
    expect(GEN_ARGS).toEqual(['gen', 'types', 'typescript', '--local', '--schema', 'public']);
    expect(GEN_ARGS).not.toContain('--linked');
    expect(GEN_ARGS.some((a) => a.startsWith('--project-id'))).toBe(false);
  });

  it('the npm scripts run this wrapper, not a shell redirect that would truncate the file', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['db:types']).toBe('node scripts/db-types.mjs');
    expect(pkg.scripts['db:types:check']).toBe('node scripts/db-types.mjs --check');
  });

  it('resolves the lockfile-pinned CLI entry', () => {
    const entry = supabaseCliEntry(REPO_ROOT);
    expect(entry.replace(/\\/g, '/')).toMatch(/node_modules\/supabase\/dist\/supabase\.js$/);
    expect(existsSync(entry)).toBe(true);
  });

  it('normalises CRLF and adds a final newline', () => {
    expect(normalizeTypes('a\r\nb\rc')).toBe('a\nb\nc\n');
    expect(normalizeTypes('a\n')).toBe('a\n');
  });

  it('accepts a successful run with a Database type', () => {
    const r = interpretGenResult({ status: 0, stdout: TYPES.replace(/\n/g, '\r\n'), stderr: '' });
    expect(r).toEqual({ ok: true, types: TYPES, discarded: '' });
  });

  it('cuts off a notice printed before the generated types and reports it, never writing it', () => {
    const notice = 'A new version of Supabase CLI is available: v9.9.9\nWe recommend updating.\n\n';
    const r = interpretGenResult({ status: 0, stdout: notice + TYPES, stderr: '' });
    expect(r).toEqual({ ok: true, types: TYPES, discarded: 'A new version of Supabase CLI is available: v9.9.9\nWe recommend updating.' });
  });

  it('refuses output whose Database type comes without the generated Json header', () => {
    const r = interpretGenResult({ status: 0, stdout: 'export type Database = { public: {} }\n', stderr: '' });
    expect(r.ok).toBe(false);
  });

  it('refuses output with the Json header but no Database type after it', () => {
    const r = interpretGenResult({ status: 0, stdout: 'export type Database = {}\nexport type Json = string\n', stderr: '' });
    expect(r.ok).toBe(false);
  });

  it('refuses a failed run (stopped stack) and names the remedy and the CLI error', () => {
    const r = interpretGenResult({ status: 1, stdout: '', stderr: 'failed to inspect container health\n' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('exit 1');
    expect(r.message).toContain('supabase start');
    expect(r.message).toContain('failed to inspect container health');
  });

  it('refuses a CLI that could not start, distinctly from a failed run', () => {
    const r = interpretGenResult({ status: null, stdout: '', stderr: '', error: new Error('spawn ENOENT') });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('could not start');
    expect(r.message).toContain('ENOENT');
  });

  it('refuses an exit-0 run without a Database type (empty or unexpected output)', () => {
    for (const stdout of ['', 'A new version of Supabase CLI is available\n']) {
      const r = interpretGenResult({ status: 0, stdout, stderr: '' });
      expect(r.ok, JSON.stringify(stdout)).toBe(false);
    }
  });

  it('compares with the committed file ignoring line endings', () => {
    expect(typesUpToDate(TYPES, TYPES.replace(/\n/g, '\r\n'))).toBe(true);
    expect(typesUpToDate(TYPES, `${TYPES}// drift\n`)).toBe(false);
    expect(typesUpToDate(TYPES, null)).toBe(false);
  });
});
