/**
 * The Lumiose skyline ring (LOOK-PLAN §2 SEAT K item 5): pure geometry,
 * colour law and the solvers the ring's tests hold it to. The renderer is
 * `evoliga/route/env/Skyline.tsx`; the atlas and its uv law are SEAT A's
 * (`PLAZA_SKYLINE_ATLAS` in `world-env.ts`, baked by
 * `scripts/world-assets/bake-plaza-skyline.mjs`).
 *
 * - THREE open cylinder bands at 70 / 100 / 140 m around the plaza centre,
 *   tops at 16° elevation from the centre at ground level, all inside the
 *   r160 sky dome (with every camera pose's offset from the centre).
 * - ONE merged mesh, far band first so the painter's order (depthWrite off)
 *   lets the near band cover the ones behind it.
 * - u runs continuously from the band's seam azimuth over one full turn
 *   (RepeatWrapping on S), so the atlas's own wrap never shows a derivative
 *   seam; the only geometric seam is the band's start column, placed where
 *   the Haussmann masses hide it from every camera pose (`seamHiddenFrom`).
 * - Colour: mix(layer ink, local clear sky, 0.45 / 0.62 / 0.78 by day,
 *   0.70 / 0.80 / 0.88 at night), a warm sun-side top rim by day, static
 *   near-band window dots at night (≤ 0.6 of the dimmest board ink luma).
 *   Behind a face (calm) the busy terms (rim, windows) fade out and the
 *   silhouette value is clamped to within `SKYLINE_CALM_DELTA_L` of the local
 *   sky (the ±8 ΔL clarity rule, with tone-map headroom).
 *
 * Pure: no three, no React. The GLSL in `paint-fx.ts` mirrors `skylineColor`.
 */

import type { CameraEndpoint, Vec3 } from './chapters';
import {
  dollyPoses,
  faceFocusPoses,
  screenPoint,
  stationPose,
  type DataSurfaceTheme,
  type KeepOutPose,
} from './data-surfaces';
import {
  HAUSSMANN,
  blockHeight,
  massWings,
  mansardSpecForWing,
  type BlockPlan,
} from './haussmann';
import { PLAZA_SKYLINE_ATLAS, skylineLayerHeight } from './world-env';

/** Radius of the plaza sky dome (Atmosphere.tsx). Every band must sit inside it. */
export const SKY_DOME_RADIUS = 160;

export type SkylineBandId = (typeof PLAZA_SKYLINE_ATLAS.layers)[number]['id'];

export interface SkylineBand {
  id: SkylineBandId;
  /** 0 near, 1 mid, 2 far — also the atlas channel (R / G / B). */
  index: number;
  radius: number;
  height: number;
  /** Share of the local clear sky mixed over the layer ink. */
  horizonMix: { day: number; night: number };
  /** Azimuth (radians, atan2(z, x)) of the band's geometric seam column. */
  seam: number;
}

/**
 * Seam azimuths per band, solved against the Haussmann masses
 * (`seamHiddenFrom`, held by `skyline.test.ts`): every band starts behind
 * the south-west façade corner (azimuth 135°, toward −X +Z), the middle of
 * the 110°–165° arc that the west and south-west masses hide from every
 * station, focus and dolly pose. (The east wall does NOT hide azimuth 0: the
 * teams poses see the ring over its mansard.)
 */
const SOUTH_WEST_CORNER = (Math.PI * 3) / 4;
export const SKYLINE_SEAMS: Record<SkylineBandId, number> = {
  near: SOUTH_WEST_CORNER,
  mid: SOUTH_WEST_CORNER,
  far: SOUTH_WEST_CORNER,
};

const HORIZON_MIX: Record<SkylineBandId, { day: number; night: number }> = {
  near: { day: 0.45, night: 0.7 },
  mid: { day: 0.62, night: 0.8 },
  far: { day: 0.78, night: 0.88 },
};

export const SKYLINE_BANDS: readonly SkylineBand[] = PLAZA_SKYLINE_ATLAS.layers.map((layer) => ({
  id: layer.id,
  index: layer.channel,
  radius: layer.radius,
  height: skylineLayerHeight(layer.radius),
  horizonMix: HORIZON_MIX[layer.id],
  seam: SKYLINE_SEAMS[layer.id],
}));

/** Columns per band — ≈ 1 m chords on the near band, ample for a cylinder seen from inside. */
export const SKYLINE_SEGMENTS = 256;

/**
 * Day / night layer inks (sRGB hex). Cool lilac-greys that already lean
 * toward the air hue (`#8fb0d8`), so the horizon mix reads as recession, not
 * fog; each band steps lighter and bluer with distance.
 */
export const SKYLINE_INK: Record<SkylineBandId, { day: string; night: string }> = {
  near: { day: '#7c85a2', night: '#141a33' },
  mid: { day: '#8a96b6', night: '#1a2240' },
  far: { day: '#9aa9c6', night: '#202a4a' },
};

