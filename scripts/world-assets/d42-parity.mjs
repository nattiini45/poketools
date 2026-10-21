#!/usr/bin/env node
/**
 * D42 A0: parity of an encoded arm mirror (B) against mirror A, file by file
 * (ENGINE-ASSET-PLAN §4 SEAT ASSET step 4, §5 A0).
 *
 * Per GLB:
 *  - structure: triangles, primitives, meshes, materials, skins, joints,
 *    nodes, clips equal;
 *  - accessor contract: every vertex accessor's componentType, normalized
 *    flag and EXT_meshopt_compression filter, read from B's JSON, equals the
 *    recipe table (`compress-mirror.mjs` `expectedAttributeFormat`), and
 *    every animation output carries the recipe's filter; an index-exact
 *    recipe (`nqx`) writes no TRIANGLES-mode index view;
 *  - indices: per primitive, the decoded index array equals A's byte for
 *    byte (`indexParity`); a FAIL only for an index-exact recipe (the
 *    TRIANGLES codec of the others may rotate a triangle's corners);
 *  - validator: B's error codes are SKIN_* only, and only in files whose A
 *    already had them (A's baseline: 64 SKIN_* files);
 *  - geometry (rest pose, skinned through joint world × inverse bind, the
 *    glTF skinning equation; vertices matched per primitive by nearest
 *    position, ties broken by normal / UV / colour): positions p99.9 ≤ 2e-4 H
 *    and max ≤ 1 px at the closest seat (844 px / H), normals p99 ≤ 1°, UVs
 *    ≤ 1/65 535, vertex colour ≤ 1 sRGB level;
 *  - animation: per channel, rotation ≤ 0.01°, translation / scale ≤ 1e-3 of
 *    the channel's span;
 *  - merge parity: three-stdlib's GLTFLoader (three's meshopt decoder,
 *    workers off) + SkeletonUtils.clone + `consolidateFigureMeshes` bundled
 *    with esbuild from the WORKTREE's Figure.tsx (ENGINE-F's export): the
 *    mesh count after consolidation is equal A vs B (or a decrease, itemised),
 *    and `bake-manifest.mjs` `drawPartsFromDocument` equals it on both;
 *  - env/: every file byte-identical.
 *
 * Loader parity (`--loader <files>` or the automatic pick: the skinned file
 * with clips and the most joints (≥ 100), a second skinned file with clips,
 * two BLEND files, and 930): sampled track values and bone world matrices at
 * t = 0, ⅓, ⅔ of every clip through an AnimationMixer, and the posed AABB
 * (skinned vertices), A vs B, both through three-stdlib's loader.
 *
 * Usage:
 *   node scripts/world-assets/d42-parity.mjs --recipe hq10|nqx --src <mirror A> --arm <arm dir>
 *     [--report <json>] [--jobs 14] [--only <substring>] [--loader a.glb,b.glb] [--overlay <decimated dir>]
 *
 * A per-file recipe (`compress-mirror --recipe-for`) is read from the arm's
 * `_encode.json`; with `--overlay` a decimated outlier is compared with its
 * decimation intermediate (A1 already measured A → intermediate).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { RECIPES, describeSourceAccessor, encodableFiles, expectedAnimationFilter, expectedAttributeFormat, indexExact, indexModeOf } from './compress-mirror.mjs';
import { countTriangles, drawPartsFromDocument } from './bake-manifest.mjs';
import { createWorldIO, encoderStamp, glbAccessorFormats, glbJson } from './meshopt-codec.mjs';
import { walkFiles, relPosix } from './lib.mjs';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

/** The ESM URL node resolves a bare specifier to (realpath; one module instance). */
function esmUrl(specifier) {
  return import.meta.resolve(specifier);
}

/** A0 bars (plan §5). */
export const A0 = {
  positionP999FracH: 2e-4,
  positionMaxPx: 1,
  closeUpPx: 844,
  normalP99Deg: 1,
  uvMax: 1 / 65535,
  rotationDeg: 0.01,
  translationRel: 1e-3,
  colourLevels: 1,
};

// ── three (Node) kit: loader, decoder, clone, the worktree's consolidateFigureMeshes ──

let kitPromise = null;

/** Rewrite a GLB without images / textures (Node has no image decoder; geometry, materials and merge keys are unaffected). */
export function stripImages(bytes) {
  const json = glbJson(bytes);
  if (!json || !json.images) return Buffer.from(bytes);
  delete json.images;
  delete json.textures;
  delete json.samplers;
  const strip = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      if (/Texture$/.test(key) && obj[key] && typeof obj[key] === 'object' && 'index' in obj[key]) delete obj[key];
      else strip(obj[key]);
    }
  };
  strip(json.materials);
  json.extensionsUsed = (json.extensionsUsed ?? []).filter((e) => e !== 'KHR_texture_basisu' && e !== 'EXT_texture_webp');
  if (json.extensionsRequired) json.extensionsRequired = json.extensionsRequired.filter((e) => e !== 'KHR_texture_basisu' && e !== 'EXT_texture_webp');
  return rewriteGlbJson(bytes, json);
}

