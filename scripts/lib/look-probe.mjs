#!/usr/bin/env node
/**
 * LOOK pilot round 6 (D28), SEAT H8: the look probe — the R6-BRIEF §6
 * target-frame metrics measured on a still's final PNG, so the ART
 * DIRECTOR's acceptance numbers come from the harness instead of by eye:
 *
 *  - façade patches (L1, L3): per building, a CIELAB / HSV read of stone
 *    piers on the piano nobile and the podium; adjacent-block ΔE76 and
 *    value step, mean façade saturation, the podium-to-piano-nobile step;
 *  - recession (L5): median chroma of near (<= 25 m) vs far (> 25 m) patches;
 *  - cast vs lit ground (L2): the plaza floor split at its Otsu L* threshold,
 *    the sat-weighted HSV hue of each side and the L step;
 *  - canopy rims (L4b / L6.3): per crown, the rim (brightest 15 %) hue and
 *    R >= G share, the core (darkest 50 %) vs rim lightness, the mean hue / sat;
 *  - night streaks (L6.2): bright connected components on the rules
 *    forecourt, their count and aspect (height / width);
 *  - board vs world (L6.4): data-face luma P50 vs the world P99 with the
 *    lamp and lantern cores left out;
 *  - sky-gap flat area (L5): the largest connected region of flat bright
 *    16 px tiles (L* > 85, std < 2) as a share of the frame.
 *
 * The patch geometry is WORLD-SPACE quads mirrored from the plaza plan
 * (haussmann.ts plazaBlockPlans, tree-skin.ts plazaCanopies, plaza-emitters.ts
 * lamps; pinned by scripts/__tests__/look-probe.test.mjs) and projected per
 * still through the sidecar's cameraPose (the __routeWorldCamera convention:
 * yaw = atan2(fx, -fz), pitch = asin(fy), vertical fov). Data faces, figure
 * rects, the HUD band, the Station Card and DOM chrome are masked out.
 * Every number is REPORTED against the brief's bar, never judged: the run
 * never fails on a look metric.
 *
 *   node scripts/lib/look-probe.mjs <still.png> [<still.png> ...] [--json <out.json>] [--overlay <dir>]
 *
 * Offline: reads each still's sidecar (<still>.json: cameraPose, hud,
 * stationCard, lumaInputs / diffRects). --overlay writes <name>-probe.png
 * with the projected patches outlined (a projection self-check).
 * Exit 0 = probed, 2 = usage / unreadable input.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { MASK, buildLumaMask } from './w1-evidence.mjs';
import { stationCardMaskOf } from './look-r6-evidence.mjs';

// ---------------------------------------------------------------------------
// Plaza geometry (mirrors of src/lib/route-world; pinned by the test)
// ---------------------------------------------------------------------------

/** layout.ts PLAZA.half. */
export const PLAZA_HALF = 18;
/** haussmann.ts HAUSSMANN (the dimensions the patches use). */
export const HAUSSMANN_DIMS = { bayWidth: 2.55, floorHeight: 3.2, podiumHeight: 3.55, sill: 0.92, windowH: 1.62 };

/**
 * plazaBlockPlans(PLAZA.half): origin, rotation, bays, depth, reserved bay
 * ranges (end exclusive) and the LED bay ranges of ledSpecs (end exclusive).
 */
export const PLAZA_BLOCKS = [
  { id: 'north', origin: [0, 0, -PLAZA_HALF - 2.2], rotationY: 0, widthBays: 16, depth: 4.4, upperFloors: 1, reserved: [{ startBay: 4, endBay: 12 }], led: [] },
  { id: 'west', origin: [-(PLAZA_HALF + 2.4), 0, 0], rotationY: Math.PI / 2, widthBays: 12, depth: 4.8, upperFloors: 1, reserved: [{ startBay: 4, endBay: 8 }], led: [] },
  { id: 'east', origin: [PLAZA_HALF + 2.4, 0, 0], rotationY: -Math.PI / 2, widthBays: 12, depth: 4.8, upperFloors: 1, reserved: [], led: [{ startBay: 6, endBay: 9 }] },
  { id: 'south-west', origin: [-10.5, 0, PLAZA_HALF + 2], rotationY: Math.PI, widthBays: 5, depth: 4, upperFloors: 1, reserved: [], led: [{ startBay: 2, endBay: 4 }] },
  { id: 'south-east', origin: [10.5, 0, PLAZA_HALF + 2], rotationY: Math.PI, widthBays: 5, depth: 4, upperFloors: 1, reserved: [], led: [] },
];

/** Adjacent block pairs judged for the L1 hue / value split. */
export const ADJACENT_BLOCKS = [
  ['north', 'west'],
  ['north', 'east'],
  ['west', 'south-west'],
  ['east', 'south-east'],
  ['south-west', 'south-east'],
];

/** haussmann.ts blockToWorld (three's rotation about +Y). */
export function blockToWorld(plan, x, y, z) {
  const c = Math.cos(plan.rotationY);
  const s = Math.sin(plan.rotationY);
  return [plan.origin[0] + x * c + z * s, plan.origin[1] + y, plan.origin[2] - x * s + z * c];
}

/** Pier half-widths (m) and heights of the two patch kinds. */
export const PATCH_KINDS = {
  // Piano nobile pier between two windows (window 3.55 + 0.92 .. + 1.62).
  pier: { halfW: 0.35, y0: 3.9, y1: 6.4 },
  // Podium pier between two shopfronts.
  podium: { halfW: 0.25, y0: 0.7, y1: 3.0 },
};

const inRanges = (bay, ranges) => ranges.some((r) => bay >= r.startBay && bay < r.endBay);

