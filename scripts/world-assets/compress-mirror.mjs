#!/usr/bin/env node
/**
 * D42 step: encode a whole world mirror with EXT_meshopt_compression
 * (ENGINE-ASSET-PLAN §4 SEAT ASSET steps 1-2; LD2).
 *
 * The encode is composed BY HAND, not through gltf-transform's `meshopt()`:
 * at level high that transform clamps normals to 8 bits and always reorders,
 * and its writer hard-codes octahedral 8-bit normals under FILTER (plan §2.2).
 * Each recipe is therefore an explicit chain:
 *
 *   dequantize POSITION (only where it is not float: a quantized position
 *   would otherwise keep its storage while `quantize` still moves its node)
 *   → optional reorder({ target: 'size' })
 *   → quantize() with explicit bits and quantizationVolume 'scene'
 *   → EXTMeshoptCompression.setEncoderOptions({ method })
 *
 * | recipe | bits pos/norm/uv/weight/colour | method   | reorder | index views |
 * | hq10   | 16 / 10 / 16 / 16 / 16          | QUANTIZE | on      | TRIANGLES   |
 * | high8  | 14 / 8 oct / 12 / 8 / 8         | FILTER   | on      | TRIANGLES   |
 * | medium | 16 / 16 / 16 / 16 / 16          | QUANTIZE | on      | TRIANGLES   |
 * | nq     | none                            | QUANTIZE | off     | TRIANGLES   |
 * | nqx    | none                            | QUANTIZE | off     | INDICES     |
 *
 * Index views (ASSET-11): gltf-transform writes a triangle list's indices in
 * meshopt's TRIANGLES mode, whose codec may rotate a triangle's corners
 * (same triangle, winding and order; different index bytes). On a
 * near-coplanar z-fighting part that rotation changes which surface wins a
 * pixel (Haunter's pupils, 93.glb). `nqx` is `nq` with every index view in
 * INDICES mode (`EXTMeshoptCompressionIndexExact`): the sequence codec is
 * lossless in order, so the decoded index buffers are A's byte for byte and
 * the whole decoded geometry is identical to A. The stamp and every row
 * record the index mode (`indexMode`: 'triangles' | 'indices').
 *
 * Reorder is turned off per file for TRANSPARENT-ORDER files (`--no-reorder`,
 * or `--no-reorder-blend` for every file with a BLEND material): reorder
 * permutes triangles, which changes a BLEND primitive's draw order (X9).
 *
 * The volume is always 'scene': the per-mesh default clones skins (911 goes
 * from 1 skin to 8), which breaks `mergeFamilyKey` and skeleton sharing.
 * An attribute already stored at the recipe's width or narrower is kept as it
 * is (gltf-transform `quantize` never widens), so no recipe re-quantizes a
 * coarser source. KHR_mesh_quantization is declared whenever a vertex
 * attribute needs it (the A mirror's 400 undeclared files become valid).
 *
 * What is written (`--out <dir>`, normally `public/models/world/<arm>/`):
 *  - every GLB under models/ and props/, encoded (an `--overlay <dir>` file
 *    with the same relative path replaces its source: the decimated outliers);
 *  - env/ copied BYTE-IDENTICAL (env/kit GLBs are resolved by logical name
 *    through compat copies and are never compressed, plan conflict 8);
 *  - ATTRIBUTION.md and the source manifest.json (re-baked afterwards by
 *    `bake-manifest.mjs --metrics frozen|flip --dir <out>`);
 *  - `_encode.json`: the encoder stamp and one row per GLB. A row whose
 *    source sha256, recipe and options match is skipped on a re-run, so the
 *    script is idempotent; the encode itself is deterministic.
 *
 * A meshopt-compressed SOURCE is refused: re-encoding a lossy encode
 * compounds its error (the source is always mirror A or the A-encoding
 * decimation intermediates).
 *
 * Usage:
 *   node scripts/world-assets/compress-mirror.mjs --recipe hq10 \
 *     --src <repo>/public/models/world \
 *     --out <repo>/public/models/world/cand-hq10 [--jobs 12] \
 *     [--overlay <dir>] [--no-reorder a.glb,b.glb] [--no-reorder-blend] [--only <substring>]
 *     [--recipe-for models/regular/288.glb=nq,...]   (per-file recipe: a file A0 fails
 *     under the mirror's recipe takes the next one that passes; recorded per row)
 *   node scripts/world-assets/compress-mirror.mjs --recipe nqx --src <mirror A> --out <dir> --jobs 4
 *     (the index-exact lossless B: every decoded accessor, indices included, equals A's)
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { Accessor, PropertyType } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dequantize, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, assertPinnedMeshopt, createWorldIO, encoderStamp, glbUsesMeshopt } from './meshopt-codec.mjs';
import { relPosix, walkFiles } from './lib.mjs';

const { FLOAT } = Accessor.ComponentType;

/**
 * The four S0 candidate recipes (plan §4 ASSET step 2) and `nqx`, the
 * index-exact lossless B (D51 + ASSET-11). `indexMode` is the meshopt mode of
 * the index views ('triangles' when absent).
 */