/** Replace a GLB's JSON chunk (BIN chunk kept byte for byte). */
export function rewriteGlbJson(bytes, json) {
  const buf = Buffer.from(bytes);
  const jsonLength = buf.readUInt32LE(12);
  const rest = buf.subarray(20 + jsonLength);
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (text.length % 4)) % 4;
  text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + rest.length, 8);
  header.writeUInt32LE(text.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, text, rest]);
}

/**
 * esbuild-bundle `consolidateFigureMeshes` from the worktree's Figure.tsx.
 * Every import but three is stubbed (the function needs THREE and
 * mergeGeometries only); three resolves to the same module URL the loader
 * uses, so `instanceof THREE.Mesh` holds.
 */
async function bundleConsolidate() {
  const esbuild = require('esbuild');
  const figure = join(REPO, 'src', 'components', 'world', 'route', 'figures', 'Figure.tsx');
  const source = readFileSync(figure, 'utf8');
  const exported = /export function consolidateFigureMeshes\(/.test(source);
  // A private, uniquely named scratch dir (mkdtemp), removed once the bundle is imported.
  const dir = mkdtempSync(join(tmpdir(), 'd42-parity-'));
  const entry = join(dir, `consolidate-entry-${process.pid}-${process.env.D42_WORKER ?? 'm'}.ts`);
  let entrySource;
  if (exported) {
    entrySource = `export { consolidateFigureMeshes } from ${JSON.stringify(figure.split('\\').join('/'))};\n`;
  } else {
    // ENGINE-F's export not landed yet: a local copy of the three functions.
    const pick = (name) => {
      const start = source.indexOf(`function ${name}(`);
      let depth = 0;
      let i = source.indexOf('{', start);
      for (; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}' && (depth -= 1) === 0) break;
      }
      return source.slice(start, i + 1);
    };
    entrySource = [
      "import * as THREE from 'three';",
      "import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';",
      pick('mergeableGeometry'),
      pick('mergeFamilyKey'),
      `export ${pick('consolidateFigureMeshes')}`,
    ].join('\n');
  }
  writeFileSync(entry, entrySource);
  // three and its examples resolve to the ESM URLs the loader below imports,
  // so the bundle and the loader share ONE three module instance.
  const stub = {
    name: 'd42-stub',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === 'three' || args.path.startsWith('three/examples/jsm/')) return { path: esmUrl(args.path), external: true };
        if (args.importer && args.importer.endsWith('Figure.tsx')) return { path: args.path, namespace: 'stub' };
        return null;
      });
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'module.exports = new Proxy(function () {}, { get: (t, k) => (k === "__esModule" ? true : function () {}) });',
        loader: 'js',
      }));
    },
  };
  const outfile = join(dir, `consolidate-${process.pid}-${process.env.D42_WORKER ?? 'm'}.mjs`);
  let mod;
  try {
    await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile, plugins: [stub], logLevel: 'error', jsx: 'automatic' });
    mod = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { consolidateFigureMeshes: mod.consolidateFigureMeshes, source: exported ? 'worktree Figure.tsx export (ENGINE-F)' : 'local copy of Figure.tsx (export not landed)' };
}

export async function loadThreeKit() {
  if (!kitPromise) {
    kitPromise = (async () => {
      const THREE = await import(esmUrl('three'));
      const { GLTFLoader } = await import(esmUrl('three-stdlib'));
      const { MeshoptDecoder } = await import(esmUrl('three/examples/jsm/libs/meshopt_decoder.module.js'));
      const SkeletonUtils = await import(esmUrl('three/examples/jsm/utils/SkeletonUtils.js'));
      await MeshoptDecoder.ready;
      const { consolidateFigureMeshes, source } = await bundleConsolidate();
      return { THREE, GLTFLoader, MeshoptDecoder, clone: SkeletonUtils.clone, consolidateFigureMeshes, consolidateSource: source };
    })();
  }
  return kitPromise;
}

/** Parse a GLB with three-stdlib's GLTFLoader + three's meshopt decoder (workers off). */
export async function threeParse(kit, bytes) {
  const stripped = stripImages(bytes);
  const ab = stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength);
  const loader = new kit.GLTFLoader();
  loader.setMeshoptDecoder(kit.MeshoptDecoder);
  return new Promise((done, fail) => loader.parse(ab, '', done, fail));
}

/** Meshes before / after consolidateFigureMeshes on a SkeletonUtils clone (the Figure path). */
export function mergeCount(kit, gltf) {
  const root = kit.clone(gltf.scene);
  let before = 0;
  root.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isLine) before += 1;
  });
  kit.consolidateFigureMeshes(root);
  let after = 0;
  root.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isLine) after += 1;
  });
  return { before, after };
}

// ── glTF-Transform side ─────────────────────────────────────────────────────

export function structure(document) {
  const root = document.getRoot();
  return {
    triangles: countTriangles(document),
    meshes: root.listMeshes().length,
    primitives: root.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0),
    materials: root.listMaterials().length,
    skins: root.listSkins().length,
    joints: root.listSkins().reduce((s, k) => s + k.listJoints().length, 0),
    nodes: root.listNodes().length,
    clips: root.listAnimations().map((a) => a.getName()),
    textures: root.listTextures().length,
  };
}

function mul4(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
    let s = 0;
    for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function xf(m, v, w = 1) {
  return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * w, m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * w, m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * w];
}

