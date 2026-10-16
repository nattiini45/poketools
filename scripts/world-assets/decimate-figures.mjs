#!/usr/bin/env node
/**
 * D42 step A1: decimate the 13 static outliers over 40 k triangles to about
 * 36 k (ENGINE-ASSET-PLAN §4 SEAT ASSET step 3, §5 A1; LD5).
 *
 * Per file: ratio = 36 000 / triangles, i.e. a per-primitive target of
 * round(36 000 × the primitive's share). The simplifier is meshoptimizer's
 * `simplifyWithAttributes` (the pinned 1.2.0, `meshopt-codec.mjs`) after a
 * weld, with weights on NORMAL (when present), EVERY TEXCOORD_n and COLOR_0;
 * `error` starts small and escalates only while the target is not reached.
 *
 * Templates (file paths, D18; never species):
 *  - `seam-lock` (the textured files): `vertex_lock` on UV-seam vertices
 *    (one position, two or more UVs) and on positions shared with another
 *    primitive; `LockBorder` keeps open borders; never Permissive. Should
 *    the locks make the target unreachable at the largest error, the file
 *    falls back to `seam-aware` (meshoptimizer's own seam preservation, the
 *    explicit UV lock dropped) and the report says so.
 *  - `permissive-color` (vertex-colour files): Permissive, COLOR_0 weighted
 *    at 4 per channel (S0: weight 4 cut 907's vertices off by > 24 sRGB
 *    levels from 391 to 250 at +0.2 px Hausdorff; the painted look lives in
 *    the vertex colour). `color-seam-lock` (colour seams locked, no
 *    Permissive) is available for a re-encode.
 *  - `permissive-normal` (no UV): Permissive, NORMAL weighted.
 *
 * The output keeps every primitive's attribute set and accessor storage
 * (weld and compaction never change a component type), so it is mirror A's
 * ENCODING of the decimated geometry: its size is the file's `castKb`
 * (`cast-kb.json`). No texture is touched (texture sha256 is checked), no
 * NORMAL is added (930 is unlit and has none), no `textureCompress`.
 *
 * A1 is measured here, per file, against the original:
 *  - symmetric Hausdorff (original vertices + centroids → decimated surface
 *    and back), in mm at the figure's real height and in px at
 *    px/m = max(the largest ace px/m any teams formation gives it on the
 *    StatueRow / AcesLine / CairnCircle sites, desktop 900 / tablet 1024 /
 *    landed 390 × 844 heights, 844 px / height). The formation is bundled
 *    from the worktree's src with esbuild (pure modules), so colossal set-back
 *    and the frozen cameras are the shipped ones;
 *  - attribute set per primitive, texture sha256, validator codes, bounds
 *    deviation, and the colour transfer error for vertex-colour files.
 *
 * Escalation (plan §5 A1, "a FAIL raises the triangle target up to 40 k"):
 * targets 36 k → 40 k in 1 k steps at the default normal weight 0.5, then the
 * same ladder at normal weights 0.25 and 0.1; the first attempt inside every
 * A1 geometry bar is written. None → Q6 (the file keeps its geometry).
 *
 * `--target-triangles <n>` (plan §5 G2, "any FAIL raises the triangle target
 * (up to 40 k)"): the file's target, default 36 000, at most 40 000. The
 * ladder starts there and climbs in 1 k steps to 40 k (40 000 → [40 000]);
 * per-primitive targets scale by share and every other rule is unchanged.
 *
 * `--weld-only` (plan §5 G0, "a weld-only calibration arm on the 13"): the
 * same per-file pipeline (the 13 files, weld, the per-primitive index write
 * and `compactPrimitive`, the accessor prune, the A encoding, every A1
 * measure) with `MeshoptSimplifier` skipped, so that A vs weld-only measures
 * weld + encoding and weld-only vs d42 measures the simplification alone.
 * One pass per file (the target and normal-weight ladders exist only for the
 * simplifier); the report records ratio 1, triangles in / out, and flags any
 * triangle-count change: weld may only drop degenerate (zero-area)
 * triangles, and the report says how many it did.
 *
 * Usage:
 *   node scripts/world-assets/decimate-figures.mjs --src <mirror A> --out <scratch dir>
 *     [--only models/regular/907.glb]   (then --merge --out <dir> after per-file runs)
 *     [--weld-only]                     (the G0 calibration arm; --merge --weld-only to merge)
 *     [--target-triangles 40000]        (the G2 loop: the target the ladder starts at; default 36000)
 * Writes <out>/<file> (A encoding), <out>/cast-kb.json and <out>/a1-report.json
 * (`weld-report.json` under --weld-only). An --out equal to --src is refused
 * before anything is read (mirror A is gitignored; git cannot restore it).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getBounds } from '@gltf-transform/core';
import { compactPrimitive, prune, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier, createWorldIO, encoderStamp } from './meshopt-codec.mjs';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

/** The 13 static outliers over 40 k triangles (plan §2.1), by file path. */
export const OUTLIERS = [
  { file: 'models/regular/907.glb', template: 'permissive-color', weights: { color: 4 } },
  { file: 'models/regular/110.glb', template: 'seam-lock' },
  { file: 'models/regular/913.glb', template: 'permissive-color', weights: { color: 4 } },
  { file: 'models/regular/763.glb', template: 'seam-lock' },
  { file: 'models/regular/161.glb', template: 'seam-lock' },
  { file: 'models/hisuian/503.glb', template: 'seam-lock' },
  { file: 'models/regular/328.glb', template: 'permissive-normal' },
  { file: 'models/regular/930.glb', template: 'seam-lock' },
  { file: 'models/regular/131.glb', template: 'seam-lock' },
  { file: 'models/regular/928.glb', template: 'seam-lock' },
  { file: 'models/regular/906.glb', template: 'seam-lock' },
  { file: 'models/regular/813.glb', template: 'seam-lock' },
  { file: 'models/regular/109.glb', template: 'seam-lock', blendOrder: true },
];

