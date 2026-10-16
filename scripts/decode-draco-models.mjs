#!/usr/bin/env node
/**
 * One-time script: decode Draco-compressed GLB models into standard GLB.
 *
 * The Pokemon-3D-api models use KHR_draco_mesh_compression, which requires a
 * Draco decoder Web Worker at runtime. That worker is fragile (CSP worker-src,
 * decoder version matching, CDN access). Decoding the models ahead of time
 * removes the Draco extension entirely so the browser loads them as plain GLB
 * (WebP textures are kept and handled natively by three.js).
 *
 * Usage: node scripts/decode-draco-models.mjs
 *
 * Processes every .glb under public/models/draft-room/ in place. That folder is
 * git-ignored third-party content (see NOTICE.md); it is never committed.
 */

import { readdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MODELS_DIR = join(ROOT, 'public', 'models', 'draft-room');

// Resolve the gltf-transform CLI binary from node_modules
const GLTF_BIN = join(ROOT, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');

function hasDraco(file) {
  const buf = readFileSync(file);
  // The extension name appears in the JSON chunk of the GLB
  return buf.includes(Buffer.from('KHR_draco_mesh_compression'));
}

function walkGlbs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkGlbs(full));
    } else if (name.endsWith('.glb')) {
      out.push(full);
    }
  }
  return out;
}

function decode(file) {
  const tmp = file + '.decoded.glb';
  // `cp` reads (decoding Draco) and writes an uncompressed standard GLB
  execFileSync(process.execPath, [GLTF_BIN, 'cp', file, tmp], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Replace original with decoded version
  writeFileSync(file, readFileSync(tmp));
  rmSync(tmp);
}

function main() {
  const files = walkGlbs(MODELS_DIR);
  console.log(`Found ${files.length} GLB models in ${MODELS_DIR}\n`);

  let decoded = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const rel = file.slice(MODELS_DIR.length + 1);
    if (!hasDraco(file)) {
      console.log(`  [skip] ${rel} (no Draco)`);
      skipped++;
      continue;
    }
    try {
      const before = statSync(file).size;
      decode(file);
      const after = statSync(file).size;
      console.log(`  [ok]   ${rel} (${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB)`);
      decoded++;
    } catch (err) {
      console.error(`  [FAIL] ${rel}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n── Summary ──────────────────────────────────`);
  console.log(`  Decoded: ${decoded}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed:  ${failed}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
