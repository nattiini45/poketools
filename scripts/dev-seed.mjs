#!/usr/bin/env node
/**
 * dev-seed.mjs: `npm run dev:seed`. Gives a LOCAL Supabase stack a sign-in-able admin, the standard rulesets and one
 * small league (`src/lib/dev-seed/seed.ts`), so local development needs no Discord application. Safe to run again.
 *
 * Opt-in by being run by hand: nothing calls it. When NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
 * already set they are used as they are; otherwise the stack's URL and keys come from `supabase status -o env`
 * (lockfile-pinned CLI, local stack only). A NEXT_PUBLIC_SUPABASE_URL that is set but not the loopback interface is
 * refused up front, with or without a key, never swapped for the status values. No `.env` file is read.
 * `dev-seed-run.ts` repeats the loopback check before it queries anything.
 *
 * Usage: npm run dev:seed
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseCliEntry } from './db-types.mjs';
import { isEntryPoint } from './lib/entry-point.mjs';
import { parseStatusEnv, suiteEnvFromStatus } from './test-db.mjs';

const TAG = '[dev-seed]';

const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '[::1]'];

/** The hostname of a URL string, or null when it does not parse. Same host set as `assertLoopbackUrl` (src/test/local-stack.ts). */
function hostnameOf(raw) {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The environment the seed runs with: the caller's own stack variables when both are set, else the status values.
 * A URL the caller supplied is checked first, whatever else is set, so a hosted URL is refused instead of being
 * replaced by the status values.
 * @param {Record<string, string | undefined>} env
 * @param {() => string | null} readStatus the `supabase status -o env` output, or null when there is no stack
 * @returns {{ ok: true, env: Record<string, string> } | { ok: false, message: string }}
 */
export function seedEnv(env, readStatus) {
  if (env.NODE_ENV === 'production') {
    return { ok: false, message: `${TAG} refusing to run with NODE_ENV=production` };
  }
  const suppliedUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (suppliedUrl) {
    const host = hostnameOf(suppliedUrl);
    if (host === null || !LOOPBACK_HOSTNAMES.includes(host)) {
      const shown = host === null ? 'is not a valid loopback URL' : `host "${host}" is not the loopback interface (127.0.0.1, localhost, ::1)`;
      return { ok: false, message: `${TAG} refusing to run: NEXT_PUBLIC_SUPABASE_URL ${shown}. Unset it to seed the local stack.` };
    }
  }
  if (suppliedUrl && env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: true, env: { NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY } };
  }
  const text = readStatus();
  const fromStatus = text === null ? null : suiteEnvFromStatus(parseStatusEnv(text));
  if (!fromStatus) {
    return { ok: false, message: `${TAG} could not read the local stack. Run \`npx supabase start\` and \`npx supabase migration up --local\` first.` };
  }
  return { ok: true, env: fromStatus };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const resolved = seedEnv(process.env, () => {
    const status = spawnSync(process.execPath, [supabaseCliEntry(root), 'status', '-o', 'env'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    return status.status === 0 ? (status.stdout ?? '') : null;
  });
  if (!resolved.ok) {
    console.error(resolved.message);
    process.exit(1);
  }
  const tsx = createRequire(join(root, 'package.json')).resolve('tsx/cli');
  const run = spawnSync(
    process.execPath,
    [tsx, '--tsconfig', join(root, 'scripts', 'tsconfig.dev-seed.json'), join(root, 'scripts', 'dev-seed-run.ts')],
    { cwd: root, env: { ...process.env, ...resolved.env }, stdio: 'inherit', windowsHide: true },
  );
  process.exit(run.status ?? 1);
}

// Run only when executed directly (see lib/entry-point.mjs).
if (isEntryPoint(import.meta.url, process.argv[1])) main();