/**
 * Stone pier quads on every façade: at each bay boundary k (1..N-1) whose two
 * neighbouring bays are neither reserved (the through-voids) nor LED bays.
 * Each quad lies 3 cm proud of the façade plane (local z = depth / 2).
 */
export function facadePatches(blocks = PLAZA_BLOCKS) {
  const out = [];
  for (const plan of blocks) {
    const halfW = (plan.widthBays * HAUSSMANN_DIMS.bayWidth) / 2;
    const z = plan.depth / 2 + 0.03;
    for (let k = 1; k < plan.widthBays; k += 1) {
      const blocked = [k - 1, k].some((bay) => inRanges(bay, plan.reserved) || inRanges(bay, plan.led));
      if (blocked) continue;
      const x = -halfW + k * HAUSSMANN_DIMS.bayWidth;
      for (const [kind, dims] of Object.entries(PATCH_KINDS)) {
        const corners = [
          blockToWorld(plan, x - dims.halfW, dims.y0, z),
          blockToWorld(plan, x + dims.halfW, dims.y0, z),
          blockToWorld(plan, x + dims.halfW, dims.y1, z),
          blockToWorld(plan, x - dims.halfW, dims.y1, z),
        ];
        out.push({ id: `${plan.id}:${kind}:${k}`, block: plan.id, kind, bay: k, corners, center: blockToWorld(plan, x, (dims.y0 + dims.y1) / 2, z) });
      }
    }
  }
  return out;
}

/** Ground quads (y = 1 cm): the whole plaza floor and the rules forecourt before the gate. */
export const GROUND_QUADS = {
  'plaza-floor': [[-17.5, 0.01, -17.5], [17.5, 0.01, -17.5], [17.5, 0.01, 17.5], [-17.5, 0.01, 17.5]],
  // FURNITURE.gate z 16.4, GATE.depth 1.8: the forecourt ends at the gate's north face.
  'rules-forecourt': [[-7, 0.01, 6], [7, 0.01, 6], [7, 0.01, 15.4], [-7, 0.01, 15.4]],
};

/** tree-skin.ts plazaCanopies() (world crown spheres), rounded to mm. */
export const PLAZA_CROWNS = [
  { id: 'linden:-6,8', center: [-6.178, 4.188, 8.068], radius: 2.832 },
  { id: 'plane:6,8', center: [6.079, 4.01, 8.045], radius: 2.615 },
  { id: 'linden:-9,14', center: [-8.994, 4.643, 13.913], radius: 2.754 },
  { id: 'linden:9,14', center: [9.006, 4.643, 13.913], radius: 2.754 },
];

/**
 * Lamp and lantern cores as world spheres: the PLAZA_LAMP_SEATS street lamps
 * (x, z from teams-formation.ts; the glass globe renders at about 2.9 m and
 * the emitter band is 3.8..4.4 m, so one sphere covers 1.9..4.3 m — measured
 * on look-after-r5-r0-dark-1440-rules) and the gate lanterns (plaza-emitters.ts).
 */
export const LAMP_CORES = [
  ...[[-10.6, -13.4], [10.6, -13.4], [-7.6, 12.6], [7.6, 12.6], [12.2, -5.2], [12.2, 5.2]].map(([x, z]) => ({ id: `lamp:${x},${z}`, center: [x, 3.1, z], radius: 1.2 })),
  { id: 'gate-lamp:left', center: [-3.8, 7.25, 15.65], radius: 0.55 },
  { id: 'gate-lamp:right', center: [3.8, 7.25, 15.65], radius: 0.55 },
];

// ---------------------------------------------------------------------------
// Camera + projection (the __routeWorldCamera convention)
// ---------------------------------------------------------------------------

/**
 * A roll-free camera from a sidecar pose ({ camPos, yawRad | yaw, pitchRad |
 * pitch, fov }) and the viewport CSS size. Null when the pose is unusable.
 */
export function cameraOf(pose, { width, height }) {
  const camPos = Array.isArray(pose?.camPos) ? pose.camPos : null;
  const yaw = typeof pose?.yawRad === 'number' ? pose.yawRad : pose?.yaw;
  const pitch = typeof pose?.pitchRad === 'number' ? pose.pitchRad : pose?.pitch;
  const fov = pose?.fov;
  if (!camPos || camPos.length < 3 || !Number.isFinite(yaw) || !Number.isFinite(pitch) || !(fov > 0) || !(width > 0) || !(height > 0)) return null;
  const cp = Math.cos(pitch);
  const f = [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  let r = [-f[2], 0, f[0]];
  const rl = Math.hypot(r[0], r[1], r[2]) || 1;
  r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const tanHalf = Math.tan((fov * Math.PI) / 360);
  return { camPos: camPos.slice(0, 3), f, r, u, tanHalf, aspect: width / height, width, height, focalPx: height / 2 / tanHalf };
}

/** World point -> camera space [x (right), y (up), z (depth along the view)]. */
export function toCamera(cam, p) {
  const d = [p[0] - cam.camPos[0], p[1] - cam.camPos[1], p[2] - cam.camPos[2]];
  return [d[0] * cam.r[0] + d[1] * cam.r[1] + d[2] * cam.r[2], d[0] * cam.u[0] + d[1] * cam.u[1] + d[2] * cam.u[2], d[0] * cam.f[0] + d[1] * cam.f[1] + d[2] * cam.f[2]];
}

function camToCss(cam, c) {
  const ndcX = c[0] / c[2] / (cam.tanHalf * cam.aspect);
  const ndcY = c[1] / c[2] / cam.tanHalf;
  return { x: ((ndcX + 1) / 2) * cam.width, y: ((1 - ndcY) / 2) * cam.height, depth: c[2] };
}

/** World point -> viewport CSS px (null behind the near plane). */
export function projectPoint(cam, p, near = 0.1) {
  const c = toCamera(cam, p);
  return c[2] > near ? camToCss(cam, c) : null;
}

/**
 * A world polygon -> viewport CSS px, clipped against the near plane in
 * camera space (Sutherland-Hodgman), so a ground quad under the camera still
 * projects. [] when nothing is in front.
 */
export function projectPolygon(cam, points, near = 0.1) {
  const cs = points.map((p) => toCamera(cam, p));
  const clipped = [];
  for (let i = 0; i < cs.length; i += 1) {
    const a = cs[i];
    const b = cs[(i + 1) % cs.length];
    const aIn = a[2] > near;
    const bIn = b[2] > near;
    if (aIn) clipped.push(a);
    if (aIn !== bIn) {
      const t = (near - a[2]) / (b[2] - a[2]);
      clipped.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), near]);
    }
  }
  return clipped.length >= 3 ? clipped.map((c) => camToCss(cam, c)) : [];
}