export const TARGET_TRIANGLES = 36000;
export const HARD_TRIANGLES = 40000;
/** The A1 px ceilings (plan §5): symmetric max ≤ 2 px, p99.9 ≤ 1 px. */
export const A1_MAX_PX = 2;
export const A1_P999_PX = 1;
/** Bounds may move ≤ 0.1 % of the original extent. */
export const A1_BOUNDS_FRACTION = 0.001;
/** The landed 390 × 844 frame: a figure filling the phone's height. */
export const CLOSE_UP_PX = 844;

/** meshoptimizer `error` ladder (relative to the mesh extent). */
export const ERROR_LADDER = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1];

/** Attribute weights (per component) handed to `simplifyWithAttributes`. */
export const WEIGHTS = { normal: 0.5, texcoord: 1.0, color: 1.0 };

export function countTriangles(document) {
  let t = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      t += Math.floor((idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3);
    }
  }
  return t;
}

/** Per-primitive attribute signature: semantic → componentType/normalized/type. */
export function attributeSignature(document) {
  return document
    .getRoot()
    .listMeshes()
    .flatMap((mesh) =>
      mesh.listPrimitives().map((prim) =>
        prim
          .listSemantics()
          .sort()
          .map((s) => {
            const a = prim.getAttribute(s);
            return `${s}:${a.getComponentType()}${a.getNormalized() ? 'n' : ''}:${a.getType()}`;
          })
          .join(','),
      ),
    );
}

/** sha256 of every texture image, in document order. */
export function textureHashes(document) {
  return document
    .getRoot()
    .listTextures()
    .map((t) => createHash('sha256').update(t.getImage() ?? new Uint8Array()).digest('hex'));
}

function floatKey(x, y, z) {
  return `${Math.fround(x)},${Math.fround(y)},${Math.fround(z)}`;
}

/**
 * Degenerate (zero-area) triangles of a document: two corners share an index
 * or a bitwise-equal position. The only triangles a weld may drop.
 */
export function degenerateTriangles(document) {
  let count = 0;
  const a = [];
  const b = [];
  const c = [];
  const same = (p, q) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2];
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      for (let t = 0; t + 2 < n; t += 3) {
        const i = idx ? idx.getScalar(t) : t;
        const j = idx ? idx.getScalar(t + 1) : t + 1;
        const k = idx ? idx.getScalar(t + 2) : t + 2;
        if (i === j || j === k || i === k) {
          count += 1;
          continue;
        }
        pos.getElement(i, a);
        pos.getElement(j, b);
        pos.getElement(k, c);
        if (same(a, b) || same(b, c) || same(a, c)) count += 1;
      }
    }
  }
  return count;
}

/**
 * meshoptimizer's `simplifyWithAttributes` on one primitive's indices (the
 * simplification step proper): attribute weights, the template's locks and
 * flags, the `error` ladder. Returns the new indices and what was reached.
 */