/** Rest-pose world vertex data per primitive (mesh order, first parent node). */
export function restPrimitives(document) {
  const out = [];
  for (const mesh of document.getRoot().listMeshes()) {
    const node = mesh.listParents().find((p) => p.propertyType === 'Node');
    const skin = node?.getSkin() ?? null;
    let jm = null;
    if (skin) {
      const ibm = skin.getInverseBindMatrices();
      jm = skin.listJoints().map((j, i) => mul4(j.getWorldMatrix(), ibm ? ibm.getElement(i, []) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    }
    const nm = node ? node.getWorldMatrix() : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION');
      const N = prim.getAttribute('NORMAL');
      const C = prim.getAttribute('COLOR_0');
      const J = prim.getAttribute('JOINTS_0');
      const W = prim.getAttribute('WEIGHTS_0');
      const uvs = prim.listSemantics().filter((s) => /^TEXCOORD_\d+$/.test(s)).sort().map((s) => prim.getAttribute(s));
      const n = P.getCount();
      const pos = new Float64Array(n * 3);
      const nor = N ? new Float64Array(n * 3) : null;
      const col = C ? new Float64Array(n * 4) : null;
      const uv = uvs.length ? new Float64Array(n * 2 * uvs.length) : null;
      const a = [], b = [], c = [], d = [], e = [];
      for (let i = 0; i < n; i += 1) {
        P.getElement(i, a);
        let w = a;
        let nn = N ? N.getElement(i, b) : null;
        if (jm && J && W) {
          J.getElement(i, c);
          W.getElement(i, d);
          const s = [0, 0, 0];
          const sn = [0, 0, 0];
          for (let k = 0; k < 4; k += 1) {
            if (!d[k]) continue;
            const m = jm[c[k]];
            const q = xf(m, a);
            s[0] += d[k] * q[0]; s[1] += d[k] * q[1]; s[2] += d[k] * q[2];
            if (nn) {
              const r = xf(m, nn, 0);
              sn[0] += d[k] * r[0]; sn[1] += d[k] * r[1]; sn[2] += d[k] * r[2];
            }
          }
          w = s;
          if (nn) nn = sn;
        } else {
          w = xf(nm, a);
          if (nn) nn = xf(nm, nn, 0);
        }
        pos[i * 3] = w[0]; pos[i * 3 + 1] = w[1]; pos[i * 3 + 2] = w[2];
        if (nor) {
          const L = Math.hypot(nn[0], nn[1], nn[2]) || 1;
          nor[i * 3] = nn[0] / L; nor[i * 3 + 1] = nn[1] / L; nor[i * 3 + 2] = nn[2] / L;
        }
        if (col) {
          C.getElement(i, e);
          col[i * 4] = e[0]; col[i * 4 + 1] = e[1]; col[i * 4 + 2] = e[2]; col[i * 4 + 3] = e.length > 3 ? e[3] : 1;
        }
        if (uv) uvs.forEach((acc, u) => {
          acc.getElement(i, e);
          uv[(i * uvs.length + u) * 2] = e[0];
          uv[(i * uvs.length + u) * 2 + 1] = e[1];
        });
      }
      out.push({ n, pos, nor, col, uv, uvCount: uvs.length });
    }
  }
  return out;
}

const toSrgb = (l) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);