/**
 * Frame-pixel indices inside a CSS-px polygon (scaled by `scale`), sampled
 * at pixel centres with the even-odd rule, clipped to the frame.
 */
export function polygonPixels(poly, { width, height, scale = 1 }) {
  if (!Array.isArray(poly) || poly.length < 3) return [];
  const pts = poly.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const out = [];
  const ys = Math.max(0, Math.floor(y0));
  const ye = Math.min(height - 1, Math.ceil(y1));
  for (let y = ys; y <= ye; y += 1) {
    const cy = y + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = Math.max(0, Math.ceil(xs[i] - 0.5));
      const x1 = Math.min(width - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = x0; x <= x1; x += 1) out.push(y * width + x);
    }
  }
  return out;
}

/** Frame-pixel indices of a projected world sphere's disc (radius = r * focal / depth). */
export function spherePixels(cam, sphere, { width, height, scale = 1 }) {
  const c = projectPoint(cam, sphere.center);
  if (!c) return { pixels: [], center: null, radiusPx: 0 };
  const rPx = ((sphere.radius * cam.focalPx) / c.depth) * scale;
  const cx = c.x * scale;
  const cy = c.y * scale;
  const out = [];
  const y0 = Math.max(0, Math.floor(cy - rPx));
  const y1 = Math.min(height - 1, Math.ceil(cy + rPx));
  for (let y = y0; y <= y1; y += 1) {
    const dy = y + 0.5 - cy;
    const half = Math.sqrt(Math.max(0, rPx * rPx - dy * dy));
    const x0 = Math.max(0, Math.ceil(cx - half - 0.5));
    const x1 = Math.min(width - 1, Math.floor(cx + half - 0.5));
    for (let x = x0; x <= x1; x += 1) out.push(y * width + x);
  }
  return { pixels: out, center: { x: +cx.toFixed(1), y: +cy.toFixed(1) }, radiusPx: +rPx.toFixed(1), depth: +c.depth.toFixed(2) };
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

const SRGB_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i += 1) {
  const c = i / 255;
  SRGB_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const D65 = [0.95047, 1, 1.08883];
const labF = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);

/** 8-bit sRGB -> CIELAB (D65). */
export function rgbToLab(r, g, b) {
  const R = SRGB_LINEAR[r];
  const G = SRGB_LINEAR[g];
  const B = SRGB_LINEAR[b];
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / D65[0];
  const y = (0.2126729 * R + 0.7151522 * G + 0.072175 * B) / D65[1];
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / D65[2];
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** 8-bit sRGB -> HSV (h degrees 0..360, s and v 0..1). */
export function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max];
}

