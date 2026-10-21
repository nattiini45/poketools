#!/usr/bin/env node
/**
 * Step 2c — Haussmann façade kit: Blender generates the four bay modules
 * (blender/facade-kit.py), gltf-transform compresses them, and they land in
 * out/env/kit/<bay>.glb for bake-manifest to list.
 *
 * Needs Blender 4.2+ on PATH or at the default Windows install location;
 * override with BLENDER_BIN. Without Blender the step is skipped and the
 * runtime keeps the procedural window writer (HaussmannBlock).
 *
 * Usage: node scripts/world-assets/kit-assets.mjs [--force]
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { registerMeshoptDecoder } from './meshopt-codec.mjs';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';
import { CACHE_DIR, OUT_ENV_DIR, ensureDir, log } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const force = process.argv.includes('--force');
const KIT_CACHE = join(CACHE_DIR, 'kit');
const KIT_OUT = join(OUT_ENV_DIR, 'kit');
const SCRIPT = join(__dirname, 'blender', 'facade-kit.py');

function findBlender() {
  if (process.env.BLENDER_BIN && existsSync(process.env.BLENDER_BIN)) return process.env.BLENDER_BIN;
  const root = 'C:\\Program Files\\Blender Foundation';
  if (existsSync(root)) {
    const versions = readdirSync(root)
      .filter((name) => name.startsWith('Blender'))
      .sort()
      .reverse();
    for (const version of versions) {
      const bin = join(root, version, 'blender.exe');
      if (existsSync(bin)) return bin;
    }
  }
  for (const bin of ['/Applications/Blender.app/Contents/MacOS/Blender', '/usr/bin/blender', '/usr/local/bin/blender']) {
    if (existsSync(bin)) return bin;
  }
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['blender'], { encoding: 'utf8' });
  const found = probe.stdout?.split(/\r?\n/).find(Boolean);
  return found && existsSync(found) ? found : null;
}

/**
 * Quantized, not Draco'd: the kit is a few KB either way and the figure
 * loader (`useFigureGLTF`) runs without a Draco decoder on purpose.
 * keepAttributes: the kit carries no textures of its own, so prune would
 * otherwise drop the UVs the runtime's scanned limestone needs.
 */
async function compress(input, output) {
  const io = await registerMeshoptDecoder(new NodeIO().registerExtensions(ALL_EXTENSIONS));
  const document = await io.read(input);
  await document.transform(
    dedup(),
    weld(),
    prune({ keepAttributes: true }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
  );
  await io.write(output, document);
}

async function main() {
  const blender = findBlender();
  if (!blender) {
    log('Blender not found — façade kit skipped (set BLENDER_BIN to enable).');
    return;
  }
  ensureDir(KIT_CACHE);
  ensureDir(KIT_OUT);

  const stale =
    force ||
    !['bay-ground', 'bay-shopfront', 'bay-balcony', 'bay-plain', 'dormer'].every((name) =>
      existsSync(join(KIT_CACHE, `${name}.glb`)),
    );
  if (stale) {
    log(`blender: ${blender}`);
    const result = spawnSync(blender, ['-b', '--python-exit-code', '1', '-P', SCRIPT, '--', KIT_CACHE], {
      encoding: 'utf8',
    });
    const lines = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).filter((line) => /kit:|Error|Traceback|line \d+/.test(line));
    for (const line of lines) log(`  ${line}`);
    if (result.status !== 0) throw new Error(`blender exited ${result.status}`);
  }

  for (const name of readdirSync(KIT_CACHE).filter((file) => file.endsWith('.glb'))) {
    const input = join(KIT_CACHE, name);
    const output = join(KIT_OUT, name);
    await compress(input, output);
    log(`  kit/${name} ${Math.round(statSync(input).size / 1024)} KB → ${Math.round(statSync(output).size / 1024)} KB`);
  }
  log('kit ready → run bake-manifest.mjs --mirror, then upload-supabase.mjs');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