export const RECIPES = {
  hq10: {
    bits: { position: 16, normal: 10, texcoord: 16, weight: 16, color: 16 },
    normalsInQuantize: true,
    method: 'quantize',
    reorder: true,
  },
  high8: {
    bits: { position: 14, normal: 8, texcoord: 12, weight: 8, color: 8 },
    normalsInQuantize: false,
    method: 'filter',
    reorder: true,
  },
  medium: {
    bits: { position: 16, normal: 16, texcoord: 16, weight: 16, color: 16 },
    normalsInQuantize: true,
    method: 'quantize',
    reorder: true,
  },
  nq: { bits: null, normalsInQuantize: false, method: 'quantize', reorder: false },
  nqx: { bits: null, normalsInQuantize: false, method: 'quantize', reorder: false, indexMode: 'indices' },
};

/** The meshopt mode a recipe writes its triangle-list index views in: 'triangles' or 'indices'. */
export function indexModeOf(recipeName) {
  const recipe = RECIPES[recipeName];
  if (!recipe) throw new Error(`unknown recipe ${recipeName} (${Object.keys(RECIPES).join(', ')})`);
  return recipe.indexMode ?? 'triangles';
}

/**
 * Whether a recipe's decoded index buffers must equal the source's byte for
 * byte: INDICES-mode views and no reorder (A0 asserts it, `d42-parity`).
 */
export function indexExact(recipeName) {
  return indexModeOf(recipeName) === 'indices' && !RECIPES[recipeName].reorder;
}

const MESHOPT = EXTMeshoptCompression.EXTENSION_NAME;

/**
 * EXT_meshopt_compression with every TRIANGLES index view written in INDICES
 * mode (the index-exact recipes). gltf-transform's writer picks TRIANGLES for
 * the indices of a triangle-list primitive when its accessor prewrite claims
 * the views; this switches the mode after that claim and before the buffer
 * prewrite encodes them, so the INDICES codec (`encodeGltfBuffer(..., mode)`)
 * stores the sequence exactly and the JSON declares the mode it was written
 * in. Everything else (vertex attributes, animation, layout) is the base
 * extension's. A writer without the claimed views throws instead of silently
 * writing TRIANGLES.
 */
export class EXTMeshoptCompressionIndexExact extends EXTMeshoptCompression {
  prewrite(context, propertyType) {
    super.prewrite(context, propertyType);
    if (propertyType === PropertyType.ACCESSOR) {
      const views = this._encoderBufferViews;
      if (!views || typeof views !== 'object') {
        throw new Error(`${MESHOPT}: the writer's claimed buffer views are not where this gltf-transform version keeps them (index-exact mode)`);
      }
      for (const view of Object.values(views)) {
        const ext = view.extensions?.[MESHOPT];
        if (ext?.mode === 'TRIANGLES') ext.mode = 'INDICES';
      }
    }
    return this;
  }
}