/** CIE76 colour difference. */
export function deltaE76(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Rec.709 luma of 8-bit sRGB (gamma-encoded 0..255, the --luma convention). */
export const luma709 = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function median(values) {
  if (!values.length) return null;
  const s = Float64Array.from(values).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(values, p) {
  if (!values.length) return null;
  const s = Float64Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}

/** Saturation-weighted circular mean of HSV hues (degrees), null when every pixel is grey. */
export function circularHue(hues, weights) {
  let x = 0;
  let y = 0;
  let w = 0;
  for (let i = 0; i < hues.length; i += 1) {
    const wt = weights ? weights[i] : 1;
    if (!(wt > 0)) continue;
    const rad = (hues[i] * Math.PI) / 180;
    x += Math.cos(rad) * wt;
    y += Math.sin(rad) * wt;
    w += wt;
  }
  if (!(w > 0) || Math.hypot(x, y) / w < 1e-3) return null;
  let deg = (Math.atan2(y, x) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  const rounded = +deg.toFixed(1);
  return rounded >= 360 ? 0 : rounded;
}

const r2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : +v.toFixed(2));
const r3 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : +v.toFixed(3));

/** Colour statistics of a pixel set (indices into a raw image). */
export function pixelStats(img, indices) {
  const c = img.channels ?? 3;
  const L = [];
  const A = [];
  const Bv = [];
  const chroma = [];
  const hue = [];
  const sat = [];
  let vSum = 0;
  let sSum = 0;
  let lumaSum = 0;
  let rGe = 0;
  for (const idx of indices) {
    const o = idx * c;
    const r = img.data[o];
    const g = img.data[o + 1];
    const b = img.data[o + 2];
    const lab = rgbToLab(r, g, b);
    const hsv = rgbToHsv(r, g, b);
    L.push(lab[0]);
    A.push(lab[1]);
    Bv.push(lab[2]);
    chroma.push(Math.hypot(lab[1], lab[2]));
    hue.push(hsv[0]);
    sat.push(hsv[1]);
    vSum += hsv[2];
    sSum += hsv[1];
    lumaSum += luma709(r, g, b);
    if (r >= g) rGe += 1;
  }
  const n = indices.length;
  if (!n) return null;
  const lab = [median(L), median(A), median(Bv)];
  return {
    px: n,
    lab: lab.map(r2),
    chroma: r2(median(chroma)),
    hue: circularHue(hue, sat),
    sat: r3(sSum / n),
    value: r3(vSum / n),
    luma: r2(lumaSum / n),
    rGeShare: r3(rGe / n),
  };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Keep only OUTSIDE pixels of the mask (faces, figures, HUD, card and chrome left out). */
function keepOutside(indices, mask) {
  const out = [];
  for (const i of indices) if (mask[i] === MASK.OUTSIDE) out.push(i);
  return out;
}

/** Minimum measured pixels (frame px) and visible share for a patch to count. */
export const PATCH_MIN_PX = 40;
export const PATCH_MIN_VISIBLE = 0.5;
/** Far façades begin here (m, R6-BRIEF L5). */
export const FAR_FACADE_M = 25;

/**
 * Façade patches (L1 / L3 / L5): per patch the projected polygon, its visible
 * pixels and colour stats; per block the median of its visible pier patches;
 * the adjacent-block ΔE76 / value step; the mean façade saturation; the
 * podium -> piano nobile value step; near / far chroma.
 */
export function facadeMetrics(img, mask, cam, { scale = 1 } = {}) {
  const patches = [];
  for (const p of facadePatches()) {
    const poly = projectPolygon(cam, p.corners);
    if (!poly.length) continue;
    const all = polygonPixels(poly, { width: img.width, height: img.height, scale });
    if (!all.length) continue;
    const kept = keepOutside(all, mask);
    const depth = Math.hypot(p.center[0] - cam.camPos[0], p.center[1] - cam.camPos[1], p.center[2] - cam.camPos[2]);
    const visible = kept.length / all.length;
    const stats = kept.length >= PATCH_MIN_PX && visible >= PATCH_MIN_VISIBLE ? pixelStats(img, kept) : null;
    patches.push({ id: p.id, block: p.block, kind: p.kind, depthM: r2(depth), polygonPx: all.length, visibleShare: r3(visible), used: stats !== null, ...(stats ? { stats } : {}), poly: poly.map((q) => ({ x: r2(q.x * scale), y: r2(q.y * scale) })) });
  }
  const used = patches.filter((p) => p.used);
  const aggregate = (list) => {
    if (!list.length) return null;
    const lab = [median(list.map((p) => p.stats.lab[0])), median(list.map((p) => p.stats.lab[1])), median(list.map((p) => p.stats.lab[2]))];
    return {
      patches: list.length,
      lab: lab.map(r2),
      chroma: r2(median(list.map((p) => p.stats.chroma))),
      hue: circularHue(list.map((p) => p.stats.hue ?? 0), list.map((p) => (p.stats.hue === null ? 0 : p.stats.sat))),
      sat: r3(list.reduce((s, p) => s + p.stats.sat, 0) / list.length),
      value: r3(list.reduce((s, p) => s + p.stats.value, 0) / list.length),
      depthM: r2(list.reduce((s, p) => s + p.depthM, 0) / list.length),
    };
  };
  const blocks = {};
  for (const b of PLAZA_BLOCKS) {
    const pier = aggregate(used.filter((p) => p.block === b.id && p.kind === 'pier'));
    const podium = aggregate(used.filter((p) => p.block === b.id && p.kind === 'podium'));
    if (pier || podium) {
      blocks[b.id] = {
        pier,
        podium,
        podiumStepPct: pier && podium && pier.value > 0 ? r2(((pier.value - podium.value) / pier.value) * 100) : null,
      };
    }
  }
  const adjacent = ADJACENT_BLOCKS.map(([a, b]) => {
    const pa = blocks[a]?.pier;
    const pb = blocks[b]?.pier;
    if (!pa || !pb) return null;
    const dE = deltaE76(pa.lab, pb.lab);
    const dv = Math.max(pa.value, pb.value) > 0 ? (Math.abs(pa.value - pb.value) / Math.max(pa.value, pb.value)) * 100 : 0;
    return { a, b, deltaE76: r2(dE), valueStepPct: r2(dv), meetsBar: dE >= 4 && dv >= 5 };
  }).filter(Boolean);
  const piers = used.filter((p) => p.kind === 'pier');
  const near = used.filter((p) => p.depthM <= FAR_FACADE_M);
  const far = used.filter((p) => p.depthM > FAR_FACADE_M);
  const nearChroma = near.length ? median(near.map((p) => p.stats.chroma)) : null;
  const farChroma = far.length ? median(far.map((p) => p.stats.chroma)) : null;
  return {
    patches,
    blocks,
    adjacent,
    meanSaturation: piers.length ? r3(piers.reduce((s, p) => s + p.stats.sat, 0) / piers.length) : null,
    recession: {
      farThresholdM: FAR_FACADE_M,
      nearPatches: near.length,
      farPatches: far.length,
      nearChroma: r2(nearChroma),
      farChroma: r2(farChroma),
      farBelowNearPct: nearChroma && farChroma !== null ? r2((1 - farChroma / nearChroma) * 100) : null,
    },
  };
}

/** Otsu threshold of values in [0, 100] (1-unit bins). */
export function otsu(values) {
  const hist = new Float64Array(101);
  for (const v of values) hist[Math.max(0, Math.min(100, Math.round(v)))] += 1;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i <= 100; i += 1) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 50;
  for (let t = 0; t <= 100; t += 1) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t + 0.5;
    }
  }
  return threshold;
}

/**
 * Cast vs lit ground (L2): the plaza floor's visible pixels split at their
 * Otsu L* threshold; cast = the darker side. Reports each side's
 * sat-weighted HSV hue, median L* and share, and the L step (cast - lit) / 100.
 */
