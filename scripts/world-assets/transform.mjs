#!/usr/bin/env node
/**
 * Step 2 — normalize every raw GLB for the plaza.
 *
 * Figures (.cache/raw → out/models):
 * - decodes Draco (the browser then loads plain GLB — no decoder worker),
 * - dedup + prune + resample animations,
 * - textures ≤ 1024², KTX2 (ETC1S for colour, UASTC for data slots) when the
 *   KTX-Software `toktx` binary is available, WebP otherwise,
 * - quantizes normals / texcoords (positions untouched so skins stay exact).
 *
 * Hero props (.cache/props → out/props, card C-030): same texture and clip
 * treatment plus position quantization (props are static — no skins), and a
 * per-prop triangle ceiling of 40 k that is reported (not enforced — the
 * Meshy remesh target in props.mjs is what keeps meshes under it).
 *
 * Usage: node scripts/world-assets/transform.mjs [--force] [--webp] [--only regular/4,alolan/74]
 *        (--only keys are figure paths or bare prop names, e.g. haussmann-lamp-post)
 */

import { existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from './meshopt-codec.mjs';
import {
  dedup,
  prune,
  quantize,
  resample,
  textureCompress,
} from '@gltf-transform/functions';
import { toktx, Mode } from '@gltf-transform/cli';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import {
  CACHE_DIR,
  OUT_DIR,
  RAW_DIR,
  OUT_MODELS_DIR,
  ensureDir,
  findToktx,
  log,
  relPosix,
  walkFiles,
} from './lib.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const forceWebp = args.includes('--webp');
const onlyIndex = args.indexOf('--only');
const only =
  onlyIndex !== -1 && args[onlyIndex + 1]
    ? new Set(args[onlyIndex + 1].split(',').map((s) => s.trim()))
    : null;

const MAX_TEXTURE = 1024;
/** Per-figure ceiling after transform (spec §8); above it we retry at 512². */
const FIGURE_CEILING_KB = 1500;

// Keep in sync with props.mjs and bake-manifest.mjs (lib.mjs stays figure-only).
const PROPS_RAW_DIR = join(CACHE_DIR, 'props');
const OUT_PROPS_DIR = join(OUT_DIR, 'props');
/** Post-transform bar (card C-030): ≤ 40 k triangles per prop. */
const PROP_TRI_CEILING = 40000;

async function makeIO() {
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });
}

function dropDraco(document) {
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'KHR_draco_mesh_compression') extension.dispose();
  }
}

/**
 * Game rips ship 20–60 clips per figure (turns, jumps, sleep, battle poses);
 * animation data, not textures, is what makes a 5 MB Fuecoco. Keep one clip
 * per role the plaza uses and give them canonical names.
 */
const CLIP_ROLES = [
  { name: 'idle', patterns: [/defaultwait\d*_loop/i, /(^|[_|])wait\d*_loop/i, /battlewait\d*_loop/i, /idle\d*(_loop)?$/i, /idle/i] },
  { name: 'idle2', patterns: [/defaultidle\d*/i, /idle02/i, /rest\d*_loop/i] },
  { name: 'walk', patterns: [/walk\d*_loop/i, /walk/i] },
  { name: 'run', patterns: [/run\d*_loop/i, /run/i] },
];

function pruneAnimations(document) {
  const animations = document.getRoot().listAnimations();
  if (animations.length === 0) return [];
  const taken = new Set();
  const kept = [];
  for (const role of CLIP_ROLES) {
    let match = null;
    for (const pattern of role.patterns) {
      match = animations.find((a) => !taken.has(a) && pattern.test(a.getName()));
      if (match) break;
    }
    if (!match) continue;
    taken.add(match);
    match.setName(role.name);
    kept.push(role.name);
  }
  if (kept.length === 0) {
    const first = animations[0];
    first.setName('idle');
    taken.add(first);
    kept.push('idle');
  }
  // prune() does not touch samplers/channels, so dispose them explicitly or
  // they keep every accessor of the dropped clips alive.
  for (const animation of animations) {
    if (taken.has(animation)) continue;
    for (const channel of animation.listChannels()) channel.dispose();
    for (const sampler of animation.listSamplers()) sampler.dispose();
    animation.dispose();
  }
  return kept;
}