function meshoptSimplify(prim, indices, targetIndices, { template, lockPositions, uvLock, weights: w }) {
  const pos = prim.getAttribute('POSITION');
  const n = pos.getCount();
  const positions = new Float32Array(n * 3);
  const el = [];
  for (let i = 0; i < n; i += 1) {
    pos.getElement(i, el);
    positions[i * 3] = el[0];
    positions[i * 3 + 1] = el[1];
    positions[i * 3 + 2] = el[2];
  }
  const channels = [];
  const normal = prim.getAttribute('NORMAL');
  if (normal) channels.push({ accessor: normal, size: 3, weight: w.normal });
  const texcoords = prim.listSemantics().filter((s) => /^TEXCOORD_\d+$/.test(s));
  for (const s of texcoords) channels.push({ accessor: prim.getAttribute(s), size: 2, weight: w.texcoord, uv: true });
  const color = prim.getAttribute('COLOR_0');
  if (color) channels.push({ accessor: color, size: color.getElementSize(), weight: w.color });
  const stride = channels.reduce((s, c) => s + c.size, 0);
  const attrs = new Float32Array(Math.max(1, n * stride));
  const weights = [];
  for (const c of channels) for (let k = 0; k < c.size; k += 1) weights.push(c.weight);
  let off = 0;
  for (const c of channels) {
    for (let i = 0; i < n; i += 1) {
      c.accessor.getElement(i, el);
      for (let k = 0; k < c.size; k += 1) attrs[i * stride + off + k] = el[k];
    }
    off += c.size;
  }
  // Locks: positions shared with another primitive; UV seams (seam-lock).
  const lock = new Uint8Array(n);
  let uvSeamVertices = 0;
  const byPos = new Map();
  for (let i = 0; i < n; i += 1) {
    const key = floatKey(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    if (lockPositions.has(key)) lock[i] = 1;
    const list = byPos.get(key);
    if (list) list.push(i);
    else byPos.set(key, [i]);
  }
  // seam-lock locks UV seams; color-seam-lock locks vertex-colour seams.
  const seamChannels =
    template === 'seam-lock' ? channels.filter((c) => c.uv) : template === 'color-seam-lock' ? channels.filter((c) => c.accessor === color) : [];
  if (uvLock && seamChannels.length) {
    for (const list of byPos.values()) {
      if (list.length < 2) continue;
      const seen = new Set();
      for (const i of list) {
        const parts = [];
        for (const c of seamChannels) {
          c.accessor.getElement(i, el);
          for (let k = 0; k < c.size; k += 1) parts.push(el[k]);
        }
        seen.add(parts.join(','));
      }
      if (seen.size > 1) {
        for (const i of list) lock[i] = 1;
        uvSeamVertices += list.length;
      }
    }
  }
  const flags = template === 'seam-lock' || template === 'color-seam-lock' ? ['LockBorder'] : ['Permissive'];
  let result = null;
  let used = null;
  for (const error of ERROR_LADDER) {
    const [out, achieved] = MeshoptSimplifier.simplifyWithAttributes(
      indices,
      positions,
      3,
      attrs,
      Math.max(1, stride),
      stride ? weights : [0],
      lock,
      targetIndices,
      error,
      flags,
    );
    result = out;
    used = { error, achieved };
    if (out.length <= targetIndices) break;
  }
  return { result, errorCap: used.error, errorAchieved: used.achieved, lockedVertices: lock.reduce((s, v) => s + v, 0), uvSeamVertices, flags };
}

/** What a skipped simplifier "reached" (`simplify: false`, the weld-only arm): the indices as they are. */
function unsimplified(indices) {
  return { result: indices, errorCap: null, errorAchieved: 0, lockedVertices: 0, uvSeamVertices: 0, flags: [] };
}

/**
 * Simplify one primitive in place. `lockPositions` holds position keys locked
 * from outside (shared with another primitive). Returns what was reached.
 * `simplify: false` (--weld-only) skips meshoptimizer: the indices are
 * written back and the primitive compacted exactly as after a simplification.
 */
export function simplifyPrimitive(prim, { targetTriangles, template, lockPositions = new Set(), uvLock = true, weights = WEIGHTS, simplify = true }) {
  const idx = prim.getIndices();
  const n = prim.getAttribute('POSITION').getCount();
  const indices = Uint32Array.from(idx.getArray());
  const targetIndices = Math.max(3, Math.round(targetTriangles) * 3);
  const reached = simplify ? meshoptSimplify(prim, indices, targetIndices, { template, lockPositions, uvLock, weights }) : unsimplified(indices);
  const { result } = reached;
  const IndexArray = n <= 65535 ? Uint16Array : Uint32Array;
  idx.setArray(IndexArray === Uint16Array ? Uint16Array.from(result) : result);
  compactPrimitive(prim);
  return {
    trianglesBefore: indices.length / 3,
    trianglesAfter: result.length / 3,
    target: targetIndices / 3,
    reached: result.length <= targetIndices,
    errorCap: reached.errorCap,
    errorAchieved: reached.errorAchieved,
    lockedVertices: reached.lockedVertices,
    uvSeamVertices: reached.uvSeamVertices,
    flags: reached.flags,
  };
}

/** Positions (local, exact float keys) that occur in more than one primitive. */
function crossPrimitivePositions(document) {
  const owner = new Map();
  const shared = new Set();
  let primId = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const el = [];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, el);
        const key = floatKey(el[0], el[1], el[2]);
        const was = owner.get(key);
        if (was === undefined) owner.set(key, primId);
        else if (was !== primId) shared.add(key);
      }
      primId += 1;
    }
  }
  return shared;
}

/**
 * Decimate a static document in place to ≈ `target` triangles (per-primitive
 * shares). Refuses skinned or animated documents. `simplify: false` is the
 * weld-only calibration arm: the same weld, index write, compaction and prune
 * with the simplifier skipped (no target, ratio 1, never a no-op).
 */
export async function decimateDocument(document, { target = TARGET_TRIANGLES, template = 'seam-lock', weights = WEIGHTS, simplify = true } = {}) {
  const root = document.getRoot();
  if (root.listSkins().length || root.listAnimations().length) throw new Error('decimate-figures: static figures only (skins or clips found)');
  await MeshoptSimplifier.ready;
  const before = countTriangles(document);
  if (simplify && before <= target) return { trianglesBefore: before, trianglesAfter: before, ratio: 1, template, primitives: [] };
  await document.transform(weld());
  const lockPositions = crossPrimitivePositions(document);
  const ratio = simplify ? target / before : 1;
  const prims = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
  const snapshot = async () => prims.map((prim) => ({ indices: prim.getIndices().clone(), attrs: prim.listSemantics().map((s) => [s, prim.getAttribute(s).clone()]) }));
  const saved = await snapshot();
  const run = (uvLock) =>
    prims.map((prim) => {
      const share = prim.getIndices().getCount() / 3;
      return simplifyPrimitive(prim, { targetTriangles: share * ratio, template, lockPositions, uvLock, weights, simplify });
    });
  let primitives = run(true);
  let used = simplify ? template : 'weld-only';
  if (simplify && (template === 'seam-lock' || template === 'color-seam-lock') && primitives.some((p) => !p.reached)) {
    // Restore and retry without the explicit UV-seam lock (seam-aware).
    prims.forEach((prim, i) => {
      prim.setIndices(saved[i].indices);
      for (const [s, a] of saved[i].attrs) prim.setAttribute(s, a);
    });
    primitives = run(false);
    used = 'seam-aware';
  }
  await document.transform(prune({ propertyTypes: ['Accessor'], keepAttributes: true, keepIndices: true, keepLeaves: true }));
  const after = countTriangles(document);
  return { trianglesBefore: before, trianglesAfter: after, ratio: +ratio.toFixed(4), template: used, primitives };
}

// ── Geometry measurement (A1) ───────────────────────────────────────────────

