#!/usr/bin/env node
/**
 * e2e-build.mjs: `npm run build:e2e`. The production build the Playwright suite (`npm run test:e2e`) serves.
 *
 * Runs `next build` behind `.claude/local-db.cjs`, so the build points at the LOCAL Supabase stack and bakes the local
 * asset mirrors (`NEXT_PUBLIC_WORLD_ASSETS_URL=/models/world`, `NEXT_PUBLIC_SPRITES_URL=/sprites`): the preload that
 * serves the build refuses one that baked a Storage bucket (AGENTS.md, "Automation never spends the Supabase quota").
 * The example format pack is pinned so a private pack on disk cannot change what the suite sees.
 *
 * Usage: npm run build:e2e
 */

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from './lib/entry-point.mjs';

/** Heap the build's own type check needs: this build runs it, unlike CI's build step (`CI_SKIP_BUILD_TYPECHECK`), and 4 GB no longer fits it. */
const BUILD_HEAP = '--max-old-space-size=8192';

/**
 * The environment of the build: the caller's, with the example pack and a heap that fits.
 * @param {Record<string, string | undefined>} base
 * @returns {Record<string, string | undefined>}
 */
export function e2eBuildEnv(base) {
  return {
    ...base,
    FORMAT_PACK: 'example',
    NODE_OPTIONS: base.NODE_OPTIONS?.includes('--max-old-space-size') ? base.NODE_OPTIONS : `${base.NODE_OPTIONS ?? ''} ${BUILD_HEAP}`.trim(),
  };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const run = spawnSync(
    process.execPath,
    ['--require', join(root, '.claude', 'local-db.cjs'), join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'],
    { cwd: root, env: e2eBuildEnv(process.env), stdio: 'inherit', windowsHide: true },
  );
  process.exit(run.status ?? 1);
}

// Run only when executed directly (see lib/entry-point.mjs).
if (isEntryPoint(import.meta.url, process.argv[1])) main();