/** The semantics `quantize` touches when normals stay out of it (FILTER recipes). */
const NO_NORMALS_PATTERN = /^(POSITION|TEXCOORD|JOINTS|WEIGHTS|COLOR)(_\d+)?$/;

const CT = Accessor.ComponentType;
const COMPONENT_BYTES = { [CT.BYTE]: 1, [CT.UNSIGNED_BYTE]: 1, [CT.SHORT]: 2, [CT.UNSIGNED_SHORT]: 2, [CT.UNSIGNED_INT]: 4, [CT.FLOAT]: 4 };

/**
 * The recipe table as an accessor contract (A0 asserts B against it, not
 * against option names). `src` describes mirror A's accessor:
 * `{ componentType, normalized, unitRange, maxValue }` (`unitRange`: every
 * component in [0, 1], for TEXCOORD/WEIGHTS — quantize skips anything
 * outside; `maxValue`: the largest JOINTS index). Returns
 * `{ componentType, normalized, filter }` of the encoded vertex attribute.
 */
export function expectedAttributeFormat(recipeName, semantic, src) {
  const recipe = RECIPES[recipeName];
  const keep = { componentType: src.componentType, normalized: src.normalized, filter: 'NONE' };
  if (!recipe.bits) return keep;
  const narrowEnough = (bits) => COMPONENT_BYTES[src.componentType] <= bits / 8;
  const signed = (bits) => ({ componentType: bits <= 8 ? CT.BYTE : CT.SHORT, normalized: true, filter: 'NONE' });
  const unsigned = (bits) => ({ componentType: bits <= 8 ? CT.UNSIGNED_BYTE : CT.UNSIGNED_SHORT, normalized: true, filter: 'NONE' });
  if (semantic === 'POSITION') return signed(recipe.bits.position); // dequantized first, then quantized
  if (semantic === 'NORMAL' || semantic === 'TANGENT') {
    if (!recipe.normalsInQuantize) {
      return recipe.method === 'filter' ? { componentType: CT.BYTE, normalized: true, filter: 'OCTAHEDRAL' } : keep;
    }
    return narrowEnough(recipe.bits.normal) ? keep : signed(recipe.bits.normal);
  }
  if (/^TEXCOORD_\d+$/.test(semantic)) {
    if (!src.unitRange) return keep;
    return narrowEnough(recipe.bits.texcoord) ? keep : unsigned(recipe.bits.texcoord);
  }
  if (/^COLOR_\d+$/.test(semantic)) return narrowEnough(recipe.bits.color) ? keep : unsigned(recipe.bits.color);
  if (/^WEIGHTS_\d+$/.test(semantic)) {
    if (!src.unitRange) return keep;
    return narrowEnough(recipe.bits.weight) ? keep : unsigned(recipe.bits.weight);
  }
  if (/^JOINTS_\d+$/.test(semantic)) {
    // quantize narrows joints to UBYTE when every index fits, else keeps them.
    return { componentType: src.maxValue <= 255 ? CT.UNSIGNED_BYTE : src.componentType, normalized: false, filter: 'NONE' };
  }
  return keep;
}

/** The expected filter of an animation output accessor under a recipe. */
export function expectedAnimationFilter(recipeName, path) {
  if (RECIPES[recipeName].method !== 'filter') return 'NONE';
  if (path === 'rotation') return 'QUATERNION';
  if (path === 'translation' || path === 'scale') return 'EXPONENTIAL';
  return 'NONE';
}

/** Describe a gltf-transform attribute accessor for `expectedAttributeFormat`. */
export function describeSourceAccessor(accessor) {
  const min = accessor.getMinNormalized([]);
  const max = accessor.getMaxNormalized([]);
  return {
    componentType: accessor.getComponentType(),
    normalized: accessor.getNormalized(),
    unitRange: min.every((v) => v >= 0) && max.every((v) => v <= 1),
    maxValue: Math.max(...accessor.getMax([])),
  };
}

/** Every material of the document whose alphaMode is BLEND. */
export function hasBlendMaterial(document) {
  return document
    .getRoot()
    .listMaterials()
    .some((material) => material.getAlphaMode() === 'BLEND');
}

