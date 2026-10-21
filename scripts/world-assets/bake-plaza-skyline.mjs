/**
 * The Lumiose skyline atlas (LOOK-PLAN §2 SEAT A.5) → 2048 × 512 lossless
 * RGBA WebP at `public/models/world/env/plaza/skyline.webp`. Layout and uv
 * law: `PLAZA_SKYLINE_ATLAS` in `src/lib/route-world/world-env.ts` (shared
 * with the ring, SEAT K).
 *
 *   R / G / B  near / mid / far silhouette coverage — authored SVG polylines:
 *              Haussmann mansard blocks with chimney stacks, stepped
 *              roofs, gables, TWO domes (mid band) and ONE spire (far band);
 *              ≥ 3 distinct silhouette kinds in every band
 *   A          static night window dots, near band only, ≈ 22 % of the
 *              window grid lit (integer hash, no twinkle), and ZERO wherever
 *              a padded data-face rect's sky projection falls from any
 *              keep-out pose (desktop, 768, 390, focus, dolly) — the same
 *              face-rect maths as the wedges (`paddedFaceRect`, `screenPoint`)
 *
 * The profiles are AUTHORED: every band is a fixed, hand-written sequence of
 * building runs (kind, width in metres, height share) walked around the
 * circle from its own start azimuth — no randomness anywhere. The azimuth of
 * the Prism Tower (north, u 0.75) is left low in every band so the tower
 * stays the one landmark there. Rasterised by librsvg (sharp) — the same
 * bytes on every run.
 *
 * Usage: npx tsx scripts/world-assets/bake-plaza-skyline.mjs [--out]
 *        (tsx: the face-rect mask imports the plaza's TypeScript data faces)
 */

import { createHash } from 'node:crypto';
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

/** 22 % of the window grid lit at night (LOOK-PLAN §2 S.3 façade windows use the same share). */
export const WINDOW_LIT_SHARE = 0.22;

/**
 * Authored runs per band: [kind, width m, height share of the band]. Kinds:
 * `mansard` (walls to 78 %, zinc slope to the top, two chimney stacks),
 * `stepped` (two setbacks), `gable` (pitched roof), `flat` (low terrace),
 * `dome` (drum + dome + lantern), `spire` (tower + needle).
 */
const BANDS = {
  near: {
    start: 0.02,
    runs: [
      ['mansard', 26, 0.74], ['stepped', 18, 0.66], ['mansard', 32, 0.8], ['gable', 14, 0.6], ['mansard', 22, 0.7],
      ['flat', 16, 0.55], ['mansard', 28, 0.78], ['gable', 12, 0.64], ['stepped', 24, 0.72], ['mansard', 20, 0.68],
      ['mansard', 30, 0.82], ['flat', 12, 0.56], ['gable', 16, 0.62], ['mansard', 26, 0.76], ['stepped', 20, 0.7],
    ],
  },
  mid: {
    start: 0.11,
    runs: [
      ['mansard', 38, 0.7], ['dome', 30, 0.98], ['stepped', 30, 0.66], ['mansard', 44, 0.74], ['gable', 22, 0.6],
      ['mansard', 36, 0.72], ['flat', 26, 0.56], ['mansard', 40, 0.78], ['stepped', 28, 0.68], ['gable', 20, 0.62],
      ['mansard', 42, 0.76], ['dome', 34, 0.95], ['mansard', 32, 0.7], ['flat', 24, 0.58],
    ],
  },
  far: {
    start: 0.23,
    runs: [
      ['stepped', 52, 0.64], ['mansard', 60, 0.7], ['gable', 40, 0.58], ['spire', 22, 1.0], ['mansard', 56, 0.72],
      ['flat', 48, 0.56], ['stepped', 50, 0.66], ['mansard', 64, 0.68], ['gable', 36, 0.6], ['mansard', 58, 0.7],
    ],
  },
};

