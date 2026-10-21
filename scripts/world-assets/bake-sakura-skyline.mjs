/**
 * The sakura skyline atlas (ROLLOUT-PLAN §1.1 horizon, §3.3 item 3, §5) →
 * 2048 × 256 lossless RGBA WebP at `public/models/world/env/sakura/skyline.webp`.
 * Layout and uv law: `SAKURA_SKYLINE_ATLAS` in `src/lib/route-world/world-env.ts`
 * (the plaza's `PLAZA_SKYLINE_ATLAS` law with per-band top elevations).
 *
 *   R / G / B  near / mid / far silhouette coverage: three bands of rolling
 *              wooded hills (a crown-scalloped tree line on near and mid,
 *              soft bare ridges far), ONE distant pagoda roof and ONE
 *              temple-gate silhouette on the mid band
 *   A          0 (no skyline windows in sakura: `SkylineSpec.windows` false)
 *
 * Every shape is a periodic function of the azimuth (seamless at u 0 / 1),
 * driven by integer hashes — the same bytes on every run (hash test in
 * `__tests__/rollout-bakes.test.mjs`). No keep-out work is needed here: A
 * carries no windows, and the ring's calm rects are applied in-shader.
 *
 * AD-SAKURA owns `PARAMS` from B5 (edit, re-run, then
 * `bake-manifest.mjs --refresh-mirror`); `lib.mjs` stays frozen.
 *
 * Usage: node scripts/world-assets/bake-sakura-skyline.mjs [--out]
 *        (Windows: PowerShell or MSYS_NO_PATHCONV=1)
 */

import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodeLosslessRgba, rasterSkylineAtlas, ringDelta, ringFbm, hash3, sha256Hex } from './lib.mjs';

/** Mirrors `SAKURA_SKYLINE_ATLAS` (world-env.ts; asserted equal by the bake test). */
export const ATLAS = {
  file: 'env/sakura/skyline.webp',
  width: 2048,
  height: 256,
  radii: [60, 90, 130],
  topElevationDeg: [8, 10, 11],
};

// ── Parameter block (AD-SAKURA) ─────────────────────────────────────────────

export const PARAMS = {
  /** Hills: v = base + amp · fbm(u); `cells` = hill count around the ring. */
  hills: [
    { channel: 0, base: 0.36, amp: 0.34, cells: 9, octaves: 4, seed: 11 },
    { channel: 1, base: 0.44, amp: 0.36, cells: 7, octaves: 4, seed: 23 },
    { channel: 2, base: 0.4, amp: 0.46, cells: 5, octaves: 3, seed: 37 },
  ],
  /** Wooded crown line: `count` crowns around the ring, each `height` of the band tall (0 = bare ridge). */
  crowns: [
    { count: 520, height: 0.07 },
    { count: 420, height: 0.045 },
    { count: 0, height: 0 },
  ],
  /**
   * The pagoda roof (mid band): azimuth u (0 = +X east, 0.25 = +Z south),
   * width and height in metres at the band radius, tier count. South-east:
   * off the pulse (north-west) and schedule (north-east) board backdrops.
   */
  pagoda: { band: 1, u: 0.13, widthM: 10, heightM: 9.5, tiers: 5 },
  /** The temple gate (mid band): a hipped roof on two pillars, south-west. */
  gate: { band: 1, u: 0.37, widthM: 14, heightM: 6.2, roofShare: 0.4 },
};

// ── Shapes ───────────────────────────────────────────────────────────────────

function bandHeightM(band) {
  return ATLAS.radii[band] * Math.tan((ATLAS.topElevationDeg[band] * Math.PI) / 180);
}

/** Hill top v at azimuth u for band k. */
function hillTop(k, u) {
  const h = PARAMS.hills[k];
  let v = h.base + h.amp * (ringFbm(u, h.cells, h.octaves, h.seed) - 0.5) * 2;
  const c = PARAMS.crowns[k];
  if (c.count > 0) {
    const s = u * c.count;
    const i = Math.floor(s);
    const t = s - i;
    const size = 0.55 + 0.45 * hash3(i % c.count, k, 71);
    v += c.height * size * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
  }
  return Math.min(0.97, Math.max(0.08, v));
}