export function groundCastLit(img, mask, cam, { scale = 1 } = {}) {
  const poly = projectPolygon(cam, GROUND_QUADS['plaza-floor']);
  const kept = keepOutside(polygonPixels(poly, { width: img.width, height: img.height, scale }), mask);
  if (kept.length < 200) return { verdict: 'unmeasured', reason: `only ${kept.length} visible floor pixels` };
  const c = img.channels ?? 3;
  const Ls = kept.map((i) => rgbToLab(img.data[i * c], img.data[i * c + 1], img.data[i * c + 2])[0]);
  const t = otsu(Ls);
  const cast = [];
  const lit = [];
  kept.forEach((idx, k) => (Ls[k] < t ? cast : lit).push(idx));
  const cs = pixelStats(img, cast);
  const ls = pixelStats(img, lit);
  return {
    verdict: cs && ls ? 'measured' : 'unmeasured',
    thresholdL: t,
    px: kept.length,
    cast: cs ? { share: r3(cast.length / kept.length), hue: cs.hue, L: cs.lab[0], sat: cs.sat } : null,
    lit: ls ? { share: r3(lit.length / kept.length), hue: ls.hue, L: ls.lab[0], sat: ls.sat } : null,
    castMinusLitL: cs && ls ? r3((cs.lab[0] - ls.lab[0]) / 100) : null,
    bar: 'R6-BRIEF L2: cast hue 200-240 deg, lit hue 30-50 deg, L step about -0.25 (rules / teams light 1440)',
    note: 'props, plinths and lamp posts standing on the floor are not masked (only faces, figures and DOM chrome are)',
  };
}

/** A crown pixel within this CIE76 distance of a visible façade median is taken for stone, not leaf. */
export const CANOPY_STONE_DE = 12;

/**
 * Canopy crowns (L4b / L6.3): per visible crown disc, the rim (brightest 15 %
 * of L*) hue and R >= G share, the core (darkest 50 %) L* vs the rim's, the
 * mean hue and saturation. Sky-blue and near-white pixels are left out, and
 * so is stone: a pixel within CANOPY_STONE_DE of any visible block's pier or
 * podium median (`stoneLabs`, from facadeMetrics) — the crown disc is a
 * bounding sphere, so façade behind the leaves would otherwise read as rim.
 */
export function canopyMetrics(img, mask, cam, { scale = 1, stoneLabs = [] } = {}) {
  const c = img.channels ?? 3;
  const crowns = [];
  for (const crown of PLAZA_CROWNS) {
    const disc = spherePixels(cam, crown, { width: img.width, height: img.height, scale });
    if (!disc.pixels.length) continue;
    let stone = 0;
    const kept = keepOutside(disc.pixels, mask).filter((i) => {
      const r = img.data[i * c];
      const g = img.data[i * c + 1];
      const b = img.data[i * c + 2];
      const [h, s, v] = rgbToHsv(r, g, b);
      const sky = h >= 190 && h <= 250 && v > 0.55;
      const white = s < 0.08 && v > 0.9;
      if (sky || white) return false;
      if (stoneLabs.length) {
        const lab = rgbToLab(r, g, b);
        if (stoneLabs.some((s0) => deltaE76(lab, s0) < CANOPY_STONE_DE)) {
          stone += 1;
          return false;
        }
      }
      return true;
    });
    if (kept.length < 60) {
      crowns.push({ id: crown.id, used: false, px: kept.length, stoneRejected: stone, center: disc.center, radiusPx: disc.radiusPx });
      continue;
    }
    const withL = kept.map((i) => ({ i, L: rgbToLab(img.data[i * c], img.data[i * c + 1], img.data[i * c + 2])[0] })).sort((a, b) => a.L - b.L);
    const core = withL.slice(0, Math.floor(withL.length * 0.5)).map((x) => x.i);
    const rim = withL.slice(Math.floor(withL.length * 0.85)).map((x) => x.i);
    const all = pixelStats(img, kept);
    const cs = pixelStats(img, core);
    const rs = pixelStats(img, rim);
    crowns.push({
      id: crown.id,
      used: true,
      center: disc.center,
      radiusPx: disc.radiusPx,
      depthM: disc.depth,
      px: kept.length,
      stoneRejected: stone,
      meanHue: all.hue,
      meanSat: all.sat,
      rim: { hue: rs.hue, L: rs.lab[0], rGeShare: rs.rGeShare, sat: rs.sat },
      core: { hue: cs.hue, L: cs.lab[0], sat: cs.sat },
      coreVsRimL: rs.lab[0] > 0 ? r3(cs.lab[0] / rs.lab[0]) : null,
    });
  }
  return {
    crowns,
    bar: 'R6-BRIEF L4b (rules light 1440): rim hue 35-50 deg with R >= G, core >= 25 % darker than the rim (coreVsRimL <= 0.75); L6.3 (night): canopy mean hue 120-170 deg with sat >= 0.18',
  };
}

/** Connected components (8-neighbour) of a binary frame mask, as bounding boxes. */
export function components(bin, width, height) {
  const label = new Int32Array(width * height);
  const out = [];
  let next = 1;
  const stack = [];
  for (let s = 0; s < bin.length; s += 1) {
    if (!bin[s] || label[s]) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let area = 0;
    label[s] = next;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      const x = i % width;
      const y = (i - x) / width;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (bin[j] && !label[j]) {
            label[j] = next;
            stack.push(j);
          }
        }
      }
    }
    out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
    next += 1;
  }
  return out;
}

/**
 * Night streaks (L6.2): the rules forecourt's bright pixels (L* above
 * max(its P97, mean + 2 sd, 35)) grouped into connected components; a
 * streak is at least 10 frame px tall (x scale) with height / width >= 3.
 */