/** Geometry parity A vs B over matched vertices (see header). */
export function geometryParity(docA, docB) {
  const A = restPrimitives(docA);
  const B = restPrimitives(docB);
  if (A.length !== B.length) return { error: `primitive count ${A.length} vs ${B.length}` };
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const p of A) for (let i = 0; i < p.n; i += 1) for (let k = 0; k < 3; k += 1) {
    lo[k] = Math.min(lo[k], p.pos[i * 3 + k]);
    hi[k] = Math.max(hi[k], p.pos[i * 3 + k]);
  }
  const H = hi[1] - lo[1] || 1;
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const dists = [];
  const angs = [];
  let uvMax = 0;
  let colMax = 0;
  for (let p = 0; p < A.length; p += 1) {
    const a = A[p];
    const b = B[p];
    const cell = diag / 256;
    const grid = new Map();
    const key = (x, y, z) => `${x},${y},${z}`;
    for (let j = 0; j < b.n; j += 1) {
      const k = key(Math.floor(b.pos[j * 3] / cell), Math.floor(b.pos[j * 3 + 1] / cell), Math.floor(b.pos[j * 3 + 2] / cell));
      const list = grid.get(k);
      if (list) list.push(j);
      else grid.set(k, [j]);
    }
    for (let i = 0; i < a.n; i += 1) {
      const x = a.pos[i * 3], y = a.pos[i * 3 + 1], z = a.pos[i * 3 + 2];
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      let bd = Infinity;
      const cands = [];
      for (let r = 1; r <= 4 && bd === Infinity; r += 1) {
        for (let dx = -r; dx <= r; dx += 1) for (let dy = -r; dy <= r; dy += 1) for (let dz = -r; dz <= r; dz += 1) {
          const list = grid.get(key(cx + dx, cy + dy, cz + dz));
          if (!list) continue;
          for (const j of list) {
            const d = Math.hypot(b.pos[j * 3] - x, b.pos[j * 3 + 1] - y, b.pos[j * 3 + 2] - z);
            cands.push([j, d]);
            if (d < bd) bd = d;
          }
        }
      }
      if (bd === Infinity) {
        dists.push(Infinity);
        continue;
      }
      // Ties: every candidate within the quantization step of the nearest.
      const tie = bd + Math.max(diag * 4e-5, bd * 0.5);
      let best = -1;
      let bestScore = Infinity;
      for (const [j, d] of cands) {
        if (d > tie) continue;
        // Attribute agreement first; distance (≤ 1e-4 of the diagonal inside
        // the tie set) breaks exact-attribute twins.
        let score = d / diag;
        if (a.nor && b.nor) score += 1 - (a.nor[i * 3] * b.nor[j * 3] + a.nor[i * 3 + 1] * b.nor[j * 3 + 1] + a.nor[i * 3 + 2] * b.nor[j * 3 + 2]);
        if (a.uv && b.uv) for (let u = 0; u < a.uvCount * 2; u += 1) score += Math.abs(a.uv[i * a.uvCount * 2 + u] - b.uv[j * b.uvCount * 2 + u]);
        if (a.col && b.col) for (let k = 0; k < 4; k += 1) score += Math.abs(a.col[i * 4 + k] - b.col[j * 4 + k]);
        if (score < bestScore) {
          bestScore = score;
          best = j;
        }
      }
      dists.push(Math.hypot(b.pos[best * 3] - x, b.pos[best * 3 + 1] - y, b.pos[best * 3 + 2] - z) / H);
      if (a.nor && b.nor) {
        const dot = a.nor[i * 3] * b.nor[best * 3] + a.nor[i * 3 + 1] * b.nor[best * 3 + 1] + a.nor[i * 3 + 2] * b.nor[best * 3 + 2];
        angs.push((Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI);
      }
      if (a.uv && b.uv) for (let u = 0; u < a.uvCount * 2; u += 1) uvMax = Math.max(uvMax, Math.abs(a.uv[i * a.uvCount * 2 + u] - b.uv[best * b.uvCount * 2 + u]));
      if (a.col && b.col) for (let k = 0; k < 4; k += 1) {
        const ca = Math.min(1, Math.max(0, a.col[i * 4 + k]));
        const cb = Math.min(1, Math.max(0, b.col[best * 4 + k]));
        const e = k < 3 ? Math.abs(toSrgb(ca) - toSrgb(cb)) * 255 : Math.abs(ca - cb) * 255;
        colMax = Math.max(colMax, e);
      }
    }
  }
  const q = (arr, p) => {
    if (!arr.length) return null;
    const s = Float64Array.from(arr).sort();
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  return {
    heightUnits: H,
    positionFracH: { p999: q(dists, 0.999), max: q(dists, 1) },
    normalDeg: angs.length ? { p99: q(angs, 0.99), max: q(angs, 1) } : null,
    uvMax: A.some((p) => p.uv) ? uvMax : null,
    colourLevelsMax: A.some((p) => p.col) ? colMax : null,
  };
}

/** Animation parity per channel (keys compared index by index). */
export function animationParity(docA, docB) {
  const key = (ch) => `${ch.getTargetNode()?.getName()}|${ch.getTargetPath()}`;
  const res = { rotationDegMax: 0, translationRelMax: 0, scaleRelMax: 0, channels: 0, keyCountMismatch: 0, missingChannels: 0 };
  // A near-constant channel (span ~0) would turn a float-ulp change into a
  // huge ratio: spans are floored at 1e-3 of the file's largest span of that path.
  const largest = { translation: 0, scale: 0 };
  for (const an of docA.getRoot().listAnimations()) {
    for (const ch of an.listChannels()) {
      const path = ch.getTargetPath();
      if (!(path in largest)) continue;
      const o = ch.getSampler().getOutput();
      const x = [];
      for (let i = 0; i < o.getCount(); i += 1) {
        o.getElement(i, x);
        largest[path] = Math.max(largest[path], Math.hypot(x[0], x[1], x[2]));
      }
    }
  }
  for (const anA of docA.getRoot().listAnimations()) {
    const anB = docB.getRoot().listAnimations().find((x) => x.getName() === anA.getName());
    if (!anB) {
      res.missingChannels += anA.listChannels().length;
      continue;
    }
    const mapB = new Map(anB.listChannels().map((c) => [key(c), c]));
    for (const cA of anA.listChannels()) {
      const cB = mapB.get(key(cA));
      if (!cB) {
        res.missingChannels += 1;
        continue;
      }
      res.channels += 1;
      const oA = cA.getSampler().getOutput();
      const oB = cB.getSampler().getOutput();
      if (oA.getCount() !== oB.getCount()) res.keyCountMismatch += 1;
      const n = Math.min(oA.getCount(), oB.getCount());
      const x = [];
      const y = [];
      let span = 0;
      for (let i = 0; i < oA.getCount(); i += 1) {
        oA.getElement(i, x);
        span = Math.max(span, Math.hypot(x[0], x[1], x[2] ?? 0));
      }
      const path = cA.getTargetPath();
      if (path in largest) span = Math.max(span, largest[path] * 1e-3);
      for (let i = 0; i < n; i += 1) {
        oA.getElement(i, x);
        oB.getElement(i, y);
        if (path === 'rotation') {
          const d = Math.abs(x[0] * y[0] + x[1] * y[1] + x[2] * y[2] + x[3] * y[3]) / (Math.hypot(...x) * Math.hypot(...y) || 1);
          res.rotationDegMax = Math.max(res.rotationDegMax, (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI);
        } else if (path === 'translation') {
          res.translationRelMax = Math.max(res.translationRelMax, Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) / (span || 1));
        } else if (path === 'scale') {
          res.scaleRelMax = Math.max(res.scaleRelMax, Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) / (span || 1));
        }
      }
    }
  }
  return res;
}

