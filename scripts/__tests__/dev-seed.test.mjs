/**
 * dev-seed.mjs: where the seed's environment comes from and what it refuses. The seed itself (a real stack) is covered by
 * `src/lib/dev-seed/__tests__/seed.local.test.ts`; here the runner is started with a hosted URL and must stop before any query.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { seedEnv } from '../dev-seed.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const STATUS = [
  'ANON_KEY="anon-key"',
  'API_URL="http://127.0.0.1:54321"',
  'SERVICE_ROLE_KEY="service-key"',
].join('\n');

describe('seedEnv', () => {
  it('uses the stack variables the caller already set, without asking the CLI', () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    const out = seedEnv(env, () => {
      throw new Error('the CLI must not be asked');
    });
    expect(out).toEqual({ ok: true, env });
  });

  it('reads the stack from the status output otherwise', () => {
    expect(seedEnv({}, () => STATUS)).toEqual({
      ok: true,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      },
    });
  });

  it('stops with a hint when there is no stack', () => {
    const out = seedEnv({}, () => null);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.message).toContain('supabase start');
  });

  it('refuses a production environment', () => {
    const out = seedEnv({ NODE_ENV: 'production' }, () => STATUS);
    expect(out).toMatchObject({ ok: false });
  });
});

describe('dev-seed-run.ts', () => {
  it('refuses a hosted Supabase URL before it queries anything', () => {
    const tsx = createRequire(join(REPO_ROOT, 'package.json')).resolve('tsx/cli');
    const run = spawnSync(
      process.execPath,
      [tsx, '--tsconfig', join(REPO_ROOT, 'scripts', 'tsconfig.dev-seed.json'), join(REPO_ROOT, 'scripts', 'dev-seed-run.ts')],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijkl.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key' },
      },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('not the loopback interface');
    expect(run.stdout).not.toContain('[dev-seed]');
  }, 60_000);
});