/** Warm sun-side top rim colour (the day key) and its linear strength. */
export const SKYLINE_RIM = { color: '#ffd29a', strength: 0.22 } as const;

/** Texels (atlas rows) above a pixel the rim probe samples to find a roofline. */
export const SKYLINE_RIM_PROBE_TEXELS = 3;

/**
 * Night window dot colour (sRGB) and its linear luminance target. The cap is
 * 0.6 × the dimmest night board ink (`SKYLINE_WINDOW_CAP_SHARE`); the test
 * derives the ink luma from the plaza palette so this can never drift above it.
 */
export const SKYLINE_WINDOW = { color: '#ffc27a', luma: 0.3 } as const;
export const SKYLINE_WINDOW_CAP_SHARE = 0.6;

/** Working ΔL* cap behind faces: the ±8 rule with 2 L* of tone-map headroom. */
export const SKYLINE_CALM_DELTA_L = 6;

// ── Geometry ────────────────────────────────────────────────────────────────

export interface SkylineRing {
  /** xyz per vertex. */
  positions: Float32Array;
  /** Atlas uv per vertex: u continuous from the seam (may exceed 1; wrap S), v 0 ground → 1 top. */
  uvs: Float32Array;
  /** Band index per vertex (0 near, 1 mid, 2 far). */
  bands: Float32Array;
  /** Triangles, FAR band first, then mid, then near (painter's order). */
  indices: Uint32Array;
}

/** The merged open-cylinder ring (drawn double-sided, so winding is immaterial). */
export function buildSkylineRing(
  bands: readonly SkylineBand[] = SKYLINE_BANDS,
  segments: number = SKYLINE_SEGMENTS,
): SkylineRing {
  const order = [...bands].sort((a, b) => b.radius - a.radius);
  const columns = segments + 1;
  const vertexCount = order.length * columns * 2;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const bandAttr = new Float32Array(vertexCount);
  const indices = new Uint32Array(order.length * segments * 6);
  let v = 0;
  let t = 0;
  for (const band of order) {
    const base = v;
    for (let i = 0; i < columns; i += 1) {
      const turn = i / segments;
      const azimuth = band.seam + turn * Math.PI * 2;
      const x = band.radius * Math.cos(azimuth);
      const z = band.radius * Math.sin(azimuth);
      const u = band.seam / (Math.PI * 2) + turn;
      for (const [y, vv] of [
        [0, 0],
        [band.height, 1],
      ] as const) {
        positions.set([x, y, z], v * 3);
        uvs.set([u, vv], v * 2);
        bandAttr[v] = band.index;
        v += 1;
      }
    }
    for (let i = 0; i < segments; i += 1) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.set([a, b, c, b, d, c], t);
      t += 6;
    }
  }
  return { positions, uvs, bands: bandAttr, indices };
}

/** Atlas u of a world azimuth (the SEAT A law: atan2(z, x) / 2π wrapped to [0, 1)). */
export function atlasU(azimuth: number): number {
  const u = azimuth / (Math.PI * 2);
  return u - Math.floor(u);
}

// ── Occluders and seam visibility ───────────────────────────────────────────

export interface Aabb {
  id: string;
  min: Vec3;
  max: Vec3;
}

function rotateY(x: number, z: number, angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c + z * s, -x * s + z * c];
}

function boxFrom(id: string, plan: BlockPlan, cx: number, cz: number, w: number, d: number, y0: number, y1: number): Aabb {
  const corners = [
    [cx - w / 2, cz - d / 2],
    [cx + w / 2, cz - d / 2],
    [cx - w / 2, cz + d / 2],
    [cx + w / 2, cz + d / 2],
  ].map(([x, z]) => {
    const [rx, rz] = rotateY(x, z, plan.rotationY);
    return [plan.origin[0] + rx, plan.origin[2] + rz] as const;
  });
  const xs = corners.map((c) => c[0]);
  const zs = corners.map((c) => c[1]);
  return { id, min: [Math.min(...xs), y0, Math.min(...zs)], max: [Math.max(...xs), y1, Math.max(...zs)] };
}

/**
 * Conservative solid masses of the Haussmann blocks: each wing's wall box up
 * to the cornice, plus the mansard's inner box (its footprint shrunk by the
 * full inset, so the box sits wholly inside the sloped roof).
 */
export function skylineOccluders(plans: readonly BlockPlan[]): Aabb[] {
  const out: Aabb[] = [];
  for (const plan of plans) {
    const wall = blockHeight(plan) + HAUSSMANN.cornice;
    for (const wing of massWings(plan)) {
      out.push(boxFrom(`${wing.id}:wall`, plan, wing.x, wing.z, wing.w, wing.d, 0, wall));
      const mansard = mansardSpecForWing(plan, wing);
      if (mansard) {
        const w = mansard.width - 2 * mansard.inset;
        const d = mansard.depth - 2 * mansard.inset;
        if (w > 0 && d > 0) {
          out.push(boxFrom(`${wing.id}:mansard`, plan, wing.x, wing.z, w, d, mansard.baseY - 1e-3, mansard.baseY + mansard.rise));
        }
      }
    }
  }
  return out;
}