/** Accessor-contract mismatches of B against the recipe table. */
export function formatParity(recipe, docA, bytesB) {
  const src = new Map();
  docA
    .getRoot()
    .listMeshes()
    .forEach((mesh, m) =>
      mesh.listPrimitives().forEach((prim, p) => {
        for (const s of prim.listSemantics()) src.set(`${m}/${p}/${s}`, describeSourceAccessor(prim.getAttribute(s)));
      }),
    );
  const mismatches = [];
  const keptFloat = new Set();
  const indicesMode = indexModeOf(recipe) === 'indices';
  for (const row of glbAccessorFormats(bytesB)) {
    if (row.semantic === 'indices') {
      // An index-exact recipe writes no TRIANGLES-mode index view (the triangle codec rotates corners).
      if (indicesMode && row.mode === 'TRIANGLES') mismatches.push({ semantic: 'indices', at: `${row.mesh}/${row.prim}`, want: 'INDICES', got: row.mode });
      continue;
    }
    // A zero-filled accessor (no bufferView) carries no data to compress.
    if (!row.hasBufferView) continue;
    if (row.semantic.startsWith('output:')) {
      const want = expectedAnimationFilter(recipe, row.semantic.slice(7));
      if (row.filter !== want) mismatches.push({ semantic: row.semantic, want, got: row.filter });
      continue;
    }
    const source = src.get(`${row.mesh}/${row.prim}/${row.semantic}`);
    if (!source) {
      mismatches.push({ semantic: row.semantic, at: `${row.mesh}/${row.prim}`, want: 'present in A', got: 'new' });
      continue;
    }
    const want = expectedAttributeFormat(recipe, row.semantic, source);
    const got = { componentType: row.componentType, normalized: row.normalized, filter: row.filter };
    if (got.componentType !== want.componentType || got.normalized !== want.normalized || got.filter !== want.filter) {
      mismatches.push({ semantic: row.semantic, at: `${row.mesh}/${row.prim}`, want, got });
    }
    if (row.componentType === 5126 && RECIPES[recipe].bits && /^TEXCOORD/.test(row.semantic)) keptFloat.add(row.semantic);
  }
  return { mismatches, keptFloat: [...keptFloat] };
}

/**
 * Index buffers A vs B, primitive by primitive (mesh order): `indexed`
 * primitives with indices on either side, `exact` those whose decoded index
 * arrays have the same component type and the same bytes.
 */
export function indexParity(docA, docB) {
  const prims = (doc) => doc.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives());
  const a = prims(docA);
  const b = prims(docB);
  const bytes = (accessor) => {
    const array = accessor.getArray();
    return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  };
  let indexed = 0;
  let exact = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const ia = a[i]?.getIndices() ?? null;
    const ib = b[i]?.getIndices() ?? null;
    if (!ia && !ib) continue;
    indexed += 1;
    if (ia && ib && ia.getComponentType() === ib.getComponentType() && Buffer.compare(bytes(ia), bytes(ib)) === 0) exact += 1;
  }
  return { indexed, exact };
}

async function validatorCodes(bytes) {
  const validator = require('gltf-validator');
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 1000, writeTimestamp: false });
  return [...new Set(report.issues.messages.filter((msg) => msg.severity === 0).map((msg) => msg.code))].sort();
}