function textureTransforms(useKtx, maxSize) {
  const resize = [maxSize, maxSize];
  if (!useKtx) {
    return [textureCompress({ encoder: sharp, targetFormat: 'webp', resize, quality: 85 })];
  }
  return [
    // toktx refuses WebP input; the source ships WebP, so go through PNG first.
    textureCompress({ encoder: sharp, targetFormat: 'png', resize }),
    toktx({
      encoder: sharp,
      mode: Mode.UASTC,
      slots: /^(normalTexture|occlusionTexture|metallicRoughnessTexture)$/,
      level: 2,
      rdo: true,
      rdoLambda: 4,
      zstd: 18,
      resize,
    }),
    toktx({
      encoder: sharp,
      mode: Mode.ETC1S,
      slots: /^(baseColorTexture|emissiveTexture)$/,
      quality: 160,
      compression: 2,
      resize,
    }),
  ];
}

async function transformOne(io, rawFile, outFile, useKtx, maxSize, { quantizePositions = false } = {}) {
  const document = await io.read(rawFile);
  dropDraco(document);
  pruneAnimations(document);
  await document.transform(
    dedup(),
    prune(),
    resample(),
    ...textureTransforms(useKtx, maxSize),
    quantize(
      quantizePositions
        ? { quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }
        : { pattern: /^(NORMAL|TEXCOORD_\d+)$/, quantizeNormal: 10, quantizeTexcoord: 12 },
    ),
  );
  ensureDir(dirname(outFile));
  await io.write(outFile, document);
  return { bytes: statSync(outFile).size, triangles: countTriangles(document) };
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

/**
 * One raw→out batch. Figures keep the historical line format; props append
 * the triangle count and flag anything above the C-030 ceiling.
 */
async function runBatch(io, rawDir, outDir, rawFiles, useKtx, { props = false } = {}) {
  let done = 0;
  let skipped = 0;
  let failed = 0;
  let totalKb = 0;
  for (const rawFile of rawFiles) {
    const rel = relPosix(rawDir, rawFile);
    const key = rel.replace(/\.glb$/, '');
    if (only && !only.has(key)) continue;
    const outFile = join(outDir, rel);
    if (!force && existsSync(outFile) && statSync(outFile).mtimeMs >= statSync(rawFile).mtimeMs) {
      skipped += 1;
      totalKb += statSync(outFile).size / 1024;
      if (props) log(`  ${rel.padEnd(24)} unchanged ${Math.round(statSync(outFile).size / 1024)} KB`);
      continue;
    }
    try {
      const options = { quantizePositions: props };
      let { bytes, triangles } = await transformOne(io, rawFile, outFile, useKtx, MAX_TEXTURE, options);
      let note = '';
      if (bytes / 1024 > FIGURE_CEILING_KB) {
        ({ bytes, triangles } = await transformOne(io, rawFile, outFile, useKtx, 512, options));
        note = ' (retried at 512²)';
      }
      if (props && triangles > PROP_TRI_CEILING) {
        note += ` — OVER ${PROP_TRI_CEILING} tris, lower the remesh target in props.mjs and re-run`;
      }
      const inKb = Math.round(statSync(rawFile).size / 1024);
      const outKb = Math.round(bytes / 1024);
      totalKb += outKb;
      done += 1;
      log(
        `  ${rel.padEnd(24)} ${String(inKb).padStart(5)} → ${String(outKb).padStart(5)} KB` +
          (props ? ` · ${triangles} tris` : '') +
          note,
      );
    } catch (err) {
      failed += 1;
      log(`  FAILED ${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { done, skipped, failed, totalKb };
}

async function main() {
  const toktxBin = forceWebp ? null : findToktx();
  const useKtx = Boolean(toktxBin);
  if (useKtx) {
    process.env.PATH = `${dirname(toktxBin)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`;
    log(`KTX2 via ${toktxBin}`);
  } else {
    log('toktx not found — falling back to WebP textures (install KTX-Software for KTX2)');
  }

  const io = await makeIO();
  mkdirSync(OUT_MODELS_DIR, { recursive: true });
  mkdirSync(OUT_PROPS_DIR, { recursive: true });

  const figures = await runBatch(io, RAW_DIR, OUT_MODELS_DIR, walkFiles(RAW_DIR, '.glb'), useKtx);
  log(`\nfigures: transformed ${figures.done} · unchanged ${figures.skipped} · failed ${figures.failed} · total ${(figures.totalKb / 1024).toFixed(1)} MB`);

  const props = await runBatch(io, PROPS_RAW_DIR, OUT_PROPS_DIR, walkFiles(PROPS_RAW_DIR, '.glb'), useKtx, {
    props: true,
  });
  log(
    `props: transformed ${props.done} · unchanged ${props.skipped} · failed ${props.failed} · total ${(props.totalKb / 1024).toFixed(1)} MB` +
      (props.done + props.skipped === 0 ? ' (none cached — run props.mjs first)' : ''),
  );

  process.exit(figures.failed + props.failed > 0 ? 1 : 0);
}

main();