/** Pagoda envelope (v above its base) at `dxM` metres from its axis, or −1 outside. */
function pagodaTop(dxM) {
  const p = PARAMS.pagoda;
  const d = Math.abs(dxM);
  const tierH = (p.heightM * 0.78) / p.tiers;
  let top = -1;
  for (let k = 0; k < p.tiers; k += 1) {
    // Each tier: a body, then a roof whose eave overhangs and turns up at the tips.
    const halfRoof = (p.widthM / 2) * (1 - 0.12 * k);
    const halfBody = halfRoof * 0.62;
    const eave = tierH * (k + 0.55);
    const ridge = tierH * (k + 1);
    if (d <= halfBody) top = Math.max(top, ridge);
    else if (d <= halfRoof) {
      const f = (d - halfBody) / (halfRoof - halfBody);
      top = Math.max(top, ridge - (ridge - eave) * f + tierH * 0.12 * f ** 4);
    }
  }
  // The sōrin finial.
  if (d <= 0.35) top = Math.max(top, p.heightM);
  return top < 0 ? -1 : top;
}

/** Gate spans (metres above its base) at `dxM` from its axis: two pillars and a hipped roof. */
function gateSpans(dxM) {
  const g = PARAMS.gate;
  const d = Math.abs(dxM);
  const roofBottom = g.heightM * (1 - g.roofShare);
  const spans = [];
  const pillar = g.widthM * 0.3;
  if (Math.abs(d - pillar) <= 0.45) spans.push([0, roofBottom]);
  const halfRoof = g.widthM / 2;
  if (d <= halfRoof) {
    const f = d / halfRoof;
    const eaveLift = 0.1 * f ** 4 * g.heightM;
    spans.push([roofBottom - eaveLift * 0.3, g.heightM - (g.heightM - roofBottom) * 0.75 * f ** 1.6 + eaveLift]);
  }
  return spans;
}

/** Covered spans of band k at azimuth u (v units). */
export function bandSpans(k, u) {
  const top = hillTop(k, u);
  const spans = [[0, top]];
  const H = bandHeightM(k);
  const mPerTurn = 2 * Math.PI * ATLAS.radii[k];
  for (const [feature, shape] of [
    [PARAMS.pagoda, (dx) => { const t = pagodaTop(dx); return t < 0 ? [] : [[0, t]]; }],
    [PARAMS.gate, gateSpans],
  ]) {
    if (feature.band !== k) continue;
    const dxM = ringDelta(u, feature.u) * mPerTurn;
    if (Math.abs(dxM) > feature.widthM) continue;
    // Seat on the hill line at the feature's own axis (a flat terrace).
    const base = Math.min(hillTop(k, feature.u), 0.97 - feature.heightM / H - 0.02) - 0.02;
    for (const [a, b] of shape(dxM)) spans.push([base + a / H, base + b / H]);
  }
  return spans;
}

export function buildSakuraSkyline() {
  return rasterSkylineAtlas({
    width: ATLAS.width,
    height: ATLAS.height,
    bands: [0, 1, 2].map((k) => ({ channel: PARAMS.hills[k].channel, spans: (u) => bandSpans(k, u) })),
  });
}

async function main() {
  const { MIRROR_DIR, OUT_ENV_DIR, ensureDir, log } = await import('./lib.mjs');
  const envDir = process.argv.includes('--out') ? OUT_ENV_DIR : join(MIRROR_DIR, 'env');
  const dir = join(envDir, 'sakura');
  ensureDir(dir);
  const raster = buildSakuraSkyline();
  const bytes = await encodeLosslessRgba(raster);
  const file = join(dir, 'skyline.webp');
  writeFileSync(file, bytes);
  log(`sakura skyline ${raster.width}×${raster.height} → ${file} ${Math.round(statSync(file).size / 1024)} KB; raw sha256 ${sha256Hex(raster.data).slice(0, 16)}, file sha256 ${sha256Hex(bytes).slice(0, 16)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