/** The A0 verdict of one file pair. */
export function a0Verdict(row) {
  const fails = [];
  for (const k of ['triangles', 'meshes', 'primitives', 'materials', 'skins', 'joints', 'nodes', 'textures']) {
    if (row.structure.a[k] !== row.structure.b[k]) fails.push(`${k} ${row.structure.a[k]}→${row.structure.b[k]}`);
  }
  if (JSON.stringify(row.structure.a.clips) !== JSON.stringify(row.structure.b.clips)) fails.push('clips');
  if (row.format.mismatches.length) fails.push(`format×${row.format.mismatches.length}`);
  const badCodes = row.validator.b.filter((c) => !c.startsWith('SKIN_') || !row.validator.a.includes(c));
  if (badCodes.length) fails.push(`validator ${badCodes.join('/')}`);
  const g = row.geometry;
  if (g.error) fails.push(g.error);
  else {
    if (g.positionFracH.p999 > A0.positionP999FracH) fails.push(`pos p99.9 ${g.positionFracH.p999.toExponential(2)}H`);
    if (g.positionFracH.max * A0.closeUpPx > A0.positionMaxPx) fails.push(`pos max ${(g.positionFracH.max * A0.closeUpPx).toFixed(2)}px`);
    if (g.normalDeg && g.normalDeg.p99 > A0.normalP99Deg) fails.push(`normal p99 ${g.normalDeg.p99.toFixed(3)}°`);
    if (g.uvMax !== null && g.uvMax > A0.uvMax * 1.0001) fails.push(`uv ${g.uvMax.toExponential(2)}`);
    if (g.colourLevelsMax !== null && g.colourLevelsMax > A0.colourLevels) fails.push(`colour ${g.colourLevelsMax.toFixed(2)} levels`);
  }
  const an = row.animation;
  if (an.rotationDegMax > A0.rotationDeg) fails.push(`rot ${an.rotationDegMax.toFixed(4)}°`);
  if (an.translationRelMax > A0.translationRel) fails.push(`trans ${an.translationRelMax.toExponential(2)}`);
  if (an.scaleRelMax > A0.translationRel) fails.push(`scale ${an.scaleRelMax.toExponential(2)}`);
  if (an.keyCountMismatch || an.missingChannels) fails.push('animation keys/channels');
  if (row.indices?.required && row.indices.exact !== row.indices.indexed) fails.push(`indices ${row.indices.exact}/${row.indices.indexed} exact`);
  if (row.merge) {
    if (row.merge.b.after > row.merge.a.after) fails.push(`merge ${row.merge.a.after}→${row.merge.b.after}`);
    if (row.merge.portA !== row.merge.a.after || row.merge.portB !== row.merge.b.after) fails.push(`drawParts port ${row.merge.portA}/${row.merge.portB} vs ${row.merge.a.after}/${row.merge.b.after}`);
  }
  return fails;
}

/** Everything A0 measures on one file. */
export async function compareFile({ recipe, src, arm, rel, overlay = null, kit = null }) {
  const io = await createWorldIO({ quiet: true });
  // A decimated outlier is compared with its decimation intermediate (A1 covers A → intermediate).
  const fromOverlay = Boolean(overlay && existsSync(join(overlay, rel)));
  const bytesA = readFileSync(fromOverlay ? join(overlay, rel) : join(src, rel));
  const bytesB = readFileSync(join(arm, rel));
  const docA = await io.readBinary(new Uint8Array(bytesA));
  const docB = await io.readBinary(new Uint8Array(bytesB));
  const row = {
    file: rel,
    recipe,
    against: fromOverlay ? 'decimated intermediate' : 'A',
    bytesA: bytesA.length,
    bytesB: bytesB.length,
    structure: { a: structure(docA), b: structure(docB) },
    format: formatParity(recipe, docA, bytesB),
    validator: { a: await validatorCodes(bytesA), b: await validatorCodes(bytesB) },
    geometry: geometryParity(docA, docB),
    animation: animationParity(docA, docB),
    indices: { ...indexParity(docA, docB), required: indexExact(recipe) },
  };
  if (kit) {
    const ga = await threeParse(kit, bytesA);
    const gb = await threeParse(kit, bytesB);
    row.merge = { a: mergeCount(kit, ga), b: mergeCount(kit, gb), portA: drawPartsFromDocument(docA), portB: drawPartsFromDocument(docB) };
  }
  row.fails = a0Verdict(row);
  return row;
}

// ── Loader parity (three-stdlib GLTFLoader, A vs B) ─────────────────────────

/** Sampled clip state of one parsed GLB: per clip, per t in {0, ⅓, ⅔}: bone world matrices and the posed AABB. */
export function sampleClips(kit, gltf) {
  const { THREE } = kit;
  const scene = gltf.scene;
  const out = {};
  const clips = gltf.animations.length ? gltf.animations : [null];
  for (const clip of clips) {
    const mixer = new THREE.AnimationMixer(scene);
    const action = clip ? mixer.clipAction(clip) : null;
    action?.play();
    const samples = [];
    for (const f of [0, 1 / 3, 2 / 3]) {
      const t = clip ? clip.duration * f : 0;
      mixer.setTime(t);
      scene.updateMatrixWorld(true);
      const bones = [];
      const box = new THREE.Box3();
      scene.traverse((o) => {
        if (o.isBone) bones.push({ name: o.name, m: o.matrixWorld.elements.slice() });
        if (o.isSkinnedMesh) {
          o.skeleton.update();
          o.computeBoundingBox();
          box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
        } else if (o.isMesh) {
          o.geometry.computeBoundingBox();
          box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
        }
      });
      const tracks = clip ? clip.tracks.map((tr) => ({ name: tr.name, v: Array.from(tr.createInterpolant().evaluate(t)) })) : [];
      samples.push({ t, bones, box: [box.min.toArray(), box.max.toArray()], tracks });
    }
    action?.stop();
    mixer.uncacheRoot(scene);
    out[clip ? clip.name : '(rest)'] = samples;
  }
  return out;
}

