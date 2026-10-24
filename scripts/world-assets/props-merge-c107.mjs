#!/usr/bin/env node
/**
 * C-107 — land transformed props into the public mirror IN PLACE.
 *
 * WHY NOT `bake-manifest.mjs --mirror` + `pool-coverage.mjs --bake` (the
 * README landing flow, as the round brief choreographed it): bake-manifest
 * rebuilds `figures[]` from lib.mjs `buildFigureSet()` — 285 of the shipped
 * v2 manifest's 431 figures. The other 146 (C-101's pool-coverage tranche)
 * exist ONLY in the mirror manifest; re-mirroring would regress the shipped
 * manifest to v1/no-pool with a shrunken figure list, and pool-coverage's
 * tranche planner (default --base-limit 60) does not reconstruct it. Verified
 * 2026-09-19 (C-107 r1): figureSet keys 289, manifest entries covered 285,
 * tranche-only 146 (all with files in out/models).
 *
 * This script does the props[] SECTION of bake-manifest.mjs only, in place:
 *   - re-measures every GLB in out/props with bake-manifest's EXACT code
 *     path (NodeIO + ALL_EXTENSIONS, getBounds over the default scene,
 *     index-based triangle count, kb rounding),
 *   - copies any out/props GLBs missing from the mirror into
 *     public/models/world/props/,
 *   - upserts the measured entries into the mirror manifest's props[]
 *     (sorted by name, the bake-manifest invariant),
 *   - preserves version 2, figures, pool, environment, missingForms.
 *
 * The C-030 ledger and the C-101 manifest state are untouched.
 *
 * Usage: node scripts/world-assets/props-merge-c107.mjs [--dry-run]
 */

import { existsSync, cpSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { registerMeshoptDecoder } from './meshopt-codec.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const OUT_DIR = join(__dirname, 'out');
const OUT_PROPS_DIR = join(OUT_DIR, 'props');
const MIRROR_DIR = join(ROOT, 'public', 'models', 'world');
const MIRROR_MANIFEST = join(MIRROR_DIR, 'manifest.json');

/** Post-transform bar: ≤ 40 k triangles and ≤ 1.5 MB per prop. */
const PROP_TRI_CEILING = 40000;
const PROP_KB_CEILING = 1500;

const dryRun = process.argv.includes('--dry-run');

// --- bake-manifest.mjs measurement code, verbatim ---------------------------

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

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// -----------------------------------------------------------------------------

async function main() {
  const { readdirSync, mkdirSync } = await import('node:fs');
  const io = await registerMeshoptDecoder(new NodeIO().registerExtensions(ALL_EXTENSIONS));
  const manifest = JSON.parse(readFileSync(MIRROR_MANIFEST, 'utf8'));
  const before = JSON.stringify(manifest.props ?? []);

  const files = readdirSync(OUT_PROPS_DIR).filter((f) => f.endsWith('.glb')).sort();
  const props = [];
  for (const name of files) {
    const file = join(OUT_PROPS_DIR, name);
    const document = await io.read(file);
    const root = document.getRoot();
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    const bounds = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
    const kb = Math.round(statSync(file).size / 1024);
    const triangles = countTriangles(document);
    if (triangles > PROP_TRI_CEILING || kb > PROP_KB_CEILING) {
      console.log(`  prop props/${name} OVER BAR: ${triangles} tris / ${kb} KB`);
    }
    props.push({
      name: name.replace(/\.glb$/, ''),
      file: `props/${name}`,
      kb,
      triangles,
      bounds: { min: bounds.min.map((v) => round(v)), max: bounds.max.map((v) => round(v)) },
    });
  }
  props.sort((a, b) => a.name.localeCompare(b.name));

  const previous = new Map((manifest.props ?? []).map((p) => [p.name, p]));
  let added = 0;
  let updated = 0;
  for (const p of props) {
    const old = previous.get(p.name);
    if (!old) added += 1;
    else if (JSON.stringify(old) !== JSON.stringify(p)) updated += 1;
  }

  console.log(`measured ${props.length} props from out/props: +${added} new, ${updated} changed, ${props.length - added - updated} unchanged`);
  for (const p of props) {
    const mark = previous.has(p.name) ? (previous.get(p.name).triangles === p.triangles ? ' ' : '~') : '+';
    console.log(
      `  ${mark} ${p.name.padEnd(28)} ${String(p.kb).padStart(5)} KB ${String(p.triangles).padStart(6)} tris ` +
        `min=[${p.bounds.min.join(',')}] max=[${p.bounds.max.join(',')}]`,
    );
  }

  if (dryRun) {
    console.log('dry run — no writes');
    return;
  }

  // Copy the GLBs the mirror is missing (existing mirror files untouched).
  let copied = 0;
  for (const p of props) {
    const dst = join(MIRROR_DIR, p.file);
    if (!existsSync(dst)) {
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(join(OUT_PROPS_DIR, `${p.name}.glb`), dst);
      copied += 1;
    }
  }
  console.log(`copied ${copied} new GLBs into the mirror`);

  manifest.props = props;
  manifest.generatedAt = new Date().toISOString();
  writeFileSync(MIRROR_MANIFEST, JSON.stringify(manifest));
  const after = JSON.stringify(manifest.props);
  console.log(`manifest props[] ${before.length} → ${after.length} chars; version ${manifest.version}, figures ${manifest.figures.length}, pool universe ${manifest.pool?.universe} preserved`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
