#!/usr/bin/env node
/**
 * visual/seed.mjs: the deterministic data seed of the visual-capture harness. Gives a LOCAL Supabase stack the dev
 * seed (admin, standard rulesets) plus fixed-id leagues, matches, a draft and a solo Cast Studio session
 * (`src/lib/visual-seed/seed.ts`; ids in `src/lib/visual-seed/ids.ts` and `scripts/visual/seed-ids.json`). Safe to
 * run again: a second run changes nothing.
 *
 * Same environment rules as `scripts/dev-seed.mjs` (whose `seedEnv` it reuses): a NEXT_PUBLIC_SUPABASE_URL that is
 * set but not the loopback interface is refused, NODE_ENV=production is refused, and otherwise the stack's URL and
 * keys come from `supabase status -o env`. No `.env` file is read. `seed-run.ts` repeats the loopback check.
 *
 * Usage: node scripts/visual/seed.mjs
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseCliEntry } from '../db-types.mjs';
import { seedEnv } from '../dev-seed.mjs';
import { isEntryPoint } from '../lib/entry-point.mjs';

const TAG = '[visual-seed]';

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const resolved = seedEnv(process.env, () => {
    const status = spawnSync(process.execPath, [supabaseCliEntry(root), 'status', '-o', 'env'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    return status.status === 0 ? (status.stdout ?? '') : null;
  });
  if (!resolved.ok) {
    console.error(resolved.message.replace('[dev-seed]', TAG));
    process.exit(1);
  }
  const tsx = createRequire(join(root, 'package.json')).resolve('tsx/cli');
  const run = spawnSync(
    process.execPath,
    [tsx, '--tsconfig', join(root, 'scripts', 'tsconfig.visual-seed.json'), join(root, 'scripts', 'visual', 'seed-run.ts')],
    { cwd: root, env: { ...process.env, ...resolved.env }, stdio: 'inherit', windowsHide: true },
  );
  process.exit(run.status ?? 1);
}

if (isEntryPoint(import.meta.url, process.argv[1])) main();
