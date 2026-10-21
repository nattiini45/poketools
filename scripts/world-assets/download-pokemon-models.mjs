#!/usr/bin/env node
/**
 * Step 1 — download every Pokémon GLB the plaza can show from Pokemon-3D-api.
 *
 * Covers all base lines, every evolution reachable from them, the nurse
 * species, plus any `--extra "Name,Name"` species. Regional variants that the
 * source lacks are recorded in .cache/missing.json; the manifest falls back to
 * the regular file for those.
 *
 * Usage: node scripts/world-assets/download-pokemon-models.mjs [--extra "Rotom,Snorlax"] [--force]
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RAW_DIR,
  SOURCE_BASE,
  MISSING_FILE,
  CACHE_DIR,
  buildFigureSet,
  ensureDir,
  log,
  parallel,
  readJson,
} from './lib.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const extraIndex = args.indexOf('--extra');
const extra =
  extraIndex !== -1 && args[extraIndex + 1]
    ? args[extraIndex + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : [];

async function download(figure) {
  const url = `${SOURCE_BASE}/${figure.category}/${figure.dexId}.glb`;
  const dir = join(RAW_DIR, figure.category);
  const file = join(dir, `${figure.dexId}.glb`);
  if (!force && existsSync(file)) return { ...figure, status: 'cached' };
  ensureDir(dir);
  try {
    const res = await fetch(url);
    if (res.status === 404) return { ...figure, status: 'missing' };
    if (!res.ok) return { ...figure, status: 'failed', detail: `HTTP ${res.status}` };
    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(file, buffer);
    return { ...figure, status: 'ok', kb: Math.round(buffer.length / 1024) };
  } catch (err) {
    return { ...figure, status: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  ensureDir(CACHE_DIR);
  const figures = [...buildFigureSet(extra).values()];
  log(`Downloading ${figures.length} figures → ${RAW_DIR}`);

  const results = await parallel(figures, 4, async (figure) => {
    const result = await download(figure);
    const tag = result.status.padEnd(7);
    const size = result.kb ? ` ${result.kb} KB` : result.detail ? ` ${result.detail}` : '';
    log(`  [${tag}] ${figure.category}/${figure.dexId}.glb ${figure.species}${size}`);
    return result;
  });

  const previousMissing = readJson(MISSING_FILE, {});
  const missing = { ...previousMissing };
  for (const r of results) {
    const key = `${r.category}/${r.dexId}`;
    if (r.status === 'missing') missing[key] = r.species;
    else if (r.status === 'ok' || r.status === 'cached') delete missing[key];
  }
  writeFileSync(MISSING_FILE, JSON.stringify(missing, null, 2));

  const count = (status) => results.filter((r) => r.status === status).length;
  log(
    `\nok ${count('ok')} · cached ${count('cached')} · missing ${count('missing')} · failed ${count('failed')}`,
  );
  const failed = results.filter((r) => r.status === 'failed');
  for (const f of failed) log(`  FAILED ${f.category}/${f.dexId} ${f.species}: ${f.detail}`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main();