export function nightStreaks(img, mask, cam, { scale = 1 } = {}) {
  const poly = projectPolygon(cam, GROUND_QUADS['rules-forecourt']);
  const kept = keepOutside(polygonPixels(poly, { width: img.width, height: img.height, scale }), mask);
  if (kept.length < 200) return { verdict: 'unmeasured', reason: `only ${kept.length} visible forecourt pixels (not the rules pose?)` };
  const c = img.channels ?? 3;
  const Ls = kept.map((i) => rgbToLab(img.data[i * c], img.data[i * c + 1], img.data[i * c + 2])[0]);
  const mean = Ls.reduce((s, v) => s + v, 0) / Ls.length;
  const sd = Math.sqrt(Ls.reduce((s, v) => s + (v - mean) ** 2, 0) / Ls.length);
  const threshold = Math.max(percentile(Ls, 0.97), mean + 2 * sd, 35);
  const bin = new Uint8Array(img.width * img.height);
  kept.forEach((idx, k) => {
    if (Ls[k] >= threshold) bin[idx] = 1;
  });
  const minH = Math.max(10, Math.round(10 * scale));
  const blobs = components(bin, img.width, img.height).filter((b) => b.area >= 12);
  const tall = blobs.filter((b) => b.h >= minH).map((b) => ({ ...b, aspect: r2(b.h / b.w) })).sort((a, b) => b.h - a.h);
  const streaks = tall.filter((b) => b.aspect >= 3);
  return {
    verdict: 'measured',
    thresholdL: r2(threshold),
    px: kept.length,
    components: blobs.length,
    streakCount: streaks.length,
    streaks: streaks.slice(0, 8),
    tallest: tall.slice(0, 8),
    bar: 'R6-BRIEF L6.2 (rules dark 1440 / 390): >= 2 distinct vertical streaks under the gate lamps, each >= 3x longer than wide',
  };
}

/**
 * Board vs world (L6.4): Rec.709 luma P50 of the data-face pixels vs the
 * P99 of the world pixels, with the projected lamp / lantern cores left out.
 */
export function boardVsWorld(img, mask, cam, { scale = 1 } = {}) {
  const c = img.channels ?? 3;
  const face = [];
  const world = [];
  const lampSet = new Set();
  if (cam) for (const core of LAMP_CORES) for (const i of spherePixels(cam, core, { width: img.width, height: img.height, scale }).pixels) lampSet.add(i);
  const worldEx = [];
  for (let i = 0; i < mask.length; i += 1) {
    const l = luma709(img.data[i * c], img.data[i * c + 1], img.data[i * c + 2]);
    if (mask[i] === MASK.FACE) face.push(l);
    else if (mask[i] === MASK.OUTSIDE) {
      world.push(l);
      if (!lampSet.has(i)) worldEx.push(l);
    }
  }
  if (face.length < 64) return { verdict: 'unmeasured', reason: 'no data-face pixels in the frame (face rects missing: shoot with --luma on or --diff-against)' };
  const boardP50 = percentile(face, 0.5);
  const worldP99 = percentile(world, 0.99);
  const worldP99ExLamps = percentile(worldEx, 0.99);
  return {
    verdict: 'measured',
    boardP50: r2(boardP50),
    worldP99: r2(worldP99),
    worldP99ExLamps: r2(worldP99ExLamps),
    lampCorePx: lampSet.size,
    boardFirst: boardP50 >= worldP99ExLamps,
    bar: 'R6-BRIEF L6.4 / §6 night: every world pixel outside the lamp cores below the board P50 (boardP50 >= worldP99ExLamps)',
  };
}

/**
 * Sky-gap flat area (L5): 16 CSS-px tiles of world pixels whose L* mean is
 * above 85 with a standard deviation below 2 (L 0..1: > 0.85, < 0.02);
 * the largest 4-connected region of such tiles as a share of the frame.
 */