/** World-space triangle soup (static figures): positions, indices, optional per-vertex colour. */
export function triangleSoup(document) {
  const positions = [];
  const colors = [];
  const tris = [];
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  let hasColor = false;
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const col = prim.getAttribute('COLOR_0');
      if (col) hasColor = true;
      const base = positions.length / 3;
      const el = [];
      const ce = [];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, el);
        positions.push(
          m[0] * el[0] + m[4] * el[1] + m[8] * el[2] + m[12],
          m[1] * el[0] + m[5] * el[1] + m[9] * el[2] + m[13],
          m[2] * el[0] + m[6] * el[1] + m[10] * el[2] + m[14],
        );
        if (col) {
          col.getElement(i, ce);
          colors.push(ce[0], ce[1], ce[2]);
        } else colors.push(NaN, NaN, NaN);
      }
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i < count; i += 1) tris.push(base + (idx ? idx.getScalar(i) : i));
    }
  });
  return { positions: Float64Array.from(positions), tris: Uint32Array.from(tris), colors: hasColor ? Float64Array.from(colors) : null };
}

/** Closest point on triangle (Ericson 5.1.5): returns [x, y, z, u, v, w] (barycentrics). */
function closest(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return [ax, ay, az, 1, 0, 0];
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return [bx, by, bz, 0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [ax + abx * v, ay + aby * v, az + abz * v, 1 - v, v, 0];
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return [cx, cy, cz, 0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [ax + acx * w, ay + acy * w, az + acz * w, 1 - w, 0, w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w, 0, 1 - w, w];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w, 1 - v - w, v, w];
}

/** A uniform grid over a soup's triangles for closest-point queries. */
export function surfaceIndex(soup) {
  const P = soup.positions;
  const T = soup.tris;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      lo[k] = Math.min(lo[k], P[i + k]);
      hi[k] = Math.max(hi[k], P[i + k]);
    }
  }
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const nt = T.length / 3;
  const cells = Math.max(8, Math.min(160, Math.round(Math.cbrt(nt) * 1.5)));
  const cell = extent / cells;
  const grid = new Map();
  const ci = (v, k) => Math.floor((v - lo[k]) / cell);
  for (let t = 0; t < T.length; t += 3) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let j = 0; j < 3; j += 1) {
      const p = T[t + j] * 3;
      x0 = Math.min(x0, P[p]); x1 = Math.max(x1, P[p]);
      y0 = Math.min(y0, P[p + 1]); y1 = Math.max(y1, P[p + 1]);
      z0 = Math.min(z0, P[p + 2]); z1 = Math.max(z1, P[p + 2]);
    }
    for (let x = ci(x0, 0); x <= ci(x1, 0); x += 1)
      for (let y = ci(y0, 1); y <= ci(y1, 1); y += 1)
        for (let z = ci(z0, 2); z <= ci(z1, 2); z += 1) {
          const key = (x * 4096 + y) * 4096 + z;
          const list = grid.get(key);
          if (list) list.push(t);
          else grid.set(key, [t]);
        }
  }
  /**
   * Closest surface point to p: { d, t, bary }. With `tol` > 0 it also
   * returns `near`: every triangle within best + tol ([t, bary, d]).
   */
  const query = (px, py, pz, tol = 0) => {
    const c = [ci(px, 0), ci(py, 1), ci(pz, 2)];
    let best = Infinity;
    let bestT = -1;
    let bestBary = null;
    const cand = tol > 0 ? [] : null;
    for (let r = 0; r < cells + 2; r += 1) {
      if ((r - 1) * cell > best + tol) break;
      for (let x = c[0] - r; x <= c[0] + r; x += 1)
        for (let y = c[1] - r; y <= c[1] + r; y += 1)
          for (let z = c[2] - r; z <= c[2] + r; z += 1) {
            if (Math.max(Math.abs(x - c[0]), Math.abs(y - c[1]), Math.abs(z - c[2])) !== r) continue;
            const list = grid.get((x * 4096 + y) * 4096 + z);
            if (!list) continue;
            for (const t of list) {
              const a = T[t] * 3, b = T[t + 1] * 3, cc = T[t + 2] * 3;
              const q = closest(px, py, pz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[cc], P[cc + 1], P[cc + 2]);
              const d = Math.hypot(q[0] - px, q[1] - py, q[2] - pz);
              if (cand && d <= best + tol) cand.push([t, [q[3], q[4], q[5]], d]);
              if (d < best) {
                best = d;
                bestT = t;
                bestBary = [q[3], q[4], q[5]];
              }
            }
          }
    }
    return { d: best, t: bestT, bary: bestBary, near: cand ? cand.filter((x) => x[2] <= best + tol) : null };
  };
  return { query, lo, hi, extent };
}

/** Sample points of a soup: every vertex plus every triangle centroid. */
function samplePoints(soup) {
  const P = soup.positions;
  const T = soup.tris;
  const n = P.length / 3;
  const out = new Float64Array((n + T.length / 3) * 3);
  out.set(P);
  let k = n * 3;
  for (let t = 0; t < T.length; t += 3) {
    for (let j = 0; j < 3; j += 1) out[k + j] = (P[T[t] * 3 + j] + P[T[t + 1] * 3 + j] + P[T[t + 2] * 3 + j]) / 3;
    k += 3;
  }
  return out;
}

function quantiles(values) {
  const s = Float64Array.from(values).sort();
  const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
  let sum = 0;
  for (const v of s) sum += v;
  return { max: s.length ? s[s.length - 1] : 0, p999: q(0.999), p99: q(0.99), mean: s.length ? sum / s.length : 0, n: s.length };
}

