#!/usr/bin/env node
/**
 * test-db.mjs: `npm run test:db`. Runs the `db` vitest project (the *.local.test.ts and *.live-db.test.ts suites)
 * against the LOCAL Supabase stack.
 *
 * When NEXT_PUBLIC_SUPABASE_URL is already set (CI exports it from `supabase status -o env`), it is used as it is,
 * and the project's setup file refuses anything but the loopback interface. When it is unset, the stack's URL and
 * keys are read from `supabase status -o env` (the lockfile-pinned CLI, local stack only), so a contributor with a
 * running stack needs no variables. No `.env` file is read, and no key is printed.
 *
 * Usage:
 *   npm run test:db                       # every local-stack suite
 *   npm run test:db -- <vitest filters>   # extra arguments go to vitest
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseCliEntry } from './db-types.mjs';
import { isEntryPoint } from './lib/entry-point.mjs';

const TAG = '[test-db]';

/**
 * Parses `KEY="value"` lines (the output of `supabase status -o env`); other lines (warnings, notices) are skipped.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseStatusEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(?:"(.*)"|(.*))$/);
    if (match) out[match[1]] = match[2] ?? match[3] ?? '';
  }
  return out;
}

/**
 * The variables the suites read, from the stack's status values.
 * @param {Record<string, string>} status
 * @returns {Record<string, string> | null} null when the status lacks the API URL or a key
 */
export function suiteEnvFromStatus(status) {
  const { API_URL: url, ANON_KEY: anon, SERVICE_ROLE_KEY: service } = status;
  if (!url || !anon || !service) return null;
  return {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
  };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const env = { ...process.env, LOCAL_STACK_DB: '1' };
  if (!env.NEXT_PUBLIC_SUPABASE_URL) {
    const status = spawnSync(process.execPath, [supabaseCliEntry(root), 'status', '-o', 'env'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    const suiteEnv = status.status === 0 ? suiteEnvFromStatus(parseStatusEnv(status.stdout ?? '')) : null;
    if (!suiteEnv) {
      console.error(`${TAG} could not read the local stack. Run \`npx supabase start\` and \`npx supabase migration up --local\` first.`);
      process.exit(1);
    }
    Object.assign(env, suiteEnv);
  }
  const vitest = join(dirname(createRequire(join(root, 'package.json')).resolve('vitest/package.json')), 'vitest.mjs');
  const run = spawnSync(process.execPath, [vitest, 'run', '--project', 'db', ...process.argv.slice(2)], {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  process.exit(run.status ?? 1);
}

// Run only when executed directly (see lib/entry-point.mjs).
if (isEntryPoint(import.meta.url, process.argv[1])) main();
