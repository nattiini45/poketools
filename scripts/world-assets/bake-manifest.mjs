#!/usr/bin/env node
/**
 * Step 3 — bake `out/manifest.json` from the transformed assets.
 *
 * Per figure: dexId, form, species, aliases, file, kb, heightm, bounds (rest
 * pose, model units), clip names, triangle count. Heights come from PokéAPI
 * (decimetres → metres) because @pkmn/dex no longer carries `heightm`; they
 * are cached in .cache/heights.json so re-bakes are offline.
 *
 * Environment assets under out/env/ are listed with their byte size.
 *
 * Manifest v3 (fidelity pass, proposal S8): every figure also carries
 * `clipMeta` ({ [clip]: { duration } } from the glTF animation samplers) and
 * `primaryType` (@pkmn/dex, bake time only), plus `types` and `roles` (D35
 * Q1/Q2) — see manifest-v3.mjs. The full bake and `--enrich` build these
 * through the one shared `v3FieldsFromRoot` (R33). A v2
 * `pool` coverage section already in the mirror is carried forward, so a
 * re-bake never drops what pool-coverage.mjs baked.
 *
 * Hero props under out/props/ get their own section with the
 * stats the bar checks: name, file, kb, triangles, bounds. Empty until
 * props.mjs has generated + transform.mjs has processed the props.
 *
 * Usage: node scripts/world-assets/bake-manifest.mjs [--mirror]
 *        node scripts/world-assets/bake-manifest.mjs --enrich
 *
 * `--enrich` is the OFFLINE v3 upgrade of the mirror manifest
 * (public/models/world/manifest.json): it reads each figure's GLB from the
 * local mirror, adds clipMeta + primaryType, and rewrites the file in place
 * with every other section untouched. No network, no out/ directory needed.
 *
 *        node scripts/world-assets/bake-manifest.mjs --refresh-mirror
 *
 * `--refresh-mirror` (LOOK-PLAN §2 SEAT A, D20: the plaza pilot writes the
 * mirror directly) re-lists the mirror's `env/` files and re-reads every prop
 * GLB under `props/` (kb, triangles, bounds — decimation moves them), then
 * rewrites the manifest in place. Figures, pool and missingForms are carried
 * over untouched; the version stays v3. Offline; `out/` is not needed.
 * Files or directories whose name starts with `_` or `.` are never listed
 * (scratch review pages).
 *
 * `--mirror` REPLACES the whole mirror with `out/`; it refuses to run when
 * `out/` has no figures (a fresh checkout would otherwise wipe the mirror).
 *
 *        node scripts/world-assets/bake-manifest.mjs --metrics frozen|flip --dir <arm>
 *          [--base <A manifest.json>] [--cast-kb <cast-kb.json>] [--overlay <decimated dir>]
 *          [--cast-freeze <file,...>]
 *
 * `--metrics` (D42, ENGINE-ASSET-PLAN §4 SEAT ASSET step 5) re-bakes an arm
 * mirror's manifest (`public/models/world/<arm>/manifest.json`) from mirror
 * A's manifest (`--base`, default the mirror's `manifest.json`). Every figure and prop
 * keeps A's record (bounds, clips, types, roles, …) and gains additive fields:
 *  - `kb`: the truthful wire size of the arm's file;
 *  - `castKb`: the size in A's ENCODING — the cast currency (D42 LD9). A's kb
 *    for every file, except under `flip` for the decimated files listed in
 *    `--cast-kb` (their decimated geometry written in A's encoding) unless
 *    `--cast-freeze` pins them (Q2 = no);
 *  - `gpuKb`: decoded vertex + index bytes after the loader's Float32
 *    promotion (`vertex-formats.ts` rules);
 *  - `drawParts`: draws per pass after `consolidateFigureMeshes` (R50 item 3).
 * `triangles` is A's under `frozen` and the real count under `flip`. The
 * decimated files take bounds recomputed from their decimated geometry
 * (`--overlay`, X7) in both modes, so frozen and flip differ ONLY in
 * `castKb` and `triangles` of the decimated files.
 *
 *          [--materials <arm>/_encode.json]
 *
 * `--materials` (the material arm `d42m`, plan step 6): the arm's
 * `material-lint --mirror` report adds ONE note to the `d42` block —
 * `materials: { arm, from, tool, fixes, files, byFix }` (the arm and its
 * source arm, the fixes, the changed-file count and per-fix material / file
 * counts; the per-file list stays in `_encode.json`). Every other field is
 * baked exactly as without it.
 *
 * The encode note (ASSET-11): when the arm has an `_encode.json` (written by
 * `compress-mirror.mjs`, or by `material-lint --mirror`, which carries its
 * source arm's stamp), the `d42` block also records
 * `encode: { recipe, indexMode }` — the meshopt mode of the index views,
 * 'indices' for the index-exact B (`nqx`: decoded index buffers = A's) and
 * 'triangles' for a stamp without one (the triangle codec).
 */