export async function loaderParity(kit, bytesA, bytesB) {
  const sa = sampleClips(kit, await threeParse(kit, bytesA));
  const sb = sampleClips(kit, await threeParse(kit, bytesB));
  let boneMax = 0;
  let boxMaxRel = 0;
  let trackRotDeg = 0;
  let trackRel = 0;
  let extent = 0;
  for (const [clip, samples] of Object.entries(sa)) {
    const other = sb[clip];
    if (!other) return { error: `clip ${clip} missing in B` };
    samples.forEach((s, i) => {
      const o = other[i];
      const e = Math.max(...[0, 1, 2].map((k) => s.box[1][k] - s.box[0][k]));
      extent = Math.max(extent, e);
      for (let k = 0; k < 3; k += 1) {
        boxMaxRel = Math.max(boxMaxRel, Math.abs(s.box[0][k] - o.box[0][k]) / (e || 1), Math.abs(s.box[1][k] - o.box[1][k]) / (e || 1));
      }
      const byName = new Map(o.bones.map((b) => [b.name, b.m]));
      for (const b of s.bones) {
        const m = byName.get(b.name);
        if (!m) continue;
        for (let k = 0; k < 16; k += 1) {
          const scale = k >= 12 && k < 15 ? e || 1 : 1;
          boneMax = Math.max(boneMax, Math.abs(b.m[k] - m[k]) / scale);
        }
      }
      const tracksB = new Map(o.tracks.map((t) => [t.name, t.v]));
      for (const tr of s.tracks) {
        const v = tracksB.get(tr.name);
        if (!v) continue;
        if (tr.name.endsWith('.quaternion')) {
          const d = Math.abs(tr.v[0] * v[0] + tr.v[1] * v[1] + tr.v[2] * v[2] + tr.v[3] * v[3]) / (Math.hypot(...tr.v) * Math.hypot(...v) || 1);
          trackRotDeg = Math.max(trackRotDeg, (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI);
        } else {
          const span = Math.hypot(...tr.v) || 1;
          trackRel = Math.max(trackRel, Math.hypot(...tr.v.map((x, k) => x - v[k])) / span);
        }
      }
    });
  }
  return {
    clips: Object.keys(sa),
    boneMatrixMaxDiff: boneMax,
    posedAabbMaxRel: boxMaxRel,
    trackRotationDegMax: trackRotDeg,
    trackOtherRelMax: trackRel,
    pass: boneMax <= 1e-3 && boxMaxRel <= 1e-3 && trackRotDeg <= A0.rotationDeg && trackRel <= A0.translationRel,
  };
}

/** The automatic loader-parity pick (see header) from A's documents. */
export async function pickLoaderFiles(src, files) {
  const io = await createWorldIO({ quiet: true });
  const skinned = [];
  const blend = [];
  for (const rel of files) {
    const json = glbJson(readFileSync(join(src, rel)));
    const joints = Math.max(0, ...(json.skins ?? []).map((s) => s.joints.length));
    const clips = (json.animations ?? []).length;
    if (joints && clips) skinned.push({ rel, joints });
    if ((json.materials ?? []).some((m) => m.alphaMode === 'BLEND')) blend.push({ rel, skinned: joints > 0, clips });
  }
  void io;
  skinned.sort((a, b) => b.joints - a.joints);
  const big = skinned.find((s) => s.joints >= 100);
  const mid = skinned[Math.floor(skinned.length / 2)];
  blend.sort((a, b) => Number(b.skinned) - Number(a.skinned) || b.clips - a.clips || a.rel.localeCompare(b.rel));
  const pick = [big?.rel, mid?.rel, blend[0]?.rel, blend[1]?.rel, files.find((f) => f.endsWith('regular/930.glb'))].filter(Boolean);
  return [...new Set(pick)];
}

// ── Pool + CLI ──────────────────────────────────────────────────────────────

if (!isMainThread && workerData?.d42ParityWorker) {
  process.env.D42_WORKER = String(workerData.id);
  parentPort.on('message', async (job) => {
    try {
      const kit = job.merge ? await loadThreeKit() : null;
      parentPort.postMessage({ ok: true, row: await compareFile({ ...job, kit }) });
    } catch (error) {
      parentPort.postMessage({ ok: false, file: job.rel, error: String(error?.stack ?? error).slice(0, 2000) });
    }
  });
}

async function runPool(jobs, size) {
  const rows = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(size, jobs.length) }, (_, id) => new Worker(fileURLToPath(import.meta.url), { workerData: { d42ParityWorker: true, id } }));
  await Promise.all(
    workers.map(
      (worker) =>
        new Promise((done) => {
          const feed = () => {
            if (next >= jobs.length) {
              worker.terminate().then(done, done);
              return;
            }
            worker.postMessage(jobs[next]);
            next += 1;
          };
          worker.on('message', (msg) => {
            rows.push(msg.ok ? msg.row : { file: msg.file, error: msg.error, fails: ['error'] });
            if (rows.length % 50 === 0) console.log(`  ${rows.length}/${jobs.length}`);
            feed();
          });
          worker.on('error', (error) => {
            rows.push({ file: '?', error: String(error), fails: ['worker error'] });
            feed();
          });
          feed();
        }),
    ),
  );
  return rows.sort((a, b) => a.file.localeCompare(b.file));
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export async function runA0({ recipe, src, arm, overlay = null, jobs = 12, only = null, loaderFiles = null, merge = true }) {
  const files = encodableFiles(src).filter((rel) => !only || rel.includes(only));
  // Per-file recipes (`compress-mirror --recipe-for`) come from the arm's encode report.
  const encodeReport = existsSync(join(arm, '_encode.json')) ? JSON.parse(readFileSync(join(arm, '_encode.json'), 'utf8')) : null;
  const recipeOf = new Map((encodeReport?.files ?? []).map((row) => [row.file, row.recipe ?? recipe]));
  const rows = await runPool(
    files.map((rel) => ({ recipe: recipeOf.get(rel) ?? recipe, src, arm, rel, overlay, merge })),
    jobs,
  );
  // env byte-identical
  const envFiles = walkFiles(join(src, 'env')).map((f) => relPosix(src, f));
  const envDiff = envFiles.filter((rel) => !existsSync(join(arm, rel)) || sha256File(join(src, rel)) !== sha256File(join(arm, rel)));
  // loader parity
  const kit = await loadThreeKit();
  const picks = loaderFiles ?? (await pickLoaderFiles(src, files));
  const loader = [];
  for (const rel of picks) {
    const srcFile = overlay && existsSync(join(overlay, rel)) ? join(overlay, rel) : join(src, rel);
    const res = await loaderParity(kit, readFileSync(srcFile), readFileSync(join(arm, rel)));
    loader.push({ file: rel, ...res });
  }
  const failing = rows.filter((r) => r.fails.length);
  const failCounts = {};
  for (const r of failing) for (const f of r.fails) {
    const k = f.split(' ')[0].replace(/×\d+$/, '');
    failCounts[k] = (failCounts[k] ?? 0) + 1;
  }
  const max = (pick) => rows.reduce((m, r) => Math.max(m, pick(r) ?? 0), 0);
  const summary = {
    recipe,
    recipeFor: Object.fromEntries(rows.filter((r) => r.recipe && r.recipe !== recipe).map((r) => [r.file, r.recipe])),
    against: { A: rows.filter((r) => r.against === 'A').length, decimated: rows.filter((r) => r.against === 'decimated intermediate').map((r) => r.file) },
    files: rows.length,
    pass: rows.length - failing.length,
    fail: failing.length,
    failCounts,
    indices: {
      required: rows.filter((r) => r.indices?.required).length,
      filesExact: rows.filter((r) => r.indices && r.indices.exact === r.indices.indexed).length,
      primitives: rows.reduce((s, r) => s + (r.indices?.indexed ?? 0), 0),
      exact: rows.reduce((s, r) => s + (r.indices?.exact ?? 0), 0),
    },
    envFiles: envFiles.length,
    envDifferent: envDiff.length,
    loader: loader.map((l) => ({ file: l.file, pass: l.pass, bone: l.boneMatrixMaxDiff, aabb: l.posedAabbMaxRel, rotDeg: l.trackRotationDegMax })),
    worst: {
      positionP999FracH: max((r) => r.geometry?.positionFracH?.p999),
      positionMaxPx: max((r) => (r.geometry?.positionFracH?.max ?? 0) * A0.closeUpPx),
      normalP99Deg: max((r) => r.geometry?.normalDeg?.p99),
      normalMaxDeg: max((r) => r.geometry?.normalDeg?.max),
      uvMax: max((r) => r.geometry?.uvMax),
      colourLevelsMax: max((r) => r.geometry?.colourLevelsMax),
      rotationDegMax: max((r) => r.animation?.rotationDegMax),
      translationRelMax: max((r) => r.animation?.translationRelMax),
    },
    merge: {
      equal: rows.filter((r) => r.merge && r.merge.a.after === r.merge.b.after).length,
      decreased: rows.filter((r) => r.merge && r.merge.b.after < r.merge.a.after).map((r) => `${r.file} ${r.merge.a.after}→${r.merge.b.after}`),
      increased: rows.filter((r) => r.merge && r.merge.b.after > r.merge.a.after).map((r) => `${r.file} ${r.merge.a.after}→${r.merge.b.after}`),
      portMismatch: rows.filter((r) => r.merge && (r.merge.portA !== r.merge.a.after || r.merge.portB !== r.merge.b.after)).map((r) => r.file),
      consolidateSource: kit.consolidateSource,
    },
  };
  return { stamp: encoderStamp({ step: 'A0', recipe, bars: A0 }), summary, loader, envDiff, rows };
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

if (isMainThread && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const recipe = arg(argv, '--recipe');
  const src = arg(argv, '--src');
  const arm = arg(argv, '--arm');
  if (!recipe || !src || !arm) {
    console.error('usage: d42-parity.mjs --recipe <hq10|high8|medium|nq|nqx> --src <mirror A> --arm <arm dir> [--report <json>] [--jobs n] [--only s] [--loader a,b]');
    process.exit(2);
  }
  const loaderArg = arg(argv, '--loader');
  runA0({
    recipe,
    src,
    arm,
    overlay: arg(argv, '--overlay'),
    jobs: Number(arg(argv, '--jobs') ?? Math.max(1, Math.min(14, availableParallelism() - 4))),
    only: arg(argv, '--only'),
    loaderFiles: loaderArg ? loaderArg.split(',') : null,
    merge: !argv.includes('--no-merge'),
  })
    .then((report) => {
      const out = arg(argv, '--report') ?? join(arm, '_a0.json');
      writeFileSync(out, JSON.stringify(report, null, 1));
      console.log(JSON.stringify(report.summary, null, 1));
      console.log(`report → ${out}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
