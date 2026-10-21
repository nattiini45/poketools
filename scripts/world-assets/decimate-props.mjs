#!/usr/bin/env node
/**
 * Byte recovery for the two heaviest plaza hero props (LOOK-PLAN §2 SEAT A.2):
 * `haussmann-lamp-post` (1 007 KB) and `led-board-cabinet` (1 100 KB).
 *
 *   dequantize → weld → simplify (meshoptimizer, ratio 0.22, per-prop error,
 *   `Permissive` seams) → prune (solid textures kept) → quantize (normals
 *   8-bit) → textures to 512² WebP
 *
 * Meshopt COMPRESSION is not used: drei's `useGLTF` wires `MeshoptDecoder`
 * only when asked, and `figure-loader.ts` calls `useGLTF(url, false, false,
 * …)` — meshopt off. KHR_mesh_quantization (already in these GLBs) is kept.
 *
 * The error bound, not the ratio, is what stops the simplifier on these
 * Meshy meshes. Per-prop errors were chosen by a rendered crop review
 * (2026-09-27, three 0.185.1, AgX, the plaza key + hemisphere): the lamp at
 * 0.003 and above shows smeared-seam notches on the lantern glass at a
 * 6 m close-up, 0.002 is indistinguishable from the original; the LED
 * cabinet shows a screen-diagonal crease at 0.008, 0.004 is clean.
 *
 * The untouched originals are cached once under
 * `.cache/props-src/<name>.glb` and every run decimates FROM them, so the
 * script is idempotent and `--restore` rolls the mirror back.
 *
 * Crop gate (LOOK-PLAN §2 A.2): the one-sided Hausdorff distance from every
 * original vertex to the decimated surface, at the prop's fitted real-world
 * size, is projected to pixels at the prop's nearest seat from a frozen
 * station eye (the lamp: the #teams 1440 × 900 eye at the east pair — the
 * closest station scale any lamp gets, 136 px/m; the kiosk: #schedule 1440).
 * The p99.9 deviation must stay ≤ the target's `gatePx`; a failing prop retries at
 * the fallback ratio 0.35 and is NOT written if it still fails. Run under
 * `npx tsx` so the plaza theme's station table can be imported. Captures stay
 * the evidence of record; this is the pre-capture guard.
 *
 * Usage: npx tsx scripts/world-assets/decimate-props.mjs [--restore] [--dry-run]
 *          [--only <name>] [--ratio 0.22] [--error <e>] [--out <dir>]
 * Then:  node scripts/world-assets/bake-manifest.mjs --refresh-mirror
 */

import { copyFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { registerMeshoptDecoder } from './meshopt-codec.mjs';
import { compactPrimitive, dequantize, prune, quantize, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { CACHE_DIR, MIRROR_DIR, ensureDir, log } from './lib.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
}

const restore = process.argv.includes('--restore');
const dryRun = process.argv.includes('--dry-run');
const RATIO = Number(arg('--ratio') ?? 0.22);
const FALLBACK_RATIO = 0.35;
/** `--error` overrides every target's own error (crop reviews). */
const ERROR_OVERRIDE = arg('--error') === null ? null : Number(arg('--error'));
/** Write candidates to another directory (crop reviews) instead of the mirror. */
const OUT_DIR = arg('--out');
const ONLY = arg('--only');
const TEXTURE_SIZE = 512;
/** `--gate` overrides every target's p99.9 crop gate (px). */
const GATE_OVERRIDE = arg('--gate') === null ? null : Number(arg('--gate'));

const SRC_DIR = join(CACHE_DIR, 'props-src');
const PROPS_DIR = join(MIRROR_DIR, 'props');

/**
 * `sizeM` / `axis`: the real-world fit the app applies (PlazaHall LAMP_SIZE_M
 * 4.4 m tall; layout.ts HERO_PROPS led-board-cabinet 2.18 m wide).
 * `station` + `seats`: the crop metric's eye and the world XZ seats judged.
 */
const TARGETS = [
  {
    name: 'haussmann-lamp-post',
    sizeM: 4.4,
    axis: 1,
    error: 0.002,
    // Calibrated by the crop review: 0.003 (1.76 px) showed glass notches, 0.002 (1.15 px) did not.
    gatePx: 1.25,
    station: 'teams',
    // PLAZA_LAMP_SEATS east pair (PLAZA_TEAMS_LAMPS).
    seats: [
      [12.2, -5.2],
      [12.2, 5.2],
    ],
  },
  {
    name: 'led-board-cabinet',
    sizeM: 2.18,
    axis: 0,
    error: 0.004,
    // Calibrated by the crop review at a 3.5 m close-up (≈ 2.7× the schedule scale):
    // 0.004 (1.82 px here) clean, 0.008 (2.4 px) showed a screen crease.
    gatePx: 2.0,
    station: 'schedule',
    // layout.ts HERO_PROPS: beside the east board.
    seats: [[4.0, -14.0]],
  },
];

function kb(file) {
  return Math.round(statSync(file).size / 1024);
}

// ── Geometry probe ──────────────────────────────────────────────────────────

/** World-space (model units) triangle soup of every primitive under the default scene. */
function triangleSoup(document) {
  const positions = [];
  const tris = [];
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const base = positions.length / 3;
      const el = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, el);
        positions.push(
          m[0] * el[0] + m[4] * el[1] + m[8] * el[2] + m[12],
          m[1] * el[0] + m[5] * el[1] + m[9] * el[2] + m[13],
          m[2] * el[0] + m[6] * el[1] + m[10] * el[2] + m[14],
        );
      }
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i < count; i += 1) tris.push(base + (idx ? idx.getScalar(i) : i));
    }
  });
  return { positions: Float64Array.from(positions), tris: Uint32Array.from(tris) };
}