import { existsSync, readFileSync, statSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { registerMeshoptDecoder } from './meshopt-codec.mjs';
import { Dex } from '@pkmn/dex';
import { enrichManifest, MANIFEST_VERSION_V3, v3FieldsFromRoot } from './manifest-v3.mjs';
import {
  OUT_DIR,
  OUT_MODELS_DIR,
  OUT_ENV_DIR,
  MIRROR_DIR,
  HEIGHTS_CACHE,
  MISSING_FILE,
  CACHE_DIR,
  buildFigureSet,
  ensureDir,
  figureKey,
  log,
  readJson,
  relPosix,
  walkFiles,
  parallel,
} from './lib.mjs';

const mirror = process.argv.includes('--mirror');
const enrich = process.argv.includes('--enrich');
const refreshMirror = process.argv.includes('--refresh-mirror');
const MANIFEST_VERSION = MANIFEST_VERSION_V3;

// Keep in sync with props.mjs and transform.mjs (lib.mjs stays figure-only).
const OUT_PROPS_DIR = join(OUT_DIR, 'props');
/** Post-transform bar: ≤ 40 k triangles and ≤ 1.5 MB per prop. */
const PROP_TRI_CEILING = 40000;
const PROP_KB_CEILING = 1500;

async function fetchHeight(slug, cache) {
  if (slug in cache) return cache[slug];
  const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`);
  if (!res.ok) {
    log(`  PokéAPI ${slug}: HTTP ${res.status}`);
    cache[slug] = null;
    return null;
  }
  const data = await res.json();
  const heightm = typeof data.height === 'number' ? data.height / 10 : null;
  cache[slug] = heightm;
  return heightm;
}

export function countTriangles(document) {
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

/**
 * One full-bake figure record. The v3 fields (clipMeta, primaryType, types,
 * roles) come from `v3FieldsFromRoot`, the same builder `--enrich` uses, so
 * a full bake emits every v3 field the enrich pass does (R33). Exported for
 * the scripts/world-assets tests; `root` is a glTF-Transform document root.
 */
export function bakedFigure(desc, { root, file, sourceForm, kb, heightm, bounds, triangles, dex, roleSpecies }) {
  return {
    dexId: desc.dexId,
    form: desc.category,
    species: desc.species,
    aliases: desc.aliases,
    file,
    sourceForm,
    kb,
    heightm,
    bounds: { min: bounds.min.map((v) => round(v)), max: bounds.max.map((v) => round(v)) },
    clips: root.listAnimations().map((a) => a.getName()),
    ...v3FieldsFromRoot(root, desc.species, { dex, ...(roleSpecies ? { roleSpecies } : {}) }),
    triangles,
  };
}

async function main() {
  ensureDir(CACHE_DIR);
  const io = await registerMeshoptDecoder(new NodeIO().registerExtensions(ALL_EXTENSIONS));
  const heights = readJson(HEIGHTS_CACHE, {});
  const missing = readJson(MISSING_FILE, {});
  const figureSet = buildFigureSet();

  const figures = [];
  const entries = [...figureSet.values()];
  await parallel(entries, 4, async (desc) => {
    const file = join(OUT_MODELS_DIR, desc.category, `${desc.dexId}.glb`);
    let sourceForm = desc.category;
    let resolvedFile = file;
    if (!existsSync(file)) {
      const regular = join(OUT_MODELS_DIR, 'regular', `${desc.dexId}.glb`);
      if (desc.category !== 'regular' && existsSync(regular)) {
        sourceForm = 'regular';
        resolvedFile = regular;
      } else {
        log(`  no file for ${figureKey(desc.category, desc.dexId)} ${desc.species}`);
        return;
      }
    }
    const heightm = await fetchHeight(desc.pokeapi, heights);
    const document = await io.read(resolvedFile);
    const root = document.getRoot();
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    const bounds = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
    figures.push(
      bakedFigure(desc, {
        root,
        file: relPosix(OUT_DIR, resolvedFile),
        sourceForm,
        kb: Math.round(statSync(resolvedFile).size / 1024),
        heightm,
        bounds,
        triangles: countTriangles(document),
        dex: Dex,
      }),
    );
  });
  writeFileSync(HEIGHTS_CACHE, JSON.stringify(heights, null, 2));

  figures.sort((a, b) => a.dexId - b.dexId || a.form.localeCompare(b.form));

  const props = [];
  for (const file of walkFiles(OUT_PROPS_DIR, '.glb')) {
    const document = await io.read(file);
    const root = document.getRoot();
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    const bounds = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
    const kb = Math.round(statSync(file).size / 1024);
    const triangles = countTriangles(document);
    if (triangles > PROP_TRI_CEILING || kb > PROP_KB_CEILING) {
      log(`  prop ${relPosix(OUT_DIR, file)} OVER BAR: ${triangles} tris / ${kb} KB`);
    }
    props.push({
      name: relPosix(OUT_PROPS_DIR, file).replace(/\.glb$/, ''),
      file: relPosix(OUT_DIR, file),
      kb,
      triangles,
      bounds: { min: bounds.min.map((v) => round(v)), max: bounds.max.map((v) => round(v)) },
    });
  }
  props.sort((a, b) => a.name.localeCompare(b.name));

  const environment = walkFiles(OUT_ENV_DIR).map((file) => ({
    file: relPosix(OUT_DIR, file),
    kb: Math.round(statSync(file).size / 1024),
  }));

  // Carry the v2 pool-coverage section forward (pool-coverage.mjs owns it).
  const mirrorManifest = join(MIRROR_DIR, 'manifest.json');
  const previous = existsSync(mirrorManifest) ? JSON.parse(readFileSync(mirrorManifest, 'utf8')) : null;
  const manifest = {
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    figures,
    props,
    environment,
    missingForms: Object.keys(missing),
    ...(previous?.pool ? { pool: previous.pool } : {}),
  };
  const manifestFile = join(OUT_DIR, 'manifest.json');
  writeFileSync(manifestFile, JSON.stringify(manifest));
  const noHeight = figures.filter((f) => f.heightm === null).length;
  const totalMb = figures.reduce((sum, f) => sum + f.kb, 0) / 1024;
  log(
    `manifest: ${figures.length} figures (${totalMb.toFixed(1)} MB, ${noHeight} without height), ${props.length} props, ${environment.length} env assets → ${manifestFile}`,
  );

  if (mirror) {
    if (figures.length === 0) {
      log(`refusing --mirror: ${OUT_DIR} has no figures — it would wipe ${MIRROR_DIR}. Use --refresh-mirror.`);
      process.exitCode = 1;
      return;
    }
    if (existsSync(MIRROR_DIR)) rmSync(MIRROR_DIR, { recursive: true, force: true });
    cpSync(OUT_DIR, MIRROR_DIR, { recursive: true });
    log(`mirrored to ${MIRROR_DIR}`);
  }
}

/** Offline v3 upgrade of the mirror manifest (see header). */
async function enrichMirror() {
  const io = await registerMeshoptDecoder(new NodeIO().registerExtensions(ALL_EXTENSIONS));
  const file = join(MIRROR_DIR, 'manifest.json');
  const before = readTextIfPresent(file);
  if (before === null) {
    log(`no mirror manifest at ${file}: the world manifests are untracked; a maintainer restores it from the private companion overlay that tracks it, or run the full bake`);
    process.exitCode = 1;
    return;
  }
  const current = JSON.parse(before);
  const readRoot = async (rel) => {
    const glb = join(MIRROR_DIR, rel);
    if (!existsSync(glb)) return null;
    return (await io.read(glb)).getRoot();
  };
  const { manifest, stats } = await enrichManifest(current, { readRoot, dex: Dex });
  const after = JSON.stringify(manifest);
  writeFileSync(file, after);
  log(
    `enriched ${file} → v${manifest.version}: ${stats.figures} figures, clipMeta ${stats.withMeta}, primaryType ${stats.withType}, GLB missing locally ${stats.missingGlb}; ${before.length} → ${after.length} bytes`,
  );
}

/** A file's text, or null when it does not exist (read-then-write, no exists check to race). */
function readTextIfPresent(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

/** A mirror/out file the manifest may list (scratch `_` / `.` paths never are). */
function listable(rel) {
  return !rel.split('/').some((part) => part.startsWith('_') || part.startsWith('.'));
}

async function readProp(io, baseDir, file) {
  const document = await io.read(file);
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const bounds = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
  return {
    name: relPosix(join(baseDir, 'props'), file).replace(/\.glb$/, ''),
    file: relPosix(baseDir, file),
    kb: Math.round(statSync(file).size / 1024),
    triangles: countTriangles(document),
    bounds: { min: bounds.min.map((v) => round(v)), max: bounds.max.map((v) => round(v)) },
  };
}

/** Re-list the mirror's env files and props in place (see header). */
async function refreshMirrorManifest() {
  const io = await registerMeshoptDecoder(new NodeIO().registerExtensions(ALL_EXTENSIONS));
  const file = join(MIRROR_DIR, 'manifest.json');
  const before = readTextIfPresent(file);
  if (before === null) {
    log(`no mirror manifest at ${file}: the world manifests are untracked; a maintainer restores it from the private companion overlay that tracks it, or run the full bake`);
    process.exitCode = 1;
    return;
  }
  const current = JSON.parse(before);
  const envDir = join(MIRROR_DIR, 'env');
  const environment = walkFiles(envDir)
    .map((f) => ({ file: relPosix(MIRROR_DIR, f), kb: Math.round(statSync(f).size / 1024) }))
    .filter((entry) => listable(entry.file))
    .sort((a, b) => a.file.localeCompare(b.file));
  const props = [];
  for (const glb of walkFiles(join(MIRROR_DIR, 'props'), '.glb')) {
    if (!listable(relPosix(MIRROR_DIR, glb))) continue;
    const prop = await readProp(io, MIRROR_DIR, glb);
    if (prop.triangles > PROP_TRI_CEILING || prop.kb > PROP_KB_CEILING) {
      log(`  prop ${prop.file} OVER BAR: ${prop.triangles} tris / ${prop.kb} KB`);
    }
    props.push(prop);
  }
  props.sort((a, b) => a.name.localeCompare(b.name));
  const byName = new Map((current.props ?? []).map((prop) => [prop.name, prop]));
  const manifest = { ...current, generatedAt: new Date().toISOString(), props, environment };
  const after = JSON.stringify(manifest);
  writeFileSync(file, after);
  const oldEnv = new Map((current.environment ?? []).map((entry) => [entry.file, entry.kb]));
  for (const entry of environment) {
    const was = oldEnv.get(entry.file);
    if (was !== entry.kb) log(`  env ${entry.file}: ${was ?? '—'} → ${entry.kb} KB`);
  }
  for (const [path] of oldEnv) if (!environment.some((entry) => entry.file === path)) log(`  env ${path}: removed`);
  for (const prop of props) {
    const was = byName.get(prop.name);
    if (!was || was.kb !== prop.kb || was.triangles !== prop.triangles) {
      log(`  prop ${prop.name}: ${was ? `${was.kb} KB / ${was.triangles} tris` : '—'} → ${prop.kb} KB / ${prop.triangles} tris`);
    }
  }
  log(`refreshed ${file}: ${environment.length} env files, ${props.length} props; ${before.length} → ${after.length} bytes`);
}

// ── D42 arm metrics (drawParts, castKb, gpuKb; --metrics frozen|flip) ─────────

const GL_TRIANGLES = 4;
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/**
 * Bytes the loader keeps for one vertex accessor after the Float32
 * promotion of `vertex-formats.ts` (`needsFloatVertexFormat`): integer
 * storage that is non-normalized, or normalized with 3 components, becomes
 * Float32; everything else keeps its storage.
 */
export function promotedAttributeBytes(accessor) {
  const type = accessor.getComponentType();
  const size = accessor.getElementSize();
  const count = accessor.getCount();
  const integer = type !== 5126;
  const promote = integer && (!accessor.getNormalized() || size === 3);
  return count * size * (promote ? 4 : COMPONENT_BYTES[type]);
}

/** Decoded + promoted vertex and index bytes of a document (each accessor once). */
export function gpuBytes(document) {
  const seen = new Set();
  let bytes = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const attribute of prim.listAttributes()) {
        if (seen.has(attribute)) continue;
        seen.add(attribute);
        bytes += promotedAttributeBytes(attribute);
      }
      const indices = prim.getIndices();
      if (indices && !seen.has(indices)) {
        seen.add(indices);
        bytes += indices.getCount() * COMPONENT_BYTES[indices.getComponentType()];
      }
    }
  }
  return bytes;
}

function matrixKey(m) {
  return Array.from(m, (v) => (Math.abs(v) < 5e-6 ? 0 : v).toFixed(5)).join(',');
}

/**
 * Draw parts per pass after `consolidateFigureMeshes` (Figure.tsx), from the
 * glTF graph the way three-stdlib's GLTFLoader builds it: a single-primitive
 * mesh IS its node (parent = the parent node, local matrix = the node's), a
 * multi-primitive mesh is a Group of identity-matrix meshes; the material
 * instance is the glTF material plus the loader's derivative-tangent /
 * vertex-colour / flat-shading variant. Meshes merge when parent, local
 * matrix, material instance, attribute layout, index presence and (skinned)
 * joints + inverse binds agree, and they carry no morph targets
 * (`mergeFamilyKey`). Points and lines are never merged. A0 cross-checks
 * this count against the real `consolidateFigureMeshes` on every file.
 */
export function drawPartsFromDocument(document) {
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) return 0;
  const ids = new Map();
  const id = (property) => {
    if (!ids.has(property)) ids.set(property, ids.size);
    return ids.get(property);
  };
  const materials = root.listMaterials();
  const families = new Set();
  let unmergeable = 0;
  const visit = (node, parentId) => {
    const mesh = node.getMesh();
    if (mesh) {
      const prims = mesh.listPrimitives();
      const single = prims.length === 1;
      const parentKey = single ? parentId : `n${id(node)}`;
      const local = single ? matrixKey(node.getMatrix()) : 'I';
      const skin = node.getSkin();
      const ibm = skin?.getInverseBindMatrices();
      const skinKey = skin
        ? `${skin.listJoints().map((j) => id(j)).join(',')}|${ibm ? Array.from(ibm.getArray(), (v) => v.toFixed(5)).join(',') : ''}`
        : '-';
      for (const prim of prims) {
        const mode = prim.getMode();
        if (mode !== GL_TRIANGLES && mode !== 5 && mode !== 6) {
          unmergeable += 1;
          continue;
        }
        if (prim.listTargets().length) {
          unmergeable += 1;
          continue;
        }
        const semantics = prim.listSemantics();
        const material = prim.getMaterial();
        const variant = [
          semantics.includes('TANGENT') ? '' : 'dt',
          semantics.includes('COLOR_0') ? 'vc' : '',
          semantics.includes('NORMAL') ? '' : 'flat',
        ].join(':');
        const materialKey = (material ? `m${materials.indexOf(material)}` : 'default') + variant;
        const layout = semantics
          .map((s) => `${s}:${prim.getAttribute(s).getElementSize()}`)
          .sort()
          .join(',');
        const indexed = mode === GL_TRIANGLES ? (prim.getIndices() ? 'i' : 'n') : 'i';
        families.add([parentKey, local, materialKey, layout, indexed, skinKey].join('||'));
      }
    }
    for (const child of node.listChildren()) visit(child, `n${id(node)}`);
  };
  for (const child of scene.listChildren()) visit(child, 'scene');
  return families.size + unmergeable;
}

/** The additive D42 metrics of one arm file. */
export function fileMetrics(document, bytes) {
  return {
    kb: Math.round(bytes / 1024),
    gpuKb: Math.round(gpuBytes(document) / 1024),
    drawParts: drawPartsFromDocument(document),
    triangles: countTriangles(document),
  };
}

/**
 * Build an arm manifest from A's (`base`). `measure(rel)` returns
 * `{ kb, gpuKb, drawParts, triangles }` for the arm's file (or `{ kb }` for an
 * env file); `overlayBounds(rel)` returns the recomputed bounds of a
 * decimated file. Pure apart from the callbacks.
 */
export function armManifest(base, { mode, measure, castKb = {}, castFreeze = [], overlayBounds = () => null, materials = null, encode = null }) {
  if (mode !== 'frozen' && mode !== 'flip') throw new Error(`--metrics must be frozen or flip, not ${mode}`);
  const decimated = new Set(Object.keys(castKb));
  const entry = (record) => {
    const m = measure(record.file);
    if (!m) return record;
    const isDecimated = decimated.has(record.file);
    const bounds = isDecimated ? overlayBounds(record.file) : null;
    const out = { ...record, kb: m.kb };
    if (bounds) out.bounds = { min: bounds.min.map((v) => round(v)), max: bounds.max.map((v) => round(v)) };
    if (mode === 'flip' && isDecimated) out.triangles = m.triangles;
    out.castKb = mode === 'flip' && isDecimated && !castFreeze.includes(record.file) ? castKb[record.file] : record.kb;
    out.gpuKb = m.gpuKb;
    out.drawParts = m.drawParts;
    return out;
  };
  return {
    ...base,
    figures: base.figures.map(entry),
    props: (base.props ?? []).map(entry),
    environment: (base.environment ?? []).map((e) => {
      const m = measure(e.file, { env: true });
      return m ? { ...e, kb: m.kb } : e;
    }),
    d42: {
      metrics: mode,
      decimated: [...decimated].sort(),
      castFreeze: [...castFreeze].sort(),
      ...(encode ? { encode } : {}),
      ...(materials ? { materials } : {}),
    },
  };
}

/**
 * The `d42.encode` note of an arm: its recipe and the meshopt index mode, from
 * the stamp of its `_encode.json` (compress-mirror's, or the source arm's
 * stamp a material-lint arm carries). Null without a recipe in the stamp.
 */
export function encodeNote(encode) {
  const stamp = encode?.stamp;
  if (!stamp?.recipe) return null;
  return { recipe: stamp.recipe, indexMode: stamp.indexMode ?? stamp.recipeSpec?.indexMode ?? 'triangles' };
}

/**
 * The `d42.materials` note of a material arm (`--materials`): from the arm's
 * `material-lint --mirror` `_encode.json` and the arm directory's name.
 */
export function materialsNote(encode, arm) {
  if (encode?.tool !== 'material-lint') throw new Error('--materials needs the arm’s material-lint _encode.json');
  return {
    arm,
    from: basename(encode.source?.dir ?? '') || null,
    tool: encode.tool,
    fixes: [...encode.fixes],
    files: encode.totals.changedFiles,
    byFix: encode.byFix,
  };
}

function cliArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

/** `--metrics frozen|flip --dir <arm>` (see header). */
async function bakeArmMetrics() {
  const mode = cliArg('--metrics');
  const dir = cliArg('--dir');
  if (!dir) {
    log('--metrics needs --dir <arm mirror>');
    process.exitCode = 1;
    return;
  }
  const baseFile = cliArg('--base') ?? join(MIRROR_DIR, 'manifest.json');
  if (!existsSync(baseFile)) {
    log(
      cliArg('--base')
        ? `--base ${baseFile} does not exist`
        : `no base manifest at ${baseFile}: the world manifests are untracked; a maintainer restores it from the private companion overlay that tracks it, or pass --base <A manifest.json>`,
    );
    process.exitCode = 1;
    return;
  }
  const base = JSON.parse(readFileSync(baseFile, 'utf8'));
  const castKb = cliArg('--cast-kb') ? JSON.parse(readFileSync(cliArg('--cast-kb'), 'utf8')) : {};
  const castFreeze = (cliArg('--cast-freeze') ?? '').split(',').filter(Boolean);
  const overlay = cliArg('--overlay');
  const io = await registerMeshoptDecoder(new NodeIO().registerExtensions(ALL_EXTENSIONS));
  const docs = new Map();
  const files = [...base.figures, ...(base.props ?? [])].map((r) => r.file);
  await parallel(files, 8, async (rel) => {
    const file = join(dir, rel);
    if (!existsSync(file)) return;
    const bytes = readFileSync(file);
    const document = await io.readBinary(new Uint8Array(bytes));
    docs.set(rel, fileMetrics(document, bytes.length));
  });
  const boundsOf = new Map();
  for (const rel of Object.keys(castKb)) {
    const file = overlay ? join(overlay, rel) : join(dir, rel);
    const root = (await io.read(file)).getRoot();
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    boundsOf.set(rel, getBounds(scene));
  }
  const measure = (rel, { env } = {}) => {
    if (env) {
      const file = join(dir, rel);
      return existsSync(file) ? { kb: Math.round(statSync(file).size / 1024) } : null;
    }
    return docs.get(rel) ?? null;
  };
  const materialsFile = cliArg('--materials');
  const materials = materialsFile ? materialsNote(JSON.parse(readFileSync(materialsFile, 'utf8')), basename(resolve(dir))) : null;
  const encodeFile = join(dir, '_encode.json');
  const encode = existsSync(encodeFile) ? encodeNote(JSON.parse(readFileSync(encodeFile, 'utf8'))) : null;
  const manifest = armManifest(base, { mode, measure, castKb, castFreeze, overlayBounds: (rel) => boundsOf.get(rel) ?? null, materials, encode });
  const missing = files.filter((rel) => !docs.has(rel));
  for (const figure of manifest.figures) {
    const was = base.figures.find((f) => f.file === figure.file);
    const real = docs.get(figure.file)?.triangles;
    if (real !== undefined && real !== was.triangles && !Object.hasOwn(castKb, figure.file)) {
      log(`  WARN ${figure.file}: triangles ${was.triangles} in A, ${real} in the arm (not a decimated file)`);
    }
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  const sum = (key) => manifest.figures.reduce((s, f) => s + (f[key] ?? 0), 0);
  log(
    `${mode} metrics → ${join(dir, 'manifest.json')}: ${manifest.figures.length} figures, kb ${sum('kb')} (A ${base.figures.reduce((s, f) => s + f.kb, 0)}), castKb ${sum('castKb')}, gpuKb ${sum('gpuKb')}, drawParts ${sum('drawParts')}; decimated ${Object.keys(castKb).length}; missing ${missing.length}; encode ${encode ? `${encode.recipe}/${encode.indexMode}` : 'none'}`,
  );
}

// Run only as a CLI, so the tests can import `bakedFigure` without a bake.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--metrics')) bakeArmMetrics();
  else if (enrich) enrichMirror();
  else if (refreshMirror) refreshMirrorManifest();
  else main();
}