/** The Prism Tower's azimuth (FURNITURE.tower at (0, −64): −Z = u 0.75) and the low-roof half-width kept around it. */
const TOWER_U = 0.75;
const TOWER_CLEAR_U = 0.035;
const TOWER_CLEAR_HEIGHT = 0.52;

function fmt(v) {
  return Number(v.toFixed(2));
}

/**
 * One building profile as an SVG polygon point list in atlas px (y down),
 * from its left edge `x0`, width `w` px and peak height `h` px, `H` the atlas height.
 */
function profile(kind, x0, w, h, H) {
  const base = H;
  const top = H - h;
  const x1 = x0 + w;
  const pts = [[x0, base]];
  switch (kind) {
    case 'mansard': {
      const eave = H - h * 0.78;
      const inset = w * 0.12;
      pts.push([x0, eave], [x0 + inset, top], [x1 - inset, top], [x1, eave], [x1, base]);
      // Chimney stacks on the roof ridge, left and right third.
      const stacks = [];
      for (const f of [0.3, 0.7]) {
        const cx = x0 + w * f;
        const sw = Math.max(3, w * 0.09);
        stacks.push([[cx - sw / 2, top + 1], [cx - sw / 2, top - h * 0.1], [cx + sw / 2, top - h * 0.1], [cx + sw / 2, top + 1]]);
      }
      return [pts, ...stacks];
    }
    case 'stepped': {
      const a = H - h * 0.72;
      const b = H - h * 0.88;
      pts.push([x0, a], [x0 + w * 0.2, a], [x0 + w * 0.2, b], [x0 + w * 0.38, b], [x0 + w * 0.38, top], [x1 - w * 0.3, top], [x1 - w * 0.3, a], [x1, a], [x1, base]);
      return [pts];
    }
    case 'gable': {
      const eave = H - h * 0.7;
      pts.push([x0, eave], [x0 + w / 2, top], [x1, eave], [x1, base]);
      return [pts];
    }
    case 'flat': {
      pts.push([x0, top], [x1, top], [x1, base]);
      return [pts];
    }
    case 'dome': {
      // Drum to 55 %, dome to 90 %, lantern to the top.
      const drum = H - h * 0.55;
      const domeTop = H - h * 0.9;
      const cx = x0 + w / 2;
      const r = w * 0.36;
      pts.push([x0, H - h * 0.4], [cx - r, H - h * 0.4], [cx - r, drum]);
      for (let i = 0; i <= 16; i += 1) {
        const a = Math.PI - (i / 16) * Math.PI;
        pts.push([cx + Math.cos(a) * r, drum - Math.sin(a) * (drum - domeTop)]);
      }
      pts.push([cx + r, H - h * 0.4], [x1, H - h * 0.4], [x1, base]);
      const lantern = [[cx - w * 0.05, domeTop + 2], [cx - w * 0.05, top + h * 0.03], [cx, top], [cx + w * 0.05, top + h * 0.03], [cx + w * 0.05, domeTop + 2]];
      return [pts, lantern];
    }
    case 'spire': {
      const tower = H - h * 0.62;
      const cx = x0 + w / 2;
      pts.push([x0, H - h * 0.45], [cx - w * 0.22, H - h * 0.45], [cx - w * 0.22, tower], [cx, top], [cx + w * 0.22, tower], [cx + w * 0.22, H - h * 0.45], [x1, H - h * 0.45], [x1, base]);
      return [pts];
    }
    default:
      throw new Error(`unknown kind ${kind}`);
  }
}