function closestOnTriangle(p, a, b, c) {
  // Ericson, Real-Time Collision Detection 5.1.5.
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v];
  }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

/**
 * One-sided Hausdorff distance (model units): max over original vertices of
 * the distance to the decimated surface. Uniform-grid accelerated; the search
 * grows ring by ring until the ring distance exceeds the best hit.
 */
function hausdorff(original, decimated) {
  const P = decimated.positions;
  const T = decimated.tris;
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], P[i + k]);
      max[k] = Math.max(max[k], P[i + k]);
    }
  }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const cell = extent / 48;
  const key = (x, y, z) => `${x},${y},${z}`;
  const grid = new Map();
  const cellOf = (v, k) => Math.floor((v - min[k]) / cell);
  for (let t = 0; t < T.length; t += 3) {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let j = 0; j < 3; j += 1) {
      for (let k = 0; k < 3; k += 1) {
        lo[k] = Math.min(lo[k], P[T[t + j] * 3 + k]);
        hi[k] = Math.max(hi[k], P[T[t + j] * 3 + k]);
      }
    }
    for (let x = cellOf(lo[0], 0); x <= cellOf(hi[0], 0); x += 1) {
      for (let y = cellOf(lo[1], 1); y <= cellOf(hi[1], 1); y += 1) {
        for (let z = cellOf(lo[2], 2); z <= cellOf(hi[2], 2); z += 1) {
          const k = key(x, y, z);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(t);
        }
      }
    }
  }
  const vert = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  let worst = 0;
  let sum = 0;
  const all = [];
  const O = original.positions;
  const n = O.length / 3;
  for (let i = 0; i < n; i += 1) {
    const p = [O[i * 3], O[i * 3 + 1], O[i * 3 + 2]];
    const c = [cellOf(p[0], 0), cellOf(p[1], 1), cellOf(p[2], 2)];
    let best = Infinity;
    for (let r = 0; r < 48; r += 1) {
      if ((r - 1) * cell > best) break;
      for (let x = c[0] - r; x <= c[0] + r; x += 1) {
        for (let y = c[1] - r; y <= c[1] + r; y += 1) {
          for (let z = c[2] - r; z <= c[2] + r; z += 1) {
            if (Math.max(Math.abs(x - c[0]), Math.abs(y - c[1]), Math.abs(z - c[2])) !== r) continue;
            const list = grid.get(key(x, y, z));
            if (!list) continue;
            for (const t of list) {
              const q = closestOnTriangle(p, vert(T[t]), vert(T[t + 1]), vert(T[t + 2]));
              best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]));
            }
          }
        }
      }
    }
    worst = Math.max(worst, best);
    sum += best;
    all.push(best);
  }
  all.sort((a, b) => a - b);
  return { max: worst, mean: sum / n, p99: all[Math.floor(all.length * 0.99)], p999: all[Math.floor(all.length * 0.999)], extent };
}

// ── Crop metric (teams 1440) ────────────────────────────────────────────────

/** Pixels per metre at each seat from a frozen station's desktop eye, or null without tsx. */
async function stationPixelsPerMetre(stationId, seats) {
  try {
    const { PLAZA_STATIONS } = await import('../../src/components/world/themes/plaza/theme.ts');
    const { routePoseAt, VIEWPORTS } = await import('../../src/lib/route-world/data-surfaces.ts');
    const index = PLAZA_STATIONS.findIndex((s) => s.id === stationId);
    const viewport = VIEWPORTS.desktop;
    const cam = routePoseAt(PLAZA_STATIONS, index, viewport);
    const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
    return seats.map(([x, z]) => {
      const d = Math.hypot(x - cam.position[0], 2.2 - cam.position[1], z - cam.position[2]);
      return viewport.height / (2 * d * tanHalf);
    });
  } catch {
    return null;
  }
}

// ── Decimation ──────────────────────────────────────────────────────────────

/**
 * Attribute-aware simplification that may collapse ACROSS attribute seams
 * (meshoptimizer `Permissive`). Meshy GLBs are UV-island confetti (27.5 k
 * vertices for 20 k triangles on the lamp): gltf-transform's `simplify`
 * treats every seam as a border and stalls at ~52 % of the triangles however
 * large the error budget. Normals and UVs ride along as weighted attributes,
 * so a seam collapse that would smear texture or shading still pays for it.
 */
const ATTR_WEIGHTS = { normal: 0.5, uv: 1.0 };