/** Does the open segment from `a` to `b` pass through `box`? (slab test, t ∈ (0, 1)) */
export function segmentHitsAabb(a: Vec3, b: Vec3, box: Aabb): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const d = b[axis] - a[axis];
    if (Math.abs(d) < 1e-12) {
      if (a[axis] < box.min[axis] || a[axis] > box.max[axis]) return false;
      continue;
    }
    let near = (box.min[axis] - a[axis]) / d;
    let far = (box.max[axis] - a[axis]) / d;
    if (near > far) [near, far] = [far, near];
    t0 = Math.max(t0, near);
    t1 = Math.min(t1, far);
    if (t0 > t1) return false;
  }
  return t1 > 1e-6 && t0 < 1 - 1e-6;
}

/** World point on a band at azimuth and height share v. */
export function bandPoint(band: Pick<SkylineBand, 'radius' | 'height'>, azimuth: number, v: number): Vec3 {
  return [band.radius * Math.cos(azimuth), v * band.height, band.radius * Math.sin(azimuth)];
}

/** Is a world point on screen at this pose (inside the viewport, in front of the eye)? */
export function onScreen(p: Vec3, camera: CameraEndpoint, viewport: { width: number; height: number }): boolean {
  const s = screenPoint(p, camera, viewport);
  return s !== null && s.x >= 0 && s.x <= viewport.width && s.y >= 0 && s.y <= viewport.height;
}

/** Height samples of a seam column. */
const SEAM_SAMPLES = 9;

/**
 * Is the band's seam column hidden from `pose`: every sample either off
 * screen or behind a solid mass?
 */
export function seamHiddenFrom(
  band: Pick<SkylineBand, 'radius' | 'height'>,
  azimuth: number,
  pose: KeepOutPose,
  occluders: readonly Aabb[],
): boolean {
  for (let i = 0; i < SEAM_SAMPLES; i += 1) {
    const p = bandPoint(band, azimuth, i / (SEAM_SAMPLES - 1));
    if (!onScreen(p, pose.camera, pose.viewport)) continue;
    if (!occluders.some((box) => segmentHitsAabb(pose.camera.position, p, box))) return false;
  }
  return true;
}

/**
 * Every camera the ring is judged from: each station's desktop, 768 and
 * landed-390 pose, every face's focus poses, and every dolly sample.
 */
export function skylinePoses(theme: DataSurfaceTheme): KeepOutPose[] {
  const poses: KeepOutPose[] = [];
  theme.stations.forEach((_, index) => {
    poses.push(stationPose(theme, index, 'desktop'), stationPose(theme, index, 'tablet'), stationPose(theme, index, 'mobile'));
    poses.push(...dollyPoses(theme, index));
  });
  for (const face of theme.faces) poses.push(...faceFocusPoses(theme, face));
  return poses;
}

// ── Colour law (mirrored by the paint-fx GLSL) ──────────────────────────────

export type Rgb = readonly [number, number, number];

export function luma(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** CIE L* of a relative luminance (0..1+). */
export function lstar(y: number): number {
  const t = Math.max(y, 0);
  return t > 216 / 24389 ? 116 * Math.cbrt(t) - 16 : (24389 / 27) * t;
}

/** Inverse of `lstar`. */
export function yFromLstar(l: number): number {
  return l > 8 ? ((l + 16) / 116) ** 3 : (Math.max(l, 0) * 27) / 24389;
}

function mix3(a: Rgb, b: Rgb, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Pull `col`'s luminance to within `maxDL` L* of `sky`'s, weighted by
 * `calm` (0 → untouched, 1 → fully clamped). Hue is kept (uniform scale).
 */
export function calmClampL(col: Rgb, sky: Rgb, maxDL: number, calm: number): [number, number, number] {
  const yc = luma(col);
  const ls = lstar(luma(sky));
  const lc = lstar(yc);
  const lt = Math.min(Math.max(lc, ls - maxDL), ls + maxDL);
  const k = yc > 1e-6 ? yFromLstar(lt) / yc : 1;
  const clamped: Rgb = [col[0] * k, col[1] * k, col[2] * k];
  return mix3(col, clamped, Math.min(Math.max(calm, 0), 1));
}

/**
 * The silhouette colour of a band pixel (linear), before the grade: ink
 * mixed toward the local clear sky, then the calm clamp. Rim and windows are
 * busy terms and are × (1 − calm) in the shader; they are left out here.
 */
export function skylineColor(ink: Rgb, sky: Rgb, horizonMix: number, calm: number, maxDL = SKYLINE_CALM_DELTA_L): [number, number, number] {
  return calmClampL(mix3(ink, sky, horizonMix), sky, maxDL, calm);
}
