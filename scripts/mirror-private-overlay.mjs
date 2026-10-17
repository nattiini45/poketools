#!/usr/bin/env node
/**
 * mirror-private-overlay.mjs
 *
 * The private format pack (src/format-packs/private/, docs/format-packs.md) may carry an
 * `overlay/` folder: files that belong at a different place in the app tree, most importantly
 * routes, which Next.js only finds under src/app/. This copies every file under
 * `src/format-packs/private/overlay/` to the same relative path under `src/`, so
 * `overlay/app/x/page.tsx` becomes `src/app/x/page.tsx`. Test folders are never copied (the
 * pack's moved tests live in `src/format-packs/private/__tests__/`).
 *
 * Without the overlay folder this is a no-op, so a public checkout builds without it. Run from
 * `predev` and `prebuild`; the copies are generated and must not be edited in place.
 *
 * Usage: node scripts/mirror-private-overlay.mjs [--quiet]
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OVERLAY = join(ROOT, 'src', 'format-packs', 'private', 'overlay');
const TARGET = join(ROOT, 'src');
const quiet = process.argv.includes('--quiet');

/** Every file under `dir` that is not inside a `__tests__` folder, as absolute paths. */
function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

if (!existsSync(OVERLAY)) {
  if (!quiet) console.log('[mirror-private-overlay] no overlay folder; nothing to mirror');
  process.exit(0);
}

let count = 0;
for (const source of files(OVERLAY)) {
  const rel = relative(OVERLAY, source);
  const dest = join(TARGET, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  count += 1;
}
if (!quiet) console.log(`[mirror-private-overlay] mirrored ${count} file(s) from the pack overlay into src/`);