function permissiveSimplify(ratio, error) {
  return (document) => {
    for (const mesh of document.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const idx = prim.getIndices();
        if (!pos || !idx) continue;
        const normal = prim.getAttribute('NORMAL');
        const uv = prim.getAttribute('TEXCOORD_0');
        const n = pos.getCount();
        const positions = new Float32Array(n * 3);
        const attrs = new Float32Array(n * 5);
        const el = [0, 0, 0];
        for (let i = 0; i < n; i += 1) {
          pos.getElement(i, el);
          positions.set(el.slice(0, 3), i * 3);
          if (normal) {
            normal.getElement(i, el);
            attrs.set(el.slice(0, 3), i * 5);
          }
          if (uv) {
            const t = uv.getElement(i, [0, 0]);
            attrs[i * 5 + 3] = t[0];
            attrs[i * 5 + 4] = t[1];
          }
        }
        const indices = Uint32Array.from(idx.getArray());
        const target = Math.floor((indices.length * ratio) / 3) * 3;
        const w = ATTR_WEIGHTS;
        const [out] = MeshoptSimplifier.simplifyWithAttributes(
          indices,
          positions,
          3,
          attrs,
          5,
          [w.normal, w.normal, w.normal, w.uv, w.uv],
          null,
          target,
          error,
          ['Permissive'],
        );
        idx.setArray(n <= 65535 ? Uint16Array.from(out) : out);
        compactPrimitive(prim);
      }
    }
  };
}

async function decimate(io, src, ratio, error) {
  const document = await io.read(src);
  await MeshoptSimplifier.ready;
  await document.transform(
    dequantize(),
    weld(),
    permissiveSimplify(ratio, error),
    prune({ keepSolidTextures: true }),
    quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 12 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE_SIZE, TEXTURE_SIZE] }),
  );
  return document;
}

function countTriangles(document) {
  let t = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      t += Math.floor((idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3);
    }
  }
  return t;
}

async function main() {
  ensureDir(SRC_DIR);
  const io = await registerMeshoptDecoder(new NodeIO().registerExtensions(ALL_EXTENSIONS));
  for (const target of TARGETS) {
    if (ONLY && target.name !== ONLY) continue;
    const live = join(PROPS_DIR, `${target.name}.glb`);
    const src = join(SRC_DIR, `${target.name}.glb`);
    if (!existsSync(src)) {
      if (!existsSync(live)) throw new Error(`missing ${live}`);
      copyFileSync(live, src);
      log(`cached original ${target.name} → ${src}`);
    }
    if (restore) {
      copyFileSync(src, live);
      log(`restored ${target.name} (${kb(live)} KB)`);
      continue;
    }
    const original = await io.read(src);
    const origSoup = triangleSoup(original);
    const ppm = await stationPixelsPerMetre(target.station, target.seats);
    const scale = ppm ? Math.max(...ppm) : null;
    const error = ERROR_OVERRIDE ?? target.error;
    // Model units → metres at the app's fit (axis extent → sizeM).
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = target.axis; k < origSoup.positions.length; k += 3) {
      lo = Math.min(lo, origSoup.positions[k]);
      hi = Math.max(hi, origSoup.positions[k]);
    }
    const metresPerUnit = target.sizeM / (hi - lo);
    const mm = (v) => (v * metresPerUnit * 1000).toFixed(1);
    for (const ratio of [RATIO, FALLBACK_RATIO]) {
      const document = await decimate(io, src, ratio, error);
      const h = hausdorff(origSoup, triangleSoup(document));
      const px = scale === null ? null : scale * h.p999 * metresPerUnit;
      const bytes = await io.writeBinary(document);
      log(
        `${target.name} ratio ${ratio} error ${error}: ${countTriangles(original)} → ${countTriangles(document)} tris, ` +
          `${kb(src)} → ${Math.round(bytes.byteLength / 1024)} KB; Hausdorff max ${mm(h.max)} / p99.9 ${mm(h.p999)} / ` +
          `p99 ${mm(h.p99)} mm / mean ${mm(h.mean)} mm` +
          (px === null ? ' (crop px: run under tsx)' : `; ${target.station}-1440 p99.9 ${px.toFixed(2)} px at ${scale.toFixed(1)} px/m`),
      );
      const gate = GATE_OVERRIDE ?? target.gatePx;
      const pass = px === null || px <= gate;
      if (!pass && ratio !== FALLBACK_RATIO) {
        log(`  crop gate ${px.toFixed(2)} px > ${gate} px → fallback ratio ${FALLBACK_RATIO}`);
        continue;
      }
      if (!pass) {
        log(`  FAIL: ${target.name} misses the crop gate at the fallback ratio — not written`);
        process.exitCode = 1;
        break;
      }
      if (OUT_DIR) {
        ensureDir(OUT_DIR);
        await io.write(join(OUT_DIR, `${target.name}.r${ratio}.e${error}.glb`), document);
      } else if (!dryRun) {
        await io.write(live, document);
      }
      break;
    }
  }
  if (!restore) log('props decimated → run bake-manifest.mjs --refresh-mirror');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