/** Every polygon of one band, in atlas px, drawn twice across the seam so it wraps. */
export function bandPolygons(bandId, atlas, layer, layerHeight) {
  const band = BANDS[bandId];
  const W = atlas.width;
  const H = atlas.height;
  const pxPerM = W / (2 * Math.PI * layer.radius);
  const polys = [];
  const windows = [];
  let x = band.start * W;
  let i = 0;
  while (x < band.start * W + W) {
    const [authored, widthM, authoredShare] = band.runs[i % band.runs.length];
    // Landmarks (domes, the spire) exist ONCE: a run list that wraps past the
    // full circle repeats them as ordinary mansard blocks at a block height.
    const repeatLandmark = i >= band.runs.length && (authored === 'dome' || authored === 'spire');
    const kind = repeatLandmark ? 'mansard' : authored;
    const share = repeatLandmark ? 0.72 : authoredShare;
    const w = widthM * pxPerM;
    const centreU = ((x + w / 2) / W) % 1;
    const nearTower = Math.min(Math.abs(centreU - TOWER_U), 1 - Math.abs(centreU - TOWER_U)) < TOWER_CLEAR_U;
    const effKind = nearTower && (kind === 'dome' || kind === 'spire') ? 'flat' : kind;
    const h = (nearTower ? Math.min(share, TOWER_CLEAR_HEIGHT) : share) * H;
    // 0.75 px of overlap each side: neighbours share no anti-aliased seam.
    for (const shift of [0, -W]) {
      for (const poly of profile(effKind, x + shift - 0.75, w + 1.5, h, H)) polys.push(poly);
    }
    windows.push({ x0: x, w, h, kind: effKind, index: i });
    x += w;
    i += 1;
  }
  return { polys, windows, pxPerM: { x: pxPerM, y: H / layerHeight } };
}