/** Symmetric Hausdorff between two soups (model units), both directions. */
export function symmetricHausdorff(a, b) {
  const ib = surfaceIndex(b);
  const ia = surfaceIndex(a);
  const pa = samplePoints(a);
  const pb = samplePoints(b);
  const ab = new Float64Array(pa.length / 3);
  for (let i = 0; i < ab.length; i += 1) ab[i] = ib.query(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]).d;
  const ba = new Float64Array(pb.length / 3);
  for (let i = 0; i < ba.length; i += 1) ba[i] = ia.query(pb[i * 3], pb[i * 3 + 1], pb[i * 3 + 2]).d;
  const all = new Float64Array(ab.length + ba.length);
  all.set(ab);
  all.set(ba, ab.length);
  return { aToB: quantiles(ab), bToA: quantiles(ba), symmetric: quantiles(all) };
}

const toSrgb = (l) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);

/**
 * Vertex-colour transfer error (sRGB 8-bit levels): A's vertex colour vs B's
 * colour interpolated at the closest surface point. A vertex on a colour
 * seam has a twin of another colour at the same position, so the nearest
 * triangle alone can sit on the wrong side of the seam: `seamAware` takes
 * the best colour among every B triangle within `tolFraction` × extent of
 * the closest one (`nearest` keeps the raw closest-triangle number).
 */
export function colourTransferError(a, b, tolFraction = 2e-4) {
  if (!a.colors || !b.colors) return null;
  const ib = surfaceIndex(b);
  const tol = ib.extent * tolFraction;
  const P = a.positions;
  const nearestErrs = [];
  const seamErrs = [];
  const errOf = (i, t, bary) => {
    let worst = 0;
    for (let k = 0; k < 3; k += 1) {
      const c = bary[0] * b.colors[b.tris[t] * 3 + k] + bary[1] * b.colors[b.tris[t + 1] * 3 + k] + bary[2] * b.colors[b.tris[t + 2] * 3 + k];
      const e = Math.abs(toSrgb(Math.min(1, Math.max(0, a.colors[i * 3 + k]))) - toSrgb(Math.min(1, Math.max(0, c)))) * 255;
      worst = Math.max(worst, e);
    }
    return worst;
  };
  for (let i = 0; i < P.length / 3; i += 1) {
    const hit = ib.query(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], tol);
    if (hit.t < 0) continue;
    nearestErrs.push(errOf(i, hit.t, hit.bary));
    let best = Infinity;
    for (const [t, bary] of hit.near) best = Math.min(best, errOf(i, t, bary));
    seamErrs.push(best);
  }
  return { nearest: quantiles(nearestErrs), seamAware: quantiles(seamErrs), tolFraction };
}

function soupBounds(soup) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const P = soup.positions;
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k += 1) {
    lo[k] = Math.min(lo[k], P[i + k]);
    hi[k] = Math.max(hi[k], P[i + k]);
  }
  return { min: lo, max: hi };
}

// ── The real ace px/m (teams formations, bundled from src) ──────────────────

let formationModule = null;

/** esbuild-bundle the pure formation modules from the worktree src and import them. */
export async function loadFormationModule() {
  if (formationModule) return formationModule;
  const esbuild = require('esbuild');
  const dir = join(tmpdir(), 'd42-decimate-figures');
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, `formation-entry-${process.pid}.ts`);
  writeFileSync(
    entry,
    [
      "export { makeTeamsSite, teamsFormation, teamsLandedPose, PLAZA_TEAMS_PLAN } from '@/lib/route-world/teams-formation';",
      "export { PLAZA_STATIONS } from '@/components/world/themes/plaza/theme';",
      "export { SAKURA_STATIONS } from '@/components/world/themes/sakura/theme';",
      "export { MOUNTAIN_STATIONS } from '@/components/world/themes/mountain/theme';",
      "export { ACES_LINE } from '@/components/world/themes/sakura/furniture/layout';",
      "export { CAIRN_LINE } from '@/components/world/themes/mountain/furniture/layout';",
      "export { VIEWPORTS } from '@/lib/route-world/data-surfaces';",
    ].join('\n'),
  );
  const outfile = join(dir, `formation-${process.pid}.mjs`);
  await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile, alias: { '@': join(REPO, 'src') }, logLevel: 'error' });
  formationModule = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
  return formationModule;
}

/** Card filler aces (teams-roster CARD_SIZE). */
const CARD = { heightM: 0.96, footprintM: 0.8, widthM: 0.8 };

/**
 * The largest px/m any teams formation gives a figure of this stature: every
 * roster size 2..16 and every rank, on the plaza / sakura / mountain sites,
 * from the frozen desktop eye (900 and 1024 px tall) and the landed 390 pose
 * (844 px). Distance is eye → the figure's centre (feet + h / 2).
 */
