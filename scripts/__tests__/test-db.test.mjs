/**
 * test-db.mjs: reads the local stack's values from `supabase status -o env` and never needs a `.env` file. The CLI
 * and vitest themselves are not run here (they need Docker).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseStatusEnv, suiteEnvFromStatus } from '../test-db.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const STATUS = [
  'WARN: config section [inbucket] is deprecated. Please use [local_smtp] instead.',
  'ANON_KEY="anon-key"',
  'API_URL="http://127.0.0.1:54321"',
  'SERVICE_ROLE_KEY="service-key"',
  'INBUCKET_URL="http://127.0.0.1:54324"',
  'A new version of Supabase CLI is available: v9.9.9',
].join('\n');

describe('test-db', () => {
  it('parses KEY="value" lines and skips notices', () => {
    const parsed = parseStatusEnv(STATUS);
    expect(parsed).toEqual({
      ANON_KEY: 'anon-key',
      API_URL: 'http://127.0.0.1:54321',
      SERVICE_ROLE_KEY: 'service-key',
      INBUCKET_URL: 'http://127.0.0.1:54324',
    });
  });

  it('maps the status values to the variables the suites read', () => {
    expect(suiteEnvFromStatus(parseStatusEnv(STATUS))).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    });
  });

  it('returns null when the stack does not report a URL or a key', () => {
    expect(suiteEnvFromStatus({ API_URL: 'http://127.0.0.1:54321' })).toBeNull();
    expect(suiteEnvFromStatus({})).toBeNull();
  });

  it('the npm script runs this wrapper, and the db project holds only the local-stack suites', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['test:db']).toBe('node scripts/test-db.mjs');
    const config = readFileSync(join(REPO_ROOT, 'vitest.config.ts'), 'utf8');
    expect(config).toContain("name: 'db'");
    expect(config).toContain('...LOCAL_STACK_SUITES');
  });
});