function svgFor(polys, atlas) {
  const body = polys
    .map((poly) => `<polygon points="${poly.map(([px, py]) => `${fmt(px)},${fmt(py)}`).join(' ')}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${atlas.width}" height="${atlas.height}" viewBox="0 0 ${atlas.width} ${atlas.height}"><rect width="100%" height="100%" fill="#000"/><g fill="#fff" shape-rendering="geometricPrecision">${body}</g></svg>`;
}

function hash(a, b, seed) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Build the atlas raster. `faceRects` is a predicate (u, v) → true when the
 * near-band point at that uv falls inside any padded face rect from any pose.
 */
export async function buildSkyline({ atlas, heightOf, isMasked }) {
  const W = atlas.width;
  const H = atlas.height;
  const out = new Uint8Array(W * H * 4);
  let nearWindows = null;
  let nearScale = null;
  for (const layer of atlas.layers) {
    const { polys, windows, pxPerM } = bandPolygons(layer.id, atlas, layer, heightOf(layer.radius));
    if (layer.id === 'near') {
      nearWindows = windows;
      nearScale = pxPerM;
    }
    const raw = await sharp(Buffer.from(svgFor(polys, atlas)), { density: 72 }).removeAlpha().raw().toBuffer();
    for (let i = 0; i < W * H; i += 1) out[i * 4 + layer.channel] = raw[i * 3];
  }
  // Night windows: near band, a floor grid (3.4 m floors, 3.2 m bays) under each roofline.
  let lit = 0;
  let masked = 0;
  const floorPx = 3.4 * nearScale.y;
  const bayPx = 3.2 * nearScale.x;
  const winW = Math.max(1, Math.round(1.1 * nearScale.x));
  const winH = Math.max(2, Math.round(1.5 * nearScale.y));
  for (const b of nearWindows) {
    if (b.kind === 'dome' || b.kind === 'spire') continue;
    const eave = b.kind === 'flat' ? b.h - floorPx * 0.6 : b.h * 0.72;
    const floors = Math.floor(eave / floorPx);
    const bays = Math.floor(b.w / bayPx);
    for (let f = 1; f < floors; f += 1) {
      for (let k = 0; k < bays; k += 1) {
        if (hash(b.index * 97 + k, f, 17) >= WINDOW_LIT_SHARE) continue;
        const cx = b.x0 + (k + 0.5) * (b.w / bays);
        const cy = H - f * floorPx - floorPx * 0.45;
        const u = (((cx / W) % 1) + 1) % 1;
        const v = 1 - cy / H;
        if (isMasked(u, v)) {
          masked += 1;
          continue;
        }
        lit += 1;
        for (let dy = -Math.floor(winH / 2); dy < Math.ceil(winH / 2); dy += 1) {
          for (let dx = -Math.floor(winW / 2); dx < Math.ceil(winW / 2); dx += 1) {
            const px = ((Math.round(cx) + dx) % W + W) % W;
            const py = Math.round(cy) + dy;
            if (py < 0 || py >= H) continue;
            const i = (py * W + px) * 4;
            if (out[i] === 255) out[i + 3] = 255; // inside the near silhouette only
          }
        }
      }
    }
  }
  return { width: W, height: H, data: out, lit, masked };
}

export async function encodeSkyline(raster) {
  return sharp(Buffer.from(raster.data), { raw: { width: raster.width, height: raster.height, channels: 4 } })
    .webp({ lossless: true, exact: true, effort: 6 })
    .toBuffer();
}

/** The keep-out mask for the near band (tsx: imports the TypeScript face tables). */
export async function plazaSkylineMask() {
  const { PLAZA_DATA_SURFACES } = await import('../../src/components/world/evoliga/route/plaza/data-faces.ts');
  const { faceKeepOutPoses, paddedFaceRect, screenPoint } = await import('../../src/lib/route-world/data-surfaces.ts');
  const { PLAZA_SKYLINE_ATLAS, skylineLayerHeight, skylineWorldPoint } = await import('../../src/lib/route-world/world-env.ts');
  const zones = [];
  for (const face of PLAZA_DATA_SURFACES.faces) {
    for (const pose of faceKeepOutPoses(PLAZA_DATA_SURFACES, face)) {
      const rect = paddedFaceRect(face, pose.camera, pose.viewport);
      if (rect) zones.push({ pose, rect });
    }
  }
  const near = PLAZA_SKYLINE_ATLAS.layers.find((l) => l.id === 'near');
  // Half a window (≈ 0.6 m) of slack so a dot's footprint, not just its centre, clears the rect.
  const slackU = 0.6 / (2 * Math.PI * near.radius);
  const slackV = 0.8 / skylineLayerHeight(near.radius);
  /** Is the near-band point at (u, v) inside any padded face rect from any pose? */
  const isInsideRect = (u, v) => {
    const p = skylineWorldPoint(near.radius, u, v);
    for (const { pose, rect } of zones) {
      const s = screenPoint(p, pose.camera, pose.viewport);
      if (s && s.x >= rect.x && s.x <= rect.x + rect.w && s.y >= rect.y && s.y <= rect.y + rect.h) return true;
    }
    return false;
  };
  const isMasked = (u, v) =>
    [
      [0, 0],
      [-slackU, -slackV],
      [slackU, -slackV],
      [-slackU, slackV],
      [slackU, slackV],
    ].some(([du, dv]) => isInsideRect(u + du, v + dv));
  return { atlas: PLAZA_SKYLINE_ATLAS, heightOf: skylineLayerHeight, isMasked, isInsideRect, zones: zones.length };
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const { MIRROR_DIR, OUT_ENV_DIR, ensureDir, log } = await import('./lib.mjs');
  const envDir = process.argv.includes('--out') ? OUT_ENV_DIR : join(MIRROR_DIR, 'env');
  const dir = join(envDir, 'plaza');
  ensureDir(dir);
  const mask = await plazaSkylineMask();
  const raster = await buildSkyline(mask);
  const bytes = await encodeSkyline(raster);
  const file = join(dir, 'skyline.webp');
  writeFileSync(file, bytes);
  log(
    `plaza skyline ${raster.width}×${raster.height} → ${file} ${Math.round(statSync(file).size / 1024)} KB; ` +
      `${raster.lit} lit windows, ${raster.masked} masked by ${mask.zones} face-rect zones; ` +
      `raw sha256 ${sha256(raster.data).slice(0, 16)}, file sha256 ${sha256(bytes).slice(0, 16)}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