export async function acePixelsPerMetre({ heightM, footprintM, widthM }) {
  const m = await loadFormationModule();
  const sites = [
    m.makeTeamsSite('plaza', m.PLAZA_STATIONS, m.PLAZA_TEAMS_PLAN),
    m.makeTeamsSite('sakura', m.SAKURA_STATIONS, m.ACES_LINE.site),
    m.makeTeamsSite('mountain', m.MOUNTAIN_STATIONS, m.CAIRN_LINE.site),
  ];
  let best = { ppm: 0 };
  for (const site of sites) {
    const landed = m.teamsLandedPose(site);
    for (let n = 2; n <= 16; n += 1) {
      for (let k = 0; k < n; k += 1) {
        const aces = Array.from({ length: n }, (_, i) => (i === k ? { id: 'x', heightM, footprintM, widthM } : { id: `c${i}`, ...CARD }));
        let formation;
        try {
          formation = m.teamsFormation(site, aces);
        } catch {
          continue;
        }
        const slot = formation.slots.find((s) => s.id === 'x');
        if (!slot) continue;
        const centre = [slot.figure[0], slot.figure[1] + heightM / 2, slot.figure[2]];
        for (const [pose, heightPx, label] of [
          [site.camera, m.VIEWPORTS.desktop.height, 'desktop'],
          [site.camera, m.VIEWPORTS.tablet.height, 'tablet'],
          [landed, m.VIEWPORTS.mobile.height, 'mobile'],
        ]) {
          const d = Math.hypot(centre[0] - pose.position[0], centre[1] - pose.position[1], centre[2] - pose.position[2]);
          const ppm = heightPx / (2 * d * Math.tan((pose.fov * Math.PI) / 360));
          if (ppm > best.ppm) best = { ppm, site: site.id, roster: n, rank: k + 1, view: label, distanceM: +d.toFixed(3), colossal: slot.colossal };
        }
      }
    }
  }
  return best;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

async function validatorCodes(bytes) {
  const validator = require('gltf-validator');
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 500, writeTimestamp: false });
  return [...new Set(report.issues.messages.filter((msg) => msg.severity === 0).map((msg) => msg.code))].sort();
}

/**
 * The A1 escalation (plan §5 A1: a FAIL raises the triangle target, up to
 * 40 k): every target in `TARGET_LADDER` at the default normal weight, then
 * the same ladder at the lighter normal weights. The first attempt that
 * passes every A1 geometry bar is written; when none does, the file is a Q6
 * case (it keeps its full geometry: no decimated file, no castKb entry).
 */
export const TARGET_LADDER = [36000, 37000, 38000, 39000, 40000];
export const NORMAL_WEIGHT_LADDER = [0.5, 0.25, 0.1];

/**
 * The target ladder from `start` (`--target-triangles`): 1 k steps up to the
 * 40 k hard cap, which is always the last rung. The default start gives
 * `TARGET_LADDER`; 40 000 gives [40 000].
 */
export function targetLadderFrom(start = TARGET_TRIANGLES) {
  if (!Number.isInteger(start) || start < 1 || start > HARD_TRIANGLES) {
    throw new Error(`decimate-figures: --target-triangles must be an integer in 1..${HARD_TRIANGLES}, not ${start}`);
  }
  const ladder = [];
  for (let t = start; t < HARD_TRIANGLES; t += 1000) ladder.push(t);
  return [...ladder, HARD_TRIANGLES];
}

/** Model units → metres and the A1 px/m of one manifest entry. */
export async function figureScaleInfo(entry) {
  const boundsH = entry.bounds.max[1] - entry.bounds.min[1];
  const metresPerUnit = (entry.heightm ?? Math.min(Math.max(boundsH, 0.3), 2)) / boundsH;
  const heightM = boundsH * metresPerUnit;
  const footprintM = Math.max(entry.bounds.max[0] - entry.bounds.min[0], entry.bounds.max[2] - entry.bounds.min[2]) * metresPerUnit;
  const widthM = (entry.bounds.max[0] - entry.bounds.min[0]) * metresPerUnit;
  const ace = await acePixelsPerMetre({ heightM, footprintM, widthM });
  const closeUp = CLOSE_UP_PX / heightM;
  return { metresPerUnit, heightM, ppm: Math.max(ace.ppm, closeUp), ace, closeUp };
}

/** Measure A1 geometry for one attempt (the slow checks run once, on the winner). */
export function measureGeometry(soupA, document, scaleInfo) {
  const soupB = triangleSoup(document);
  const h = symmetricHausdorff(soupA, soupB);
  const { metresPerUnit, ppm } = scaleInfo;
  const px = (v) => +(v * metresPerUnit * ppm).toFixed(3);
  const mm = (v) => +(v * metresPerUnit * 1000).toFixed(3);
  const bA = soupBounds(soupA);
  const bB = soupBounds(soupB);
  const extent = Math.max(...[0, 1, 2].map((k) => bA.max[k] - bA.min[k]));
  const boundsShift = Math.max(...[0, 1, 2].flatMap((k) => [Math.abs(bA.min[k] - bB.min[k]), Math.abs(bA.max[k] - bB.max[k])])) / extent;
  const sym = h.symmetric;
  return {
    soupB,
    hausdorffMm: {
      symmetric: { max: mm(sym.max), p999: mm(sym.p999), p99: mm(sym.p99), mean: mm(sym.mean) },
      aToB: { max: mm(h.aToB.max), p999: mm(h.aToB.p999) },
      bToA: { max: mm(h.bToA.max), p999: mm(h.bToA.p999) },
    },
    hausdorffPx: { max: px(sym.max), p999: px(sym.p999), p99: px(sym.p99) },
    boundsShift,
    geometryPass: px(sym.max) <= A1_MAX_PX && px(sym.p999) <= A1_P999_PX && boundsShift <= A1_BOUNDS_FRACTION,
  };
}

/** Vertices of a document (POSITION count summed over primitives). */
function vertexCount(document) {
  return document
    .getRoot()
    .listMeshes()
    .reduce((s, mesh) => s + mesh.listPrimitives().reduce((t, prim) => t + prim.getAttribute('POSITION').getCount(), 0), 0);
}

/**
 * A1 over the 13 (or, with `weldOnly`, the G0 weld-only calibration arm:
 * one pass per file through the same pipeline with the simplifier skipped).
 */