export function skyGapFlat(img, mask, { scale = 1, tileCss = 16 } = {}) {
  const c = img.channels ?? 3;
  const tile = Math.max(4, Math.round(tileCss * scale));
  const cols = Math.floor(img.width / tile);
  const rows = Math.floor(img.height / tile);
  const flat = new Uint8Array(cols * rows);
  let flatTiles = 0;
  for (let ty = 0; ty < rows; ty += 1) {
    for (let tx = 0; tx < cols; tx += 1) {
      let n = 0;
      let sum = 0;
      let sq = 0;
      for (let y = ty * tile; y < (ty + 1) * tile; y += 1) {
        for (let x = tx * tile; x < (tx + 1) * tile; x += 1) {
          const i = y * img.width + x;
          if (mask[i] !== MASK.OUTSIDE) continue;
          const L = rgbToLab(img.data[i * c], img.data[i * c + 1], img.data[i * c + 2])[0];
          sum += L;
          sq += L * L;
          n += 1;
        }
      }
      if (n < tile * tile * 0.9) continue;
      const mean = sum / n;
      const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
      if (mean > 85 && sd < 2) {
        flat[ty * cols + tx] = 1;
        flatTiles += 1;
      }
    }
  }
  const regions = components(flat, cols, rows).sort((a, b) => b.area - a.area);
  const frameArea = img.width * img.height;
  const tileArea = tile * tile;
  const largest = regions[0] ?? null;
  const largestShare = largest ? (largest.area * tileArea) / frameArea : 0;
  return {
    verdict: 'measured',
    tilePx: tile,
    flatTiles,
    flatShare: r3((flatTiles * tileArea) / frameArea),
    largestRegionShare: r3(largestShare),
    largestRegion: largest ? { x: largest.x * tile, y: largest.y * tile, w: largest.w * tile, h: largest.h * tile, tiles: largest.area } : null,
    withinBar: largestShare <= 0.08,
    bar: 'R6-BRIEF L5: no sky-gap region > 8 % of the frame with L > 0.85 and local std < 0.02 (rules 390 / 1440)',
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Probe one still. `img` = { data, width, height, channels } (raw RGB of
 * the final PNG); `inputs` = { pose (cameraPose), viewport { width, height }
 * (CSS px), scale (frame px per CSS px), faceRects / figureRects /
 * excludeRects (CSS px), frameRects (frame px: HUD band, Station Card),
 * station, theme }.
 */
export function lookProbe(img, inputs) {
  const scale = inputs.scale ?? img.width / Math.max(1, inputs.viewport?.width ?? img.width);
  const viewport = inputs.viewport ?? { width: img.width / scale, height: img.height / scale };
  const cam = cameraOf(inputs.pose, viewport);
  const mask = buildLumaMask({
    width: img.width,
    height: img.height,
    scale,
    faceRects: inputs.faceRects ?? [],
    excludeRects: inputs.excludeRects ?? [],
    frameRects: inputs.frameRects ?? [],
    figureRects: inputs.figureRects ?? [],
  });
  const base = {
    version: 'look-probe-r6',
    station: inputs.station ?? null,
    theme: inputs.theme ?? null,
    frame: { width: img.width, height: img.height, scale: r3(scale) },
    masked: { faces: (inputs.faceRects ?? []).length, figures: (inputs.figureRects ?? []).length, chrome: (inputs.excludeRects ?? []).length, frameRects: (inputs.frameRects ?? []).length },
  };
  if (!cam) {
    return { ...base, verdict: 'unmeasured', reason: 'no usable camera pose (cameraPose needs --debug on; dolly stills need the recorder fov)', skyGap: skyGapFlat(img, mask, { scale }), boardVsWorld: boardVsWorld(img, mask, null, { scale }) };
  }
  const facades = facadeMetrics(img, mask, cam, { scale });
  const stoneLabs = Object.values(facades.blocks).flatMap((b) => [b.pier?.lab, b.podium?.lab]).filter((lab) => Array.isArray(lab) && lab.every((v) => typeof v === 'number'));
  return {
    ...base,
    verdict: 'measured',
    camera: { camPos: cam.camPos.map(r3), fov: inputs.pose.fov, yaw: r3(inputs.pose.yawRad ?? inputs.pose.yaw), pitch: r3(inputs.pose.pitchRad ?? inputs.pose.pitch) },
    facades: { blocks: facades.blocks, adjacent: facades.adjacent, meanSaturation: facades.meanSaturation, recession: facades.recession, patches: facades.patches.map(({ poly: _p, ...rest }) => rest) },
    ground: groundCastLit(img, mask, cam, { scale }),
    canopy: canopyMetrics(img, mask, cam, { scale, stoneLabs }),
    night: inputs.theme === 'dark' ? { streaks: nightStreaks(img, mask, cam, { scale }) } : { streaks: { verdict: 'not-applicable', reason: 'light theme' } },
    boardVsWorld: boardVsWorld(img, mask, cam, { scale }),
    skyGap: skyGapFlat(img, mask, { scale }),
    bars: {
      facades: 'R6-BRIEF L1: adjacent blocks deltaE76 >= 4 and value step >= 5 %; mean facade saturation <= 0.26 at 1440; L3: podium -> piano nobile value step >= 8 %',
      recession: 'R6-BRIEF L5: far facades (> 25 m) chroma 10-15 % below the near facades',
    },
    notes: [
      'colours are read from the final PNG (sRGB, gamma-encoded); Lab is CIELAB D65, value / saturation are HSV; block figures are the median of the visible pier patches (piano nobile, between two windows)',
      `a patch counts when >= ${PATCH_MIN_PX} frame px and >= ${PATCH_MIN_VISIBLE * 100} % of its projected polygon are unmasked world pixels (occluders that are not faces or figures — trees, props — are not masked)`,
      'reported against the R6-BRIEF bars, never judged: a look metric never fails the run',
    ],
  };
}

/** The probe's inputs from a still sidecar (offline) and its viewport CSS size. */
export function probeInputsFromSidecar(sidecar, { viewport = null, frameWidth = null } = {}) {
  const rects = Array.isArray(sidecar?.lumaInputs?.faces) && sidecar.lumaInputs.faces.length ? sidecar.lumaInputs : sidecar?.diffRects ?? null;
  const vp = viewport ?? (frameWidth && rects?.frame?.scale ? { width: frameWidth / rects.frame.scale, height: (rects.frame.height ?? 0) / rects.frame.scale } : null);
  const chrome = Array.isArray(sidecar?.lumaInputs?.excluded?.chrome) ? sidecar.lumaInputs.excluded.chrome : [];
  const hudTop = typeof sidecar?.hud?.top === 'number' ? sidecar.hud.top : null;
  return {
    pose: sidecar?.cameraPose ?? null,
    viewport: vp,
    scale: typeof rects?.frame?.scale === 'number' ? rects.frame.scale : undefined,
    faceRects: Array.isArray(rects?.faces) ? rects.faces : [],
    figureRects: Array.isArray(sidecar?.diffRects?.figures) ? sidecar.diffRects.figures : [],
    excludeRects: chrome,
    frameRects: [...(hudTop !== null ? [{ x: 0, y: hudTop, w: 1e6, h: 1e6 }] : []), ...stationCardMaskOf(sidecar)],
    station: sidecar?.section ?? null,
    theme: sidecar?.invocation?.args?.theme ?? sidecar?.sceneLighting?.theme ?? null,
  };
}

/** Raw RGB of a PNG. */
export async function rawImage(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** One printable summary line per probe. */
export function probeLine(name, p) {
  if (!p || p.verdict !== 'measured') return `look-probe: ${name} unmeasured (${p?.reason ?? 'n/a'})`;
  const blocks = Object.entries(p.facades.blocks)
    .map(([id, b]) => `${id}${b.pier ? ` L${b.pier.lab[0]} C${b.pier.chroma} h${b.pier.hue ?? '-'} v${b.pier.value}` : ''}${b.podiumStepPct !== null ? ` pod${b.podiumStepPct}%` : ''}`)
    .join(' | ');
  const adj = p.facades.adjacent.map((a) => `${a.a}/${a.b} dE${a.deltaE76} dv${a.valueStepPct}%${a.meetsBar ? '' : '(<bar)'}`).join(' ');
  const g = p.ground.verdict === 'measured' ? `cast h${p.ground.cast?.hue ?? '-'} lit h${p.ground.lit?.hue ?? '-'} dL${p.ground.castMinusLitL}` : 'ground n/a';
  const crowns = p.canopy.crowns.filter((c) => c.used).map((c) => `${c.id} rim h${c.rim.hue ?? '-'} R>=G ${c.rim.rGeShare} core/rim ${c.coreVsRimL}`).join(' | ');
  const night = p.night.streaks.verdict === 'measured' ? ` streaks=${p.night.streaks.streakCount}` : '';
  const bw = p.boardVsWorld.verdict === 'measured' ? ` board P50 ${p.boardVsWorld.boardP50} vs world P99ex ${p.boardVsWorld.worldP99ExLamps}` : '';
  return `look-probe: ${name} [${blocks}] adj[${adj}] sat=${p.facades.meanSaturation} far-near chroma ${p.facades.recession.farBelowNearPct ?? 'n/a'}% ${g} crowns[${crowns}]${night}${bw} skyFlat=${p.skyGap.largestRegionShare}`;
}

/** An SVG overlay of the projected patches / crowns / ground quads (a projection self-check). */
export function overlaySvg(img, inputs) {
  const scale = inputs.scale ?? img.width / Math.max(1, inputs.viewport?.width ?? img.width);
  const viewport = inputs.viewport ?? { width: img.width / scale, height: img.height / scale };
  const cam = cameraOf(inputs.pose, viewport);
  const parts = [];
  if (cam) {
    const polyPath = (poly) => poly.map((q, i) => `${i ? 'L' : 'M'}${(q.x * scale).toFixed(1)},${(q.y * scale).toFixed(1)}`).join(' ') + ' Z';
    for (const p of facadePatches()) {
      const poly = projectPolygon(cam, p.corners);
      if (poly.length) parts.push(`<path d="${polyPath(poly)}" fill="none" stroke="${p.kind === 'pier' ? '#00e5ff' : '#ff00d4'}" stroke-width="${Math.max(1, scale)}"/>`);
    }
    for (const [id, quad] of Object.entries(GROUND_QUADS)) {
      const poly = projectPolygon(cam, quad);
      if (poly.length) parts.push(`<path d="${polyPath(poly)}" fill="none" stroke="${id === 'rules-forecourt' ? '#ffe600' : '#7cff00'}" stroke-dasharray="6 4" stroke-width="${Math.max(1, scale)}"/>`);
    }
    for (const crown of [...PLAZA_CROWNS, ...LAMP_CORES]) {
      const disc = spherePixels(cam, crown, { width: img.width, height: img.height, scale });
      if (disc.center) parts.push(`<circle cx="${disc.center.x}" cy="${disc.center.y}" r="${disc.radiusPx}" fill="none" stroke="#ff8c00" stroke-width="${Math.max(1, scale)}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}">${parts.join('')}</svg>`;
}

const VIEWPORT_CSS = { 1440: { width: 1440, height: 900 }, 768: { width: 768, height: 1024 }, 390: { width: 390, height: 844 } };

async function main(argv) {
  const files = [];
  let jsonOut = null;
  let overlayDir = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') jsonOut = argv[++i];
    else if (argv[i] === '--overlay') overlayDir = argv[++i];
    else files.push(argv[i]);
  }
  if (!files.length) {
    console.error('usage: node scripts/lib/look-probe.mjs <still.png> [<still.png> ...] [--json <out.json>] [--overlay <dir>]');
    return 2;
  }
  const out = [];
  for (const file of files) {
    const path = resolve(file);
    let sidecar = null;
    try {
      sidecar = JSON.parse(await readFile(path.replace(/\.png$/i, '.json'), 'utf8'));
    } catch {
      sidecar = null;
    }
    let img;
    try {
      img = await rawImage(path);
    } catch (err) {
      console.error(`look-probe: ${file}: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
    const vpKey = /-(\d{3,4})\.png$/i.exec(basename(path))?.[1] ?? null;
    const viewport = sidecar?.viewportCss ?? (vpKey && VIEWPORT_CSS[vpKey] ? VIEWPORT_CSS[vpKey] : null);
    const inputs = probeInputsFromSidecar(sidecar, { viewport });
    if (!inputs.scale && viewport) inputs.scale = img.width / viewport.width;
    const probe = lookProbe(img, inputs);
    console.log(probeLine(basename(path), probe));
    out.push({ file: basename(path), ...probe });
    if (overlayDir) {
      const svg = Buffer.from(overlaySvg(img, inputs));
      const target = resolve(overlayDir, basename(path).replace(/\.png$/i, '-probe.png'));
      await sharp(path).composite([{ input: svg, top: 0, left: 0 }]).png().toFile(target);
      console.log(`look-probe: overlay -> ${target}`);
    }
  }
  if (jsonOut) await writeFile(resolve(jsonOut), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
