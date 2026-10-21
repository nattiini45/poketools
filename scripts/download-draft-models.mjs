#!/usr/bin/env node
/**
 * One-time script to download Pokemon .glb models for the 3D draft room.
 * Sources from Pokemon-3D-api GitHub assets (Draco-compressed, WebP textures).
 *
 * Usage: node scripts/download-draft-models.mjs
 *
 * Saves to: public/models/draft-room/{form}/{dexId}.glb
 *
 * The models are third-party IP (see public/models/world/ATTRIBUTION.md and NOTICE.md):
 * the output folder is git-ignored and never committed. The app itself no longer reads
 * this folder; the route world loads its figures from the world-assets set.
 */

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dex } from '@pkmn/dex';
import { describeSpecies, rosterRootSpecies } from './world-assets/lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'models', 'draft-room');

const BASE_URL = 'https://raw.githubusercontent.com/Pokemon-3D-api/assets/main/models/opt';

// Unique base-stage models of the roster lines (dexId + form). The roster is kept out of the tree:
// the private pack's world-roster.json, else the example pack's list (scripts/world-assets/lib.mjs).
const MODELS = [
  ...new Map(
    rosterRootSpecies()
      .map((name) => Dex.species.get(name))
      .filter((species) => species?.exists)
      .map((species) => describeSpecies(species))
      .map(({ dexId, category }) => [`${category}/${dexId}`, { dexId, form: category }]),
  ).values(),
];

const DELAY_MS = 300; // Be polite to GitHub

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadModel(dexId, form) {
  const url = `${BASE_URL}/${form}/${dexId}.glb`;
  const outDir = join(OUT_DIR, form);
  const outPath = join(outDir, `${dexId}.glb`);

  if (existsSync(outPath)) {
    console.log(`  [skip] ${form}/${dexId}.glb (already exists)`);
    return { dexId, form, status: 'skipped' };
  }

  mkdirSync(outDir, { recursive: true });

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  [FAIL] ${form}/${dexId}.glb — HTTP ${res.status}`);
      return { dexId, form, status: 'failed', code: res.status };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(outPath, buffer);
    const kb = (buffer.length / 1024).toFixed(0);
    console.log(`  [ok]   ${form}/${dexId}.glb (${kb} KB)`);
    return { dexId, form, status: 'ok', size: buffer.length };
  } catch (err) {
    console.error(`  [FAIL] ${form}/${dexId}.glb — ${err.message}`);
    return { dexId, form, status: 'failed', error: err.message };
  }
}

async function main() {
  console.log(`\nDownloading ${MODELS.length} Pokemon models for 3D draft room...`);
  console.log(`Output: ${OUT_DIR}\n`);

  const results = [];
  for (const { dexId, form } of MODELS) {
    const result = await downloadModel(dexId, form);
    results.push(result);
    await sleep(DELAY_MS);
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const failed = results.filter((r) => r.status === 'failed');

  console.log(`\n── Summary ──────────────────────────────────`);
  console.log(`  Downloaded: ${ok}`);
  console.log(`  Skipped:    ${skipped}`);
  console.log(`  Failed:     ${failed.length}`);

  if (failed.length > 0) {
    console.log(`\n  Failed models:`);
    for (const f of failed) {
      console.log(`    - ${f.form}/${f.dexId}.glb (${f.code ?? f.error})`);
    }
    console.log(`\n  Tip: For variant forms that 404, the regular form may work as fallback.`);
  }

  console.log(`\nDone.\n`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main();