export async function decimateFigures({ src, out, only = null, weldOnly = false, targetTriangles = TARGET_TRIANGLES }) {
  const ladder = targetLadderFrom(targetTriangles);
  // Mirror A is gitignored: an --out equal to --src would overwrite the originals with no way back (as compress-mirror).
  if (resolve(src) === resolve(out)) throw new Error('--out must differ from --src');
  const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
  const io = await createWorldIO({ quiet: true });
  mkdirSync(out, { recursive: true });
  const castKb = {};
  const rows = [];
  // The ladders exist for the simplifier only: the weld-only arm makes one pass (target and normal weight null).
  const normalLadder = weldOnly ? [null] : NORMAL_WEIGHT_LADDER;
  const targetLadder = weldOnly ? [null] : ladder;
  for (const outlier of OUTLIERS) {
    if (only && !only.split(',').includes(outlier.file)) continue;
    const t0 = performance.now();
    const inputBytes = readFileSync(join(src, outlier.file));
    const original = await io.readBinary(new Uint8Array(inputBytes));
    const soupA = triangleSoup(original);
    const entry = manifest.figures.find((f) => f.file === outlier.file);
    const scaleInfo = await figureScaleInfo(entry);
    const attempts = [];
    let winner = null;
    for (const normal of normalLadder) {
      for (const target of targetLadder) {
        const document = await io.readBinary(new Uint8Array(inputBytes));
        const weights = weldOnly ? null : { ...WEIGHTS, ...(outlier.weights ?? {}), normal };
        const result = await decimateDocument(document, { target, template: outlier.template, weights, simplify: !weldOnly });
        const geometry = measureGeometry(soupA, document, scaleInfo);
        attempts.push({
          target,
          normalWeight: normal,
          triangles: result.trianglesAfter,
          templateUsed: result.template,
          px: geometry.hausdorffPx,
          pass: geometry.geometryPass,
        });
        console.log(
          `  ${outlier.file} ${weldOnly ? 'weld-only (simplifier skipped)' : `target ${target} normal ${normal}`}: ${result.trianglesAfter} tris, ${geometry.hausdorffPx.max} / ${geometry.hausdorffPx.p999} px ${geometry.geometryPass ? 'pass' : 'fail'}`,
        );
        // Weld-only: the one pass is the arm's file; its A1 measures are reported, never a gate.
        if (weldOnly || (geometry.geometryPass && result.trianglesAfter <= HARD_TRIANGLES)) {
          winner = { document, result, geometry, weights, target };
          break;
        }
      }
      if (winner) break;
    }
    const kbA = Math.round(inputBytes.length / 1024);
    if (!winner) {
      rows.push({ file: outlier.file, template: outlier.template, q6: true, kbA, attempts, pxPerM: scaleInfo.ppm, pass: { all: false, geometry: false } });
      console.log(`${outlier.file}: no attempt passes A1 up to 40 k → Q6 (keeps its full geometry)`);
      continue;
    }
    const { document, result, geometry, weights, target } = winner;
    const bytes = Buffer.from(await io.writeBinary(document));
    const dest = join(out, outlier.file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    castKb[outlier.file] = Math.round(bytes.length / 1024);
    const sceneB = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
    const bounds = getBounds(sceneB);
    const colour = outlier.template === 'permissive-color' ? colourTransferError(soupA, geometry.soupB) : null;
    const codesA = await validatorCodes(inputBytes);
    const codesB = await validatorCodes(bytes);
    const sigA = attributeSignature(original);
    const sigB = attributeSignature(document);
    const texA = textureHashes(original);
    const texB = textureHashes(document);
    const row = {
      file: outlier.file,
      template: outlier.template,
      templateUsed: result.template,
      weights,
      trianglesBefore: result.trianglesBefore,
      trianglesAfter: result.trianglesAfter,
      target,
      ratio: weldOnly ? 1 : +(target / result.trianglesBefore).toFixed(4),
      ...(weldOnly && {
        weldOnly: true,
        trianglesChanged: result.trianglesAfter !== result.trianglesBefore,
        trianglesDropped: result.trianglesBefore - result.trianglesAfter,
        // Zero-area triangles (a shared index or a bitwise-equal position) before and after the weld:
        // a dropped triangle must be one of them (dropped = a − weld).
        degenerate: { a: degenerateTriangles(original), weld: degenerateTriangles(document) },
        vertices: { a: vertexCount(original), weld: vertexCount(document) },
      }),
      primitives: result.primitives.map((p) => ({
        before: p.trianglesBefore,
        after: p.trianglesAfter,
        target: Math.round(p.target),
        reached: p.reached,
        errorCap: p.errorCap,
        errorAchieved: +p.errorAchieved.toFixed(6),
        locked: p.lockedVertices,
        uvSeamVertices: p.uvSeamVertices,
        flags: p.flags,
      })),
      attempts,
      kbA,
      castKb: castKb[outlier.file],
      heightM: +scaleInfo.heightM.toFixed(3),
      pxPerM: { used: +scaleInfo.ppm.toFixed(1), ace: { ...scaleInfo.ace, ppm: +scaleInfo.ace.ppm.toFixed(1) }, closeUp: +scaleInfo.closeUp.toFixed(1) },
      hausdorffMm: geometry.hausdorffMm,
      hausdorffPx: geometry.hausdorffPx,
      boundsShiftFraction: +geometry.boundsShift.toExponential(3),
      bounds: { min: bounds.min.map((v) => Math.round(v * 1000) / 1000), max: bounds.max.map((v) => Math.round(v * 1000) / 1000) },
      attributeSetSame: JSON.stringify(sigA) === JSON.stringify(sigB),
      textureSha256Same: JSON.stringify(texA) === JSON.stringify(texB),
      textures: texA.length,
      validatorCodesA: codesA,
      validatorCodesB: codesB,
      newValidatorCodes: codesB.filter((c) => !codesA.includes(c)),
      colourTransferSrgbLevels: colour && {
        seamAware: { max: +colour.seamAware.max.toFixed(2), p999: +colour.seamAware.p999.toFixed(2), p99: +colour.seamAware.p99.toFixed(2), mean: +colour.seamAware.mean.toFixed(3) },
        nearest: { max: +colour.nearest.max.toFixed(2), p999: +colour.nearest.p999.toFixed(2), p99: +colour.nearest.p99.toFixed(2), mean: +colour.nearest.mean.toFixed(3) },
        tolFraction: colour.tolFraction,
      },
      ms: Math.round(performance.now() - t0),
    };
    row.pass = {
      // Weld-only: the triangle count is kept, or only degenerate triangles went.
      triangles: weldOnly
        ? row.trianglesDropped >= 0 && row.trianglesDropped === row.degenerate.a - row.degenerate.weld
        : row.trianglesAfter <= HARD_TRIANGLES,
      hausdorffMax: row.hausdorffPx.max <= A1_MAX_PX,
      hausdorffP999: row.hausdorffPx.p999 <= A1_P999_PX,
      attributes: row.attributeSetSame,
      textures: row.textureSha256Same,
      validator: row.newValidatorCodes.length === 0,
      bounds: geometry.boundsShift <= A1_BOUNDS_FRACTION,
    };
    row.pass.all = Object.values(row.pass).every(Boolean);
    rows.push(row);
    const verdict = `${row.pass.all ? 'PASS' : `FAIL ${Object.entries(row.pass).filter(([, v]) => !v).map(([k]) => k).join(',')}`}`;
    const tail =
      `Hausdorff sym max ${row.hausdorffMm.symmetric.max} mm / p99.9 ${row.hausdorffMm.symmetric.p999} mm = ${row.hausdorffPx.max} / ${row.hausdorffPx.p999} px @ ${row.pxPerM.used} px/m; ` +
      `bounds ${row.boundsShiftFraction}`;
    console.log(
      weldOnly
        ? `${outlier.file} weld-only (simplifier skipped): ${row.trianglesBefore} → ${row.trianglesAfter} tris (ratio 1` +
            `${row.trianglesChanged ? `; TRIANGLE COUNT CHANGED: ${row.trianglesDropped} dropped` : ''}; degenerate ${row.degenerate.a} → ${row.degenerate.weld}), ` +
            `vertices ${row.vertices.a} → ${row.vertices.weld}, ${row.kbA} → castKb ${row.castKb}; ${tail}; weld ${verdict}`
        : `${outlier.file} ${result.template} (normal ${weights.normal}): ${row.trianglesBefore} → ${row.trianglesAfter} tris (target ${target}), ${row.kbA} → castKb ${row.castKb}; ` +
            `${tail}; A1 ${verdict}`,
    );
  }
  const previousCast = existsSync(join(out, 'cast-kb.json')) && only ? JSON.parse(readFileSync(join(out, 'cast-kb.json'), 'utf8')) : {};
  writeFileSync(join(out, 'cast-kb.json'), JSON.stringify({ ...previousCast, ...castKb }, null, 1));
  const report = {
    stamp: weldOnly
      ? encoderStamp({ step: 'G0 weld-only', simplifier: 'skipped', ratio: 1 })
      : encoderStamp({ step: 'A1', targetLadder: ladder, normalWeightLadder: NORMAL_WEIGHT_LADDER, weights: WEIGHTS, errorLadder: ERROR_LADDER }),
    files: rows,
  };
  const name = reportName(weldOnly);
  writeFileSync(join(out, only ? `${name}.${only.replace(/[/,]/g, '_')}.json` : `${name}.json`), JSON.stringify(report, null, 1));
  return report;
}

/** The report's base name: a1-report (A1) or weld-report (--weld-only). */
export function reportName(weldOnly = false) {
  return weldOnly ? 'weld-report' : 'a1-report';
}

/**
 * Merge per-file runs (`--only`, one process per outlier) into
 * a1-report.json (weld-report.json with `weldOnly`) and cast-kb.json.
 */
export function mergeReports(out, { weldOnly = false } = {}) {
  const name = reportName(weldOnly);
  const parts = readdirSync(out).filter((f) => new RegExp(`^${name}..+.json$`).test(f)).sort();
  const files = [];
  let stamp = null;
  for (const part of parts) {
    const r = JSON.parse(readFileSync(join(out, part), 'utf8'));
    stamp = r.stamp;
    files.push(...r.files);
  }
  const order = new Map(OUTLIERS.map((o, i) => [o.file, i]));
  files.sort((a, b) => order.get(a.file) - order.get(b.file));
  const castKb = Object.fromEntries(files.filter((f) => !f.q6).map((f) => [f.file, f.castKb]));
  writeFileSync(join(out, 'cast-kb.json'), JSON.stringify(castKb, null, 1));
  writeFileSync(join(out, `${name}.json`), JSON.stringify({ stamp, files }, null, 1));
  return { files: files.length, castKb };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const src = arg(argv, '--src');
  const out = arg(argv, '--out');
  const weldOnly = argv.includes('--weld-only');
  if (argv.includes('--merge') && out) {
    console.log(mergeReports(out, { weldOnly }));
    process.exit(0);
  }
  const target = arg(argv, '--target-triangles');
  if (!src || !out || (target !== null && weldOnly)) {
    console.error('usage: decimate-figures.mjs --src <mirror A> --out <scratch dir> [--only <file,...>] [--weld-only | --target-triangles <n ≤ 40000>]');
    process.exit(2);
  }
  const targetTriangles = target === null ? TARGET_TRIANGLES : Number(target);
  decimateFigures({ src, out, only: arg(argv, '--only'), weldOnly, targetTriangles }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
