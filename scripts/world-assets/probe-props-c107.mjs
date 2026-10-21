#!/usr/bin/env node
/**
 * C-107 — load-probe for the Blender-authored props (bar criterion:
 * "loaded through the existing prop pipeline error-free" + "manifest
 * entries with measured bounds").
 *
 * Uses the transform.mjs registration exactly (gltf-transform NodeIO +
 * ALL_EXTENSIONS + draco3d decoder) to prove every GLB parses, then reports
 * kb / triangles / bounds / extensions per file. Read-only: no writes.
 *
 * Usage:
 *   node scripts/world-assets/probe-props-c107.mjs                 # raws (.cache/props)
 *   node scripts/world-assets/probe-props-c107.mjs out             # out/props
 *   node scripts/world-assets/probe-props-c107.mjs mirror          # public mirror + manifest cross-check
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from './meshopt-codec.mjs';
import draco3d from 'draco3dgltf';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

/** The nine C-107 slugs (keep in sync with blender/world-props-c107.py). */
const C107_SLUGS = [
  'sakura-torii-hero',
  'sakura-stone-lantern-tall',
  'sakura-stone-lantern-low',
  'mountain-ridge-arch',
  'mountain-cairn-small',
  'mountain-cairn-medium',
  'mountain-cairn-tall',
  'clouds-airship-hull',
  'clouds-halo-gate',
];

const TRI_CEILING = 40000; // C-030 post-transform bar
const KB_CEILING = 1500;

const mode = process.argv[2] ?? 'raw';
const dirs = {
  raw: join(__dirname, '.cache', 'props'),
  out: join(__dirname, 'out', 'props'),
  mirror: join(ROOT, 'public', 'models', 'world', 'props'),
};
const dir = dirs[mode];
if (!dir || !existsSync(dir)) {
  console.error(`probe: no such dir for mode "${mode}": ${dir}`);
  process.exit(1);
}

function countTriangles(document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const count = indices ? indices.getCount() : primitive.getAttribute('POSITION')?.getCount() ?? 0;
      triangles += Math.floor(count / 3);
    }
  }
  return triangles;
}

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

const manifestPath = join(ROOT, 'public', 'models', 'world', 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;

let failures = 0;
const rows = [];
for (const slug of C107_SLUGS) {
  const file = join(dir, `${slug}.glb`);
  if (!existsSync(file)) {
    console.log(`FAIL ${slug}: missing at ${file}`);
    failures += 1;
    continue;
  }
  try {
    const document = await io.read(file);
    const root = document.getRoot();
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    const bounds = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
    const triangles = countTriangles(document);
    const kb = Math.round(statSync(file).size / 1024);
    const extensions = root.listExtensionsUsed().map((e) => e.extensionName);
    const materials = root.listMaterials().map((m) => m.getName());
    const entry = manifest?.props?.find((prop) => prop.name === slug);
    const manifestNote =
      mode === 'mirror'
        ? entry
          ? `manifest ok (kb ${entry.kb}, tris ${entry.triangles})`
          : 'MANIFEST ENTRY MISSING'
        : '';
    if (mode === 'mirror' && !entry) failures += 1;
    if (triangles > TRI_CEILING || kb > KB_CEILING) {
      console.log(`OVER BAR ${slug}: ${triangles} tris / ${kb} KB`);
      failures += 1;
    }
    rows.push({
      slug,
      kb,
      triangles,
      min: bounds.min.map((v) => Number(v.toFixed(3))),
      max: bounds.max.map((v) => Number(v.toFixed(3))),
      extensions,
      materials: materials.length,
      manifestNote,
    });
    console.log(
      `ok ${slug.padEnd(28)} ${String(kb).padStart(5)} KB ${String(triangles).padStart(6)} tris ` +
        `min=[${bounds.min.map((v) => v.toFixed(2)).join(',')}] max=[${bounds.max.map((v) => v.toFixed(2)).join(',')}] ` +
        `ext=[${extensions.join(',') || 'none'}] mats=${materials.length} ${manifestNote}`,
    );
  } catch (err) {
    console.log(`FAIL ${slug}: parse error: ${err instanceof Error ? err.message : String(err)}`);
    failures += 1;
  }
}
console.log(`\nprobe ${mode}: ${C107_SLUGS.length - failures}/${C107_SLUGS.length} ok`);
process.exit(failures > 0 ? 1 : 0);