/**
 * Whether a vertex attribute's storage needs KHR_mesh_quantization (core
 * glTF allows only float POSITION/NORMAL/TANGENT, float or unsigned
 * normalized TEXCOORD/COLOR/WEIGHTS, unsigned JOINTS).
 */
export function attributeNeedsQuantizationExtension(semantic, accessor) {
  const type = accessor.getComponentType();
  if (type === FLOAT) return false;
  const normalized = accessor.getNormalized();
  const unsignedNormalized = normalized && (type === Accessor.ComponentType.UNSIGNED_BYTE || type === Accessor.ComponentType.UNSIGNED_SHORT);
  if (semantic === 'POSITION' || semantic === 'NORMAL' || semantic === 'TANGENT') return true;
  if (/^(TEXCOORD|COLOR|WEIGHTS)_\d+$/.test(semantic)) return !unsignedNormalized;
  if (/^JOINTS_\d+$/.test(semantic)) return false;
  return false;
}

/** Declare KHR_mesh_quantization (required) when any primitive needs it. */
export function ensureQuantizationExtension(document) {
  const needs = document
    .getRoot()
    .listMeshes()
    .some((mesh) =>
      mesh.listPrimitives().some((prim) => prim.listSemantics().some((semantic) => attributeNeedsQuantizationExtension(semantic, prim.getAttribute(semantic)))),
    );
  if (needs) document.createExtension(KHRMeshQuantization).setRequired(true);
  return needs;
}

/**
 * Apply one recipe to a parsed document (in place). `options.reorder`
 * overrides the recipe's reorder flag (TRANSPARENT-ORDER files).
 */
