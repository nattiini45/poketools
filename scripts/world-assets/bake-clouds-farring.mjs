/**
 * The clouds far ring (ROLLOUT-PLAN §1.3 horizon, §3.3 item 3, §5) →
 * 2048 × 512 lossless RGBA WebP at `public/models/world/env/clouds/skyline.webp`,
 * on the shared `skyline` program (`CLOUDS_SKYLINE_ATLAS` in world-env.ts:
 * r 90 / 130 / 170, per-band top elevations, the plaza's uv law).
 *
 *   R  near: cumulus towers (stacked puffs) over a low cloud-bank base
 *   G  mid:  distant floating isles (flat meadow top with a tree fringe,
 *            an inverted rock cone below) — some with a thin waterfall
 *            thread — over a lower cloud bank
 *   B  far:  broad, low cloud banks
 *   A  0 (no windows; `SkylineSpec.windows` false)
 *
 * Towers and isles are hashed per slot around the ring (seamless at u 0 / 1),
 * the same bytes on every run (hash test).
 *
 * AD-CLOUDS owns `PARAMS` from B7; `lib.mjs` stays frozen.
 *
 * Usage: node scripts/world-assets/bake-clouds-farring.mjs [--out]
 *        (Windows: PowerShell or MSYS_NO_PATHCONV=1)
 */

import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodeLosslessRgba, hash3, rasterSkylineAtlas, ringDelta, ringFbm, sha256Hex } from './lib.mjs';

/** Mirrors `CLOUDS_SKYLINE_ATLAS` (world-env.ts; asserted equal by the bake test). */
export const ATLAS = {
  file: 'env/clouds/skyline.webp',
  width: 2048,
  height: 512,
  radii: [90, 130, 170],
  topElevationDeg: [9, 11, 12],
};

// ── Parameter block (AD-CLOUDS) ─────────────────────────────────────────────

export const PARAMS = {
  /** Cloud-bank base per band: v = base + amp · fbm. */
  banks: [
    { base: 0.2, amp: 0.08, cells: 18, seed: 901 },
    { base: 0.14, amp: 0.06, cells: 14, seed: 913 },
    { base: 0.3, amp: 0.14, cells: 9, seed: 927 },
  ],
  /** Near cumulus towers: slots around the ring, share of slots with a tower, height range (v), puffs per tower. */
  towers: { slots: 14, share: 0.7, min: 0.55, max: 0.95, widthM: [26, 44], puffs: 7, seed: 941 },
  /** Mid isles: slots, share, top v range, width (m), share with a waterfall thread. */
  isles: { slots: 12, share: 0.5, top: [0.45, 0.72], widthM: [9, 20], depthShare: 0.9, falls: 0.5, seed: 967 },
};

// ── Shapes ───────────────────────────────────────────────────────────────────

function bandHeightM(k) {
  return ATLAS.radii[k] * Math.tan((ATLAS.topElevationDeg[k] * Math.PI) / 180);
}

function bank(k, u) {
  const b = PARAMS.banks[k];
  return b.base + b.amp * (ringFbm(u, b.cells, 3, b.seed) - 0.5) * 2;
}

/** Tower envelope (v) at u, or 0. Puffs are circles in metres, so they read round on the ring. */
function towerTop(u) {
  const t = PARAMS.towers;
  const H = bandHeightM(0);
  const mPerTurn = 2 * Math.PI * ATLAS.radii[0];
  let top = 0;
  for (let i = 0; i < t.slots; i += 1) {
    if (hash3(i, 0, t.seed) > t.share) continue;
    const cu = (i + 0.25 + 0.5 * hash3(i, 1, t.seed)) / t.slots;
    const widthM = t.widthM[0] + (t.widthM[1] - t.widthM[0]) * hash3(i, 2, t.seed);
    const heightM = (t.min + (t.max - t.min) * hash3(i, 3, t.seed)) * H;
    const dx = ringDelta(u, cu) * mPerTurn;
    if (Math.abs(dx) > widthM) continue;
    for (let p = 0; p < t.puffs; p += 1) {
      // Puffs stack up a narrowing column: wide at the base, a rounded crown on top.
      const f = p / (t.puffs - 1);
      const r = (widthM / 2) * (0.62 - 0.3 * f) * (0.85 + 0.3 * hash3(i, 10 + p, t.seed));
      const px = (hash3(i, 30 + p, t.seed) - 0.5) * widthM * 0.5 * (1 - f);
      const py = f * (heightM - r);
      const d = dx - px;
      if (Math.abs(d) < r) top = Math.max(top, (py + Math.sqrt(r * r - d * d)) / H);
    }
  }
  return Math.min(0.98, top);
}

/** Isle spans (v) at u: the floating isle body and its waterfall thread. */
function isleSpans(u) {
  const s = PARAMS.isles;
  const H = bandHeightM(1);
  const mPerTurn = 2 * Math.PI * ATLAS.radii[1];
  const spans = [];
  for (let i = 0; i < s.slots; i += 1) {
    if (hash3(i, 0, s.seed) > s.share) continue;
    const cu = (i + 0.25 + 0.5 * hash3(i, 1, s.seed)) / s.slots;
    const widthM = s.widthM[0] + (s.widthM[1] - s.widthM[0]) * hash3(i, 2, s.seed);
    const top = s.top[0] + (s.top[1] - s.top[0]) * hash3(i, 3, s.seed);
    const depth = (widthM * s.depthShare) / H;
    const dx = ringDelta(u, cu) * mPerTurn;
    const half = widthM / 2;
    if (Math.abs(dx) <= half) {
      const f = Math.abs(dx) / half;
      // Inverted cone under a slightly domed meadow top with a tree fringe.
      const bottom = top - 0.08 / 1 - depth * (1 - f) ** 1.3;
      const crown = 0.025 * (1 - f * f) + 0.02 * Math.max(0, Math.sin((dx / 1.6) * Math.PI)) * (f < 0.85 ? 1 : 0);
      spans.push([Math.max(0, bottom), top + crown]);
    }
    const fallX = half * (hash3(i, 5, s.seed) - 0.5);
    if (hash3(i, 4, s.seed) < s.falls && Math.abs(dx - fallX) < 0.35) spans.push([0, top - 0.06]);
  }
  return spans;
}

export function bandSpans(k, u) {
  const spans = [[0, bank(k, u)]];
  if (k === 0) {
    const t = towerTop(u);
    if (t > 0) spans.push([0, t]);
  }
  if (k === 1) spans.push(...isleSpans(u));
  return spans;
}

export function buildCloudsFarRing() {
  return rasterSkylineAtlas({
    width: ATLAS.width,
    height: ATLAS.height,
    bands: [0, 1, 2].map((k) => ({ channel: k, spans: (u) => bandSpans(k, u) })),
  });
}

async function main() {
  const { MIRROR_DIR, OUT_ENV_DIR, ensureDir, log } = await import('./lib.mjs');
  const envDir = process.argv.includes('--out') ? OUT_ENV_DIR : join(MIRROR_DIR, 'env');
  const dir = join(envDir, 'clouds');
  ensureDir(dir);
  const raster = buildCloudsFarRing();
  const bytes = await encodeLosslessRgba(raster);
  const file = join(dir, 'skyline.webp');
  writeFileSync(file, bytes);
  log(`clouds far ring ${raster.width}×${raster.height} → ${file} ${Math.round(statSync(file).size / 1024)} KB; raw sha256 ${sha256Hex(raster.data).slice(0, 16)}, file sha256 ${sha256Hex(bytes).slice(0, 16)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
