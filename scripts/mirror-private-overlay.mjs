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
 * The copies are generated: edit the overlay source, never the copy. Outputs land only in whole
 * private folders (output roots: no tracked file inside), and the mirror writes a self-ignoring
 * `.gitignore` (`*`) into each, so no public file has to name a private folder. Every run is
 * checked first (scripts/lib/overlay-mirror.mjs): it refuses a single file dropped into a public
 * folder, a root that holds files it did not write, a git-tracked path or an output nothing
 * ignores, and an output edited in place; it records every output and root in
 * `.overlay-manifest.json`, and deletes outputs (and roots) whose overlay source is gone, plus the
 * temp files a crashed run left beside its own outputs. Any
 * refusal stops the run before anything is written, with exit code 1.
 *
 * Without the overlay folder and without a manifest this is a no-op, so a public checkout builds
 * without it. Run from `predev` and `prebuild`.
 *
 * Usage: node scripts/mirror-private-overlay.mjs [--quiet] [--check] [--prune] [--force]
 *   --check  print what a run would change; exit 1 when anything is pending or refused
 *   --prune  the overlay folder is gone on purpose: delete the outputs the manifest lists
 *   --force  overwrite (or delete) outputs that were edited in place
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from './lib/entry-point.mjs';
import { applyOverlayMirror, describePlan, planHasChanges, planOverlayMirror } from './lib/overlay-mirror.mjs';

const TAG = '[mirror-private-overlay]';
const FLAGS = new Set(['--quiet', '--check', '--prune', '--force']);

/**
 * Run the mirror. Returns the exit code; prints through `log` / `error`.
 * @param {{ root: string, argv: string[], log?: (s: string) => void, error?: (s: string) => void }} options
 * @returns {number}
 */
export function runMirror({ root, argv, log = console.log, error = console.error }) {
  const unknown = argv.filter((a) => !FLAGS.has(a));
  if (unknown.length > 0) {
    error(`${TAG} unknown argument(s): ${unknown.join(' ')} (expected ${[...FLAGS].join(', ')})`);
    return 2;
  }
  const quiet = argv.includes('--quiet');
  const check = argv.includes('--check');
  const plan = planOverlayMirror({ root, force: argv.includes('--force'), prune: argv.includes('--prune') });

  if (plan.refusals.length > 0) {
    error(`${TAG} refused; nothing was written:`);
    for (const line of describePlan(plan).filter((l) => l.startsWith('refused'))) error(`  ${line}`);
    return 1;
  }
  if (check) {
    if (!planHasChanges(plan)) {
      if (!quiet) log(`${TAG} check: outputs are up to date (${Object.keys(plan.manifestFiles).length} file(s))`);
      return 0;
    }
    error(`${TAG} check: the mirrored outputs are out of date; run node scripts/mirror-private-overlay.mjs`);
    for (const line of describePlan(plan)) error(`  ${line}`);
    return 1;
  }
  if (!plan.overlayPresent && !planHasChanges(plan)) {
    if (!quiet) log(`${TAG} no overlay folder; nothing to mirror`);
    return 0;
  }
  applyOverlayMirror(plan);
  if (!quiet) {
    log(
      `${TAG} ${plan.writes.length} written, ${plan.keeps.length + plan.adopts.length} unchanged, ` +
        `${plan.removes.length} removed` +
        (plan.tempRemoves.length > 0 ? `, ${plan.tempRemoves.length} stale temp file(s) of a crashed run cleaned` : '') +
        ` (${Object.keys(plan.manifestFiles).length} mirrored file(s) in ${plan.roots.length} private folder(s) under src/)`
    );
  }
  return 0;
}

// Run only when executed directly (see lib/entry-point.mjs).
if (isEntryPoint(import.meta.url, process.argv[1])) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(runMirror({ root, argv: process.argv.slice(2) }));
}