export async function encodeDocument(document, recipeName, options = {}) {
  const recipe = RECIPES[recipeName];
  if (!recipe) throw new Error(`unknown recipe ${recipeName} (${Object.keys(RECIPES).join(', ')})`);
  if (document.getRoot().listExtensionsUsed().some((ext) => ext.extensionName === 'EXT_meshopt_compression')) {
    throw new Error('refusing a meshopt-compressed source: encode from mirror A only');
  }
  await MeshoptEncoder.ready;
  const doReorder = options.reorder ?? recipe.reorder;
  const transforms = [];
  if (recipe.bits) {
    const quantizedPositions = document
      .getRoot()
      .listMeshes()
      .some((mesh) => mesh.listPrimitives().some((prim) => prim.getAttribute('POSITION')?.getComponentType() !== FLOAT));
    if (quantizedPositions) transforms.push(dequantize({ pattern: /^POSITION$/ }));
  }
  if (doReorder) transforms.push(reorder({ encoder: MeshoptEncoder, target: 'size' }));
  if (recipe.bits) {
    const pattern = recipe.normalsInQuantize ? /.*/ : NO_NORMALS_PATTERN;
    transforms.push(
      quantize({
        pattern,
        patternTargets: /.*/,
        quantizationVolume: 'scene',
        quantizePosition: recipe.bits.position,
        quantizeNormal: recipe.bits.normal,
        quantizeTexcoord: recipe.bits.texcoord,
        quantizeColor: recipe.bits.color,
        quantizeWeight: recipe.bits.weight,
        quantizeGeneric: 16,
      }),
    );
  }
  if (transforms.length) await document.transform(...transforms);
  ensureQuantizationExtension(document);
  const indexMode = indexModeOf(recipeName);
  document
    .createExtension(indexMode === 'indices' ? EXTMeshoptCompressionIndexExact : EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({
      method: recipe.method === 'filter' ? EXTMeshoptCompression.EncoderMethod.FILTER : EXTMeshoptCompression.EncoderMethod.QUANTIZE,
    });
  return { reorder: doReorder, indexMode };
}

/** Encode one GLB's bytes. Returns the encoded bytes and what was applied. */
export async function encodeGlb(bytes, recipeName, options = {}) {
  if (glbUsesMeshopt(bytes)) throw new Error('refusing a meshopt-compressed source: encode from mirror A only');
  const io = await createWorldIO({ encoder: true, quiet: options.quiet ?? true });
  const document = await io.readBinary(new Uint8Array(bytes));
  const blend = hasBlendMaterial(document);
  const reorderOverride = options.noReorder || (options.noReorderBlend && blend) ? false : undefined;
  const applied = await encodeDocument(document, recipeName, { reorder: reorderOverride });
  const out = Buffer.from(await io.writeBinary(document));
  return { bytes: out, reorder: applied.reorder, indexMode: applied.indexMode, blend };
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Copy a directory tree byte for byte (env/). Returns the files copied. */
export function copyTree(from, to) {
  const files = walkFiles(from);
  for (const file of files) {
    const dest = join(to, relPosix(from, file));
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
  }
  return files.length;
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

/** The GLBs a mirror encodes: models/** and props/** (never env/). */
export function encodableFiles(src) {
  return ['models', 'props']
    .flatMap((dir) => walkFiles(join(src, dir), '.glb'))
    .map((file) => relPosix(src, file))
    .filter((rel) => !rel.split('/').some((part) => part.startsWith('_') || part.startsWith('.')))
    .sort();
}

async function encodeJob(job) {
  const source = job.overlay && existsSync(join(job.overlay, job.rel)) ? join(job.overlay, job.rel) : join(job.src, job.rel);
  const input = readFileSync(source);
  const t0 = performance.now();
  const recipe = job.recipeFor?.[job.rel] ?? job.recipe;
  const { bytes, reorder: reordered, indexMode, blend } = await encodeGlb(input, recipe, {
    noReorder: job.noReorder.includes(job.rel),
    noReorderBlend: job.noReorderBlend,
  });
  const ms = performance.now() - t0;
  const dest = join(job.out, job.rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  return {
    file: job.rel,
    recipe,
    source: source === join(job.src, job.rel) ? 'A' : 'overlay',
    srcSha256: sha256(input),
    srcBytes: input.length,
    srcGzip: gzipSync(input, { level: 6 }).length,
    bytes: bytes.length,
    gzip: gzipSync(bytes, { level: 6 }).length,
    sha256: sha256(bytes),
    reorder: reordered,
    indexMode,
    blend,
    ms: Math.round(ms),
  };
}

if (!isMainThread && workerData?.compressMirrorWorker) {
  parentPort.on('message', async (job) => {
    try {
      parentPort.postMessage({ ok: true, row: await encodeJob(job) });
    } catch (error) {
      parentPort.postMessage({ ok: false, file: job.rel, error: String(error?.stack ?? error) });
    }
  });
}

async function runPool(jobs, size) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(size, jobs.length) }, () => new Worker(fileURLToPath(import.meta.url), { workerData: { compressMirrorWorker: true } }));
  await Promise.all(
    workers.map(
      (worker) =>
        new Promise((done, fail) => {
          const feed = () => {
            if (next >= jobs.length) {
              worker.terminate().then(done, done);
              return;
            }
            worker.postMessage(jobs[next]);
            next += 1;
          };
          worker.on('message', (msg) => {
            if (!msg.ok) {
              fail(new Error(`${msg.file}: ${msg.error}`));
              return;
            }
            results.push(msg.row);
            if (results.length % 50 === 0) console.log(`  ${results.length}/${jobs.length}`);
            feed();
          });
          worker.on('error', fail);
          feed();
        }),
    ),
  );
  return results;
}

export async function compressMirror({ src, out, recipe, recipeFor = {}, overlay = null, noReorder = [], noReorderBlend = false, only = null, jobs = 8 }) {
  assertPinnedMeshopt();
  for (const r of [recipe, ...Object.values(recipeFor)]) if (!RECIPES[r]) throw new Error(`unknown recipe ${r}`);
  if (resolve(src) === resolve(out)) throw new Error('--out must differ from --src');
  if (!existsSync(join(src, 'manifest.json'))) throw new Error(`no manifest.json in ${src}`);
  mkdirSync(out, { recursive: true });
  const reportFile = join(out, '_encode.json');
  const previous = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : null;
  const stamp = encoderStamp({ recipe, recipeSpec: RECIPES[recipe], quantizationVolume: 'scene', indexMode: indexModeOf(recipe) });
  const sameEncoder = previous && JSON.stringify(previous.stamp) === JSON.stringify(stamp);
  const prevRows = new Map((sameEncoder ? previous.files : []).map((row) => [row.file, row]));

  const envFiles = copyTree(join(src, 'env'), join(out, 'env'));
  for (const name of ['ATTRIBUTION.md', 'manifest.json']) copyFileSync(join(src, name), join(out, name));

  const all = encodableFiles(src).filter((rel) => !only || rel.includes(only));
  const todo = [];
  const kept = [];
  for (const rel of all) {
    const source = overlay && existsSync(join(overlay, rel)) ? join(overlay, rel) : join(src, rel);
    const prev = prevRows.get(rel);
    const wantNoReorder = noReorder.includes(rel);
    if (
      prev &&
      existsSync(join(out, rel)) &&
      prev.srcSha256 === sha256(readFileSync(source)) &&
      prev.noReorder === wantNoReorder &&
      prev.noReorderBlend === noReorderBlend &&
      (prev.recipe ?? recipe) === (recipeFor[rel] ?? recipe) &&
      sha256(readFileSync(join(out, rel))) === prev.sha256
    ) {
      kept.push(prev);
      continue;
    }
    todo.push({ rel, src, out, overlay, recipe, recipeFor, noReorder, noReorderBlend });
  }
  console.log(`compress-mirror ${recipe}: ${all.length} GLBs (${todo.length} to encode, ${kept.length} unchanged), env ${envFiles} files copied`);
  const rows = todo.length ? await runPool(todo, jobs) : [];
  const files = [...kept, ...rows.map((row) => ({ ...row, noReorder: noReorder.includes(row.file), noReorderBlend }))].sort((a, b) =>
    a.file.localeCompare(b.file),
  );
  const totals = files.reduce(
    (acc, row) => ({
      srcBytes: acc.srcBytes + row.srcBytes,
      srcGzip: acc.srcGzip + row.srcGzip,
      bytes: acc.bytes + row.bytes,
      gzip: acc.gzip + row.gzip,
    }),
    { srcBytes: 0, srcGzip: 0, bytes: 0, gzip: 0 },
  );
  const report = { stamp, recipeFor, src: src.split('\\').join('/'), overlay: overlay?.split('\\').join('/') ?? null, totals, files };
  writeFileSync(reportFile, JSON.stringify(report, null, 1));
  const mib = (b) => (b / 1048576).toFixed(2);
  console.log(
    `  ${recipe}: ${mib(totals.srcBytes)} MiB (gzip ${mib(totals.srcGzip)}) → ${mib(totals.bytes)} MiB (gzip ${mib(totals.gzip)}); report ${reportFile}`,
  );
  return report;
}

if (isMainThread && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const listArg = (name) => {
    const value = arg(argv, name);
    if (!value) return [];
    if (value.startsWith('@')) return readFileSync(value.slice(1), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  };
  const recipe = arg(argv, '--recipe');
  const src = arg(argv, '--src');
  const out = arg(argv, '--out');
  if (!recipe || !src || !out) {
    console.error('usage: compress-mirror.mjs --recipe <hq10|high8|medium|nq|nqx> --src <mirror A> --out <dir> [--overlay <dir>] [--jobs n]');
    process.exit(2);
  }
  compressMirror({
    src,
    out,
    recipe,
    recipeFor: Object.fromEntries(listArg('--recipe-for').map((pair) => pair.split('='))),
    overlay: arg(argv, '--overlay'),
    noReorder: listArg('--no-reorder'),
    noReorderBlend: argv.includes('--no-reorder-blend'),
    only: arg(argv, '--only'),
    jobs: Number(arg(argv, '--jobs') ?? Math.max(1, Math.min(12, availableParallelism() - 4))),
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

