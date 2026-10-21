/**
 * Sky lanes — the pure contract for lane flyers (POKEMON-CORE-PLAN §4 SEAT D
 * step 4; L2 moved it from 3B to SEAT D; D35 3D SHARED ACTORS).
 *
 * A lane is a centripetal Catmull–Rom spline through authored points, built
 * ONCE (module init of the per-world data) into a uniform arc-length table
 * (≈ one sample per 0.25 m), so a runtime lookup is O(1) with a lerp and no
 * allocation. A flyer carries its idle pose along the lane (a glide,
 * disclosed: "idle pose carried along a lane"; never `walk`), banked into
 * its turns by `atan(v²κ/g)` (clamped ±18°, low-passed τ 0.3 s at runtime)
 * and pitched with the path (clamped ±10°).
 *
 * What makes a lane lawful is TESTED, never clamped at runtime (C17):
 *  - `laneLimits`: yaw rate v·κ ≤ 20°/s and the bank ≤ 18° everywhere;
 *  - `laneAsKeepOut` + `keepOut.laneClears` (every wedge);
 *  - the NDC distance of the body's projection from every padded face at the
 *    station poses ≥ 0.06 (`sphereFaceNdcDistance`);
 *  - `laneEndpointsOffFrame`: both ends (± the body radius) project outside
 *    the frame (|ndc| > 1 + margin) or behind the eye at every station,
 *    focus and dolly pose — so a pass enters and leaves unseen from any pose
 *    the rig can take (C4); the runtime frustum check is a second guard;
 *  - at landed 390, no sample meets `portraitBands().caption` (the Station
 *    Card caption lives in the sky), or the lane carries `portrait: false`
 *    and passes are suppressed at portrait widths (never clipped).
 *
 * The pass scheduler (`lanePass`) gives each pass a seeded delay in
 * [45, 90] s of the lane's awake clock; the `beatForce=flyover@` second
 * overrides the first pass. `stepLaneFlyer` is the pure state machine
 * (`idle | pending | pass | exit | perch`); `SkyLaneFlyer.tsx` feeds it the
 * frustum and bus answers and applies the pose imperatively.
 *
 * Time (D40): the lane clock is the actor's accumulated awake seconds; a
 * pass advances by the clamped frame delta.
 *
 * Pure: no React, no three, no DOM.
 */

import type { CameraEndpoint, Vec3 } from './chapters';
import { hash01, hashText, mix32 } from './clip-phase';
import {
  cameraBasis,
  paddedFaceRect,
  type DataFace,
  type KeepOutLane,
  type KeepOutPose,
  type Viewport,
} from './data-surfaces';
import { MAX_STEP_S } from './figure-behavior';

/* ------------------------------------------------------------------------ */
/* Data                                                                     */
/* ------------------------------------------------------------------------ */

export interface SkyLanePerch {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** One authored lane (per-world `sky-lanes.data.ts`, or the core probe). */
export interface SkyLaneSpec {
  /** Stable id: the flyer's root is `<world>-prop-flyer-<id>` (C15). */
  id: string;
  /** The station index whose window the lane belongs to. */
  station: number;
  /** Control points (world metres), at least 2. */
  points: readonly Vec3[];
  /** Glide speed (m/s). */
  speedMps: number;
  /** Body radius used by the keep-out and frustum tests (m). */
  bodyRadiusM: number;
  /** Where the flyer sits below `figureLife` full; null = it stays hidden. */
  perch: SkyLanePerch | null;
  /** The endpoints must project beyond |ndc| = 1 + this margin (or behind the eye). */
  entryExitMarginNdc: number;
  /** False: no passes at portrait widths (≤ 767 px) — the caption band rule. Default true. */
  portrait?: boolean;
}

/** Target arc-length spacing of the lookup table (m). */
export const LANE_STEP_M = 0.25;
/** Bank clamp (rad): ±18°. */
export const LANE_BANK_MAX_RAD = (18 * Math.PI) / 180;
/** Pitch clamp (rad): ±10°. */
export const LANE_PITCH_MAX_RAD = (10 * Math.PI) / 180;
/** Yaw-rate ceiling (rad/s): 20°/s — validated in the test, never clamped. */
export const LANE_YAW_RATE_MAX_RAD = (20 * Math.PI) / 180;
/** Bank / pitch low-pass (s). */
export const LANE_TILT_TAU_S = 0.3;
export const GRAVITY_MPS2 = 9.81;
/** Pass periods (s of the lane's awake clock). */
export const LANE_PERIOD_S: readonly [number, number] = [45, 90];
/** The idle2 accent lands at this share of the pass (seeded inside the range). */
export const LANE_ACCENT_AT: readonly [number, number] = [0.3, 0.4];

/** The built lane: the spec plus its uniform arc-length table. */
export interface SkyLane {
  readonly spec: SkyLaneSpec;
  /** Total arc length (m). */
  readonly length: number;
  /** Table spacing (m): length / (count − 1), ≈ LANE_STEP_M. */
  readonly step: number;
  readonly count: number;
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly pz: Float64Array;
  /** Heading yaw (rad, +Z forward: atan2(tx, tz)), unwrapped along the lane. */
  readonly yaw: Float64Array;
  /** Path pitch (rad, unclamped: asin of the tangent's y). */
  readonly pitch: Float64Array;
  /** Signed horizontal curvature dYaw/ds (rad/m; + = turning toward +yaw). */
  readonly kappa: Float64Array;
}

/* ------------------------------------------------------------------------ */
/* Build                                                                    */
/* ------------------------------------------------------------------------ */

type P3 = [number, number, number];

function knot(t: number, a: P3, b: P3): number {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return t + Math.max(Math.sqrt(d), 1e-6);
}

function lerp3(a: P3, b: P3, ta: number, tb: number, t: number): P3 {
  const w = tb - ta < 1e-12 ? 0 : (t - ta) / (tb - ta);
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
}

/** Centripetal (α = 0.5) Catmull–Rom point on segment p1→p2 at u ∈ [0, 1] (Barry–Goldman). */
function catmullRom(p0: P3, p1: P3, p2: P3, p3: P3, u: number): P3 {
  const t0 = 0;
  const t1 = knot(t0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);
  const t = t1 + (t2 - t1) * u;
  const a1 = lerp3(p0, p1, t0, t1, t);
  const a2 = lerp3(p1, p2, t1, t2, t);
  const a3 = lerp3(p2, p3, t2, t3, t);
  const b1 = lerp3(a1, a2, t0, t2, t);
  const b2 = lerp3(a2, a3, t1, t3, t);
  return lerp3(b1, b2, t1, t2, t);
}

/** Dense samples per spline segment before the arc-length resample. */
const DENSE_PER_SEGMENT = 96;

/**
 * Build a lane's arc-length table. Throws on fewer than 2 points or a
 * non-positive speed (authoring errors, caught by the lane's own test).
 */
export function buildSkyLane(spec: SkyLaneSpec): SkyLane {
  if (spec.points.length < 2) throw new Error(`sky-lanes: lane ${spec.id} needs ≥ 2 points`);
  if (!(spec.speedMps > 0)) throw new Error(`sky-lanes: lane ${spec.id} needs a positive speed`);
  const pts: P3[] = spec.points.map((p) => [p[0], p[1], p[2]]);
  const n = pts.length;
  // Phantom ends (reflected), so the curve passes through the first and last points.
  const first: P3 = [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1], 2 * pts[0][2] - pts[1][2]];
  const last: P3 = [2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1], 2 * pts[n - 1][2] - pts[n - 2][2]];
  const ext = [first, ...pts, last];
  const dense: P3[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    for (let k = 0; k < DENSE_PER_SEGMENT; k += 1) dense.push(catmullRom(ext[i], ext[i + 1], ext[i + 2], ext[i + 3], k / DENSE_PER_SEGMENT));
  }
  dense.push(pts[n - 1]);
  const cum: number[] = [0];
  for (let i = 1; i < dense.length; i += 1) {
    const a = dense[i - 1];
    const b = dense[i];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const length = cum[cum.length - 1];
  const count = Math.max(2, Math.ceil(length / LANE_STEP_M) + 1);
  const step = length / (count - 1);
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  const pz = new Float64Array(count);
  let j = 0;
  for (let i = 0; i < count; i += 1) {
    const s = i * step;
    while (j < cum.length - 2 && cum[j + 1] < s) j += 1;
    const span = cum[j + 1] - cum[j];
    const w = span > 1e-12 ? Math.min(1, Math.max(0, (s - cum[j]) / span)) : 0;
    px[i] = dense[j][0] + (dense[j + 1][0] - dense[j][0]) * w;
    py[i] = dense[j][1] + (dense[j + 1][1] - dense[j][1]) * w;
    pz[i] = dense[j][2] + (dense[j + 1][2] - dense[j][2]) * w;
  }
  const yaw = new Float64Array(count);
  const pitch = new Float64Array(count);
  const kappa = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const a = Math.max(0, i - 1);
    const b = Math.min(count - 1, i + 1);
    const tx = px[b] - px[a];
    const ty = py[b] - py[a];
    const tz = pz[b] - pz[a];
    const len = Math.hypot(tx, ty, tz) || 1;
    let y = Math.atan2(tx, tz);
    if (i > 0) {
      // Unwrap against the previous sample so interpolation never spins.
      while (y - yaw[i - 1] > Math.PI) y -= 2 * Math.PI;
      while (y - yaw[i - 1] < -Math.PI) y += 2 * Math.PI;
    }
    yaw[i] = y;
    pitch[i] = Math.asin(Math.max(-1, Math.min(1, ty / len)));
  }
  for (let i = 0; i < count; i += 1) {
    const a = Math.max(0, i - 1);
    const b = Math.min(count - 1, i + 1);
    const ds = (b - a) * step;
    kappa[i] = ds > 0 ? (yaw[b] - yaw[a]) / ds : 0;
  }
  return { spec, length, step, count, px, py, pz, yaw, pitch, kappa };
}

/* ------------------------------------------------------------------------ */
/* Lookup                                                                   */
/* ------------------------------------------------------------------------ */

/** One lane frame (reused by the caller). */
export interface LaneFrame {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Clamped path pitch (rad, nose up +). */
  pitch: number;
  /** Clamped bank target `atan(v²κ/g)` (rad, + = roll into a +yaw turn). */
  bank: number;
}

export function createLaneFrame(): LaneFrame {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, bank: 0 };
}

/** The bank a turn of curvature `kappa` at speed `v` asks for, clamped to ±18°. */
export function bankFor(speedMps: number, kappa: number): number {
  const b = Math.atan((speedMps * speedMps * kappa) / GRAVITY_MPS2);
  return Math.max(-LANE_BANK_MAX_RAD, Math.min(LANE_BANK_MAX_RAD, b));
}

/** The lane frame at arc length `s` (clamped to [0, length]); allocation-free. */
export function sampleSkyLane(lane: SkyLane, s: number, out: LaneFrame): LaneFrame {
  const u = Math.min(Math.max(Number.isFinite(s) ? s : 0, 0), lane.length) / lane.step;
  const i = Math.min(Math.floor(u), lane.count - 2);
  const w = u - i;
  const j = i + 1;
  out.x = lane.px[i] + (lane.px[j] - lane.px[i]) * w;
  out.y = lane.py[i] + (lane.py[j] - lane.py[i]) * w;
  out.z = lane.pz[i] + (lane.pz[j] - lane.pz[i]) * w;
  out.yaw = lane.yaw[i] + (lane.yaw[j] - lane.yaw[i]) * w;
  const pitch = lane.pitch[i] + (lane.pitch[j] - lane.pitch[i]) * w;
  out.pitch = Math.max(-LANE_PITCH_MAX_RAD, Math.min(LANE_PITCH_MAX_RAD, pitch));
  out.bank = bankFor(lane.spec.speedMps, lane.kappa[i] + (lane.kappa[j] - lane.kappa[i]) * w);
  return out;
}

export interface LaneLimits {
  /** max v·|κ| (deg/s). */
  maxYawRateDegS: number;
  /** max |atan(v²κ/g)| before the clamp (deg). */
  maxBankDeg: number;
  /** max |path pitch| before the clamp (deg). */
  maxPitchDeg: number;
  lengthM: number;
  /** Seconds one pass takes. */
  passS: number;
}

export function laneLimits(lane: SkyLane): LaneLimits {
  const v = lane.spec.speedMps;
  let kappa = 0;
  let pitch = 0;
  for (let i = 0; i < lane.count; i += 1) {
    kappa = Math.max(kappa, Math.abs(lane.kappa[i]));
    pitch = Math.max(pitch, Math.abs(lane.pitch[i]));
  }
  const deg = 180 / Math.PI;
  return {
    maxYawRateDegS: v * kappa * deg,
    maxBankDeg: Math.atan((v * v * kappa) / GRAVITY_MPS2) * deg,
    maxPitchDeg: pitch * deg,
    lengthM: lane.length,
    passS: lane.length / v,
  };
}

/** The lane's table as a keep-out lane (every arc sample, the body radius). */
export function laneAsKeepOut(lane: SkyLane): KeepOutLane {
  const points: Vec3[] = [];
  for (let i = 0; i < lane.count; i += 1) points.push([lane.px[i], lane.py[i], lane.pz[i]]);
  return { id: `flyer:${lane.spec.id}`, points, radius: lane.spec.bodyRadiusM };
}

/** Every arc sample (tests). */
export function laneSamples(lane: SkyLane): Vec3[] {
  return laneAsKeepOut(lane).points.slice();
}

/* ------------------------------------------------------------------------ */
/* Projection helpers (tests, authoring)                                    */
/* ------------------------------------------------------------------------ */

/** The rig's near plane (CameraRig `near={0.5}`, data-surfaces RIG_NEAR_M). */
const NEAR_M = 0.5;

/** A sphere's NDC bounds at a pose (x right, y up), or null when it is entirely behind the near plane. */
export function sphereNdc(
  camera: CameraEndpoint,
  viewport: Viewport,
  c: Vec3,
  r: number,
): { x0: number; x1: number; y0: number; y1: number; depth: number } | null {
  const { right, up, forward } = cameraBasis(camera);
  const rel: P3 = [c[0] - camera.position[0], c[1] - camera.position[1], c[2] - camera.position[2]];
  const depth = rel[0] * forward[0] + rel[1] * forward[1] + rel[2] * forward[2];
  if (depth + r <= NEAR_M) return null;
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  const aspect = viewport.width / viewport.height;
  // The centre projects at its own depth; the radius is measured at the
  // sphere's NEAREST depth (conservative: the projection never under-reads).
  const dc = Math.max(depth, NEAR_M);
  const dn = Math.max(depth - r, NEAR_M);
  const x = (rel[0] * right[0] + rel[1] * right[1] + rel[2] * right[2]) / (dc * tanHalf * aspect);
  const y = (rel[0] * up[0] + rel[1] * up[1] + rel[2] * up[2]) / (dc * tanHalf);
  const rx = r / (dn * tanHalf * aspect);
  const ry = r / (dn * tanHalf);
  return { x0: x - rx, x1: x + rx, y0: y - ry, y1: y + ry, depth };
}

/** Is the sphere off frame at this pose (behind the near plane, or outside |ndc| ≤ 1 + margin)? */
export function sphereOffFrame(pose: KeepOutPose, c: Vec3, r: number, marginNdc: number): boolean {
  const b = sphereNdc(pose.camera, pose.viewport, c, r);
  if (b === null) return true;
  const lim = 1 + marginNdc;
  return b.x1 < -lim || b.x0 > lim || b.y1 < -lim || b.y0 > lim;
}

/** The poses at which an endpoint of `lane` is NOT off frame (empty = lawful, C4). */
export function laneEndpointsOffFrame(lane: SkyLane, poses: readonly KeepOutPose[]): string[] {
  const ends: [string, Vec3][] = [
    ['entry', [lane.px[0], lane.py[0], lane.pz[0]]],
    ['exit', [lane.px[lane.count - 1], lane.py[lane.count - 1], lane.pz[lane.count - 1]]],
  ];
  const out: string[] = [];
  for (const pose of poses) {
    for (const [name, p] of ends) {
      if (!sphereOffFrame(pose, p, lane.spec.bodyRadiusM, lane.spec.entryExitMarginNdc)) out.push(`${name}@${pose.id}`);
    }
  }
  return out;
}

/** An NDC rectangle (x right, y up). */
export interface NdcRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * The NDC bounds of an axis-aligned box's 8 corners at a pose; null when the
 * whole box is behind the near plane (not seen). A box that STRADDLES the
 * near plane comes back as the whole frame (`[-1, 1]²`): conservative, it
 * meets every face and band.
 */
export function boxNdc(camera: CameraEndpoint, viewport: Viewport, center: Vec3, half: Vec3): NdcRect | null {
  const { right, up, forward } = cameraBasis(camera);
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  const aspect = viewport.width / viewport.height;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let behind = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const rx = center[0] + sx * half[0] - camera.position[0];
        const ry = center[1] + sy * half[1] - camera.position[1];
        const rz = center[2] + sz * half[2] - camera.position[2];
        const depth = rx * forward[0] + ry * forward[1] + rz * forward[2];
        if (depth < NEAR_M) {
          behind += 1;
          continue;
        }
        const x = (rx * right[0] + ry * right[1] + rz * right[2]) / (depth * tanHalf * aspect);
        const y = (rx * up[0] + ry * up[1] + rz * up[2]) / (depth * tanHalf);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  if (behind === 8) return null;
  if (behind > 0) return { x0: -1, x1: 1, y0: -1, y1: 1 };
  return { x0, x1, y0, y1 };
}

/** Is any of the rect inside the frame? */
export function ndcOnScreen(rect: NdcRect): boolean {
  return !(rect.x1 < -1 || rect.x0 > 1 || rect.y1 < -1 || rect.y0 > 1);
}

/** A face's padded rect (`paddedFaceRect`) in NDC at a pose; null when it is off screen. */
export function faceNdcRect(pose: KeepOutPose, face: DataFace): NdcRect | null {
  const padded = paddedFaceRect(face, pose.camera, pose.viewport);
  if (!padded) return null;
  const { width, height } = pose.viewport;
  return {
    x0: (padded.x / width) * 2 - 1,
    x1: ((padded.x + padded.w) / width) * 2 - 1,
    y0: 1 - ((padded.y + padded.h) / height) * 2,
    y1: 1 - (padded.y / height) * 2,
  };
}

/** Euclidean gap between two NDC rects (0 when they meet). */
export function ndcRectDistance(a: NdcRect, b: NdcRect): number {
  const dx = Math.max(0, b.x0 - a.x1, a.x0 - b.x1);
  const dy = Math.max(0, b.y0 - a.y1, a.y0 - b.y1);
  return Math.hypot(dx, dy);
}

/**
 * NDC distance (Euclidean between the rectangles; 0 when they meet) from an
 * NDC rect to a face's padded rect at a pose, or null when either is off
 * screen.
 */
export function ndcRectFaceDistance(pose: KeepOutPose, face: DataFace, rect: NdcRect): number | null {
  if (!ndcOnScreen(rect)) return null;
  const faceRect = faceNdcRect(pose, face);
  return faceRect === null ? null : ndcRectDistance(rect, faceRect);
}

/** NDC distance from a sphere's projection to a face's padded rect (see `ndcRectFaceDistance`). */
export function sphereFaceNdcDistance(pose: KeepOutPose, face: DataFace, c: Vec3, r: number): number | null {
  const b = sphereNdc(pose.camera, pose.viewport, c, r);
  return b === null ? null : ndcRectFaceDistance(pose, face, b);
}

/** An NDC rect's screen rows (CSS px, top-left origin), clipped to the frame; null off screen. */
export function ndcRows(rect: NdcRect, viewport: Viewport): { top: number; bottom: number } | null {
  if (!ndcOnScreen(rect)) return null;
  const H = viewport.height;
  const top = Math.max(0, ((1 - Math.min(rect.y1, 1)) / 2) * H);
  const bottom = Math.min(H, ((1 - Math.max(rect.y0, -1)) / 2) * H);
  return bottom > top ? { top, bottom } : null;
}

/** The sphere's screen rows at a pose, clipped to the frame; null off screen. */
export function sphereScreenRows(pose: KeepOutPose, c: Vec3, r: number): { top: number; bottom: number } | null {
  const b = sphereNdc(pose.camera, pose.viewport, c, r);
  return b === null ? null : ndcRows(b, pose.viewport);
}

/* ------------------------------------------------------------------------ */
/* Pass schedule                                                            */
/* ------------------------------------------------------------------------ */

/**
 * The delay (s of the lane clock) before pass `k` of lane `id` under `seed`:
 * seeded uniform in [45, 90], so consecutive passes jitter by well over 20 %
 * of the mean (tested). Deterministic under `?beatSeed=`.
 */
export function lanePass(seed: number, id: string, k: number): number {
  const u = hash01(mix32(seed >>> 0, hashText(id)), (k >>> 0) + 1);
  return LANE_PERIOD_S[0] + (LANE_PERIOD_S[1] - LANE_PERIOD_S[0]) * u;
}

/** The seeded idle2 accent point of pass `k` (arc-length share in [0.3, 0.4]). */
export function laneAccentAt(seed: number, id: string, k: number): number {
  const u = hash01(mix32(seed >>> 0, hashText(id) ^ 0xacce), (k >>> 0) + 1);
  return LANE_ACCENT_AT[0] + (LANE_ACCENT_AT[1] - LANE_ACCENT_AT[0]) * u;
}

/* ------------------------------------------------------------------------ */
/* Stepper                                                                  */
/* ------------------------------------------------------------------------ */

export type LaneMode = 'idle' | 'pending' | 'pass' | 'exit' | 'perch';

/** JSON-safe flyer state. */
export interface LaneFlyerState {
  mode: LaneMode;
  seed: number;
  /** Arc length along the lane (m). */
  s: number;
  /** Seconds in the current mode. */
  modeT: number;
  /** The lane clock (s) at which the next pass may start. */
  nextPassT: number;
  /** Passes begun. */
  n: number;
  /** A `beatForce` second fired and the pass it asks for has not started yet. */
  forcePending: boolean;
  /** The pending request is a forced one. */
  forcedRequest: boolean;
  /** Low-passed bank / pitch (rad). */
  bank: number;
  pitch: number;
  /** This pass's accent share, and whether it fired. */
  accentAt: number;
  accentDone: boolean;
}

export function initLaneFlyerState(seed: number, lane: SkyLane): LaneFlyerState {
  return {
    mode: 'idle',
    seed: seed >>> 0,
    s: 0,
    modeT: 0,
    nextPassT: lanePass(seed, lane.spec.id, 0),
    n: 0,
    forcePending: false,
    forcedRequest: false,
    bank: 0,
    pitch: 0,
    accentAt: laneAccentAt(seed, lane.spec.id, 0),
    accentDone: false,
  };
}

export interface LaneStepInput {
  /** The actor's awake lane clock now (s). */
  laneT: number;
  /** A pass may start: awake, live, `figureLife` full, full motion, not portrait-suppressed. */
  active: boolean;
  /** A `beatForce=flyover@` second fired this frame. */
  forced: boolean;
  /** The bus granted the ticket. */
  granted: boolean;
  /** The entry sphere is outside the current frustum. */
  entryOut: boolean;
  /** The flyer's CURRENT sphere (lane point or perch) is outside the current frustum. */
  currentOut: boolean;
  /** Below `figureLife` full (or reduced motion): perch (if the lane has one) or stay hidden. */
  perchWanted: boolean;
  /** The perch sphere is outside the current frustum. */
  perchOut: boolean;
}

export interface LaneStepOut {
  frame: LaneFrame;
  wantsVisible: boolean;
  /** Request the flyover beat now. */
  request: boolean;
  /** The request is forced (`{ forced: true }`). */
  forced: boolean;
  /** Release (or withdraw) the ticket now. */
  release: boolean;
  /** Flip the clip this step (null: keep). */
  clip: 'idle' | 'idle2' | null;
}

export function createLaneStepOut(): LaneStepOut {
  return { frame: createLaneFrame(), wantsVisible: false, request: false, forced: false, release: false, clip: null };
}

function scheduleNext(state: LaneFlyerState, lane: SkyLane, laneT: number): void {
  state.n += 1;
  state.nextPassT = laneT + lanePass(state.seed, lane.spec.id, state.n);
  state.accentAt = laneAccentAt(state.seed, lane.spec.id, state.n);
  state.accentDone = false;
}

/**
 * One flyer step (in place). `dt` is the clamped frame delta: a running pass
 * keeps gliding on it even while dormant (it finishes, pose-only, then hides);
 * the schedule reads only `input.laneT` (the actor's awake clock).
 */
export function stepLaneFlyer(
  state: LaneFlyerState,
  lane: SkyLane,
  dtSeconds: number,
  input: LaneStepInput,
  out: LaneStepOut,
): LaneStepOut {
  const dt = Math.min(Math.max(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0), MAX_STEP_S);
  out.request = false;
  out.forced = false;
  out.release = false;
  out.clip = null;
  state.modeT += dt;
  if (input.forced) state.forcePending = true;
  /**
   * The step that hides (exit → idle, perch → idle) keeps the pose where the
   * flyer WAS: with R27's order (latch before step) the root is still shown
   * for this rendered frame, so it must not jump to the lane entry. The
   * next idle step (the latch has hidden the root by then) parks it at s 0.
   */
  let hidingFrom: 'exit' | 'perch' | null = null;

  switch (state.mode) {
    case 'idle':
      if (state.s !== 0) state.s = 0;
      if (input.perchWanted) {
        if (lane.spec.perch !== null && input.currentOut && input.perchOut) {
          state.mode = 'perch';
          state.modeT = 0;
          out.clip = 'idle';
        }
        break;
      }
      if (input.active && (state.forcePending || input.laneT >= state.nextPassT) && input.entryOut) {
        state.mode = 'pending';
        state.modeT = 0;
        state.forcedRequest = state.forcePending;
        out.request = true;
        out.forced = state.forcePending;
      }
      break;
    case 'pending':
      if (!input.active) {
        out.release = true;
        state.mode = 'idle';
        state.modeT = 0;
        // A withdrawn natural request re-arms (no backlog); a forced one waits for the next chance.
        if (!state.forcedRequest) state.nextPassT = input.laneT + lanePass(state.seed, lane.spec.id, state.n + 1);
      } else if (input.granted && input.entryOut) {
        state.mode = 'pass';
        state.modeT = 0;
        state.s = 0;
        state.forcePending = false;
        state.accentDone = false;
        out.clip = 'idle';
      }
      break;
    case 'pass':
      state.s += lane.spec.speedMps * dt;
      if (!state.accentDone && state.s >= state.accentAt * lane.length) {
        state.accentDone = true;
        out.clip = 'idle2';
      }
      if (state.s >= lane.length) {
        state.s = lane.length;
        state.mode = 'exit';
        state.modeT = 0;
      }
      break;
    case 'exit':
      if (input.currentOut) {
        state.mode = 'idle';
        state.modeT = 0;
        // s stays at the lane end for this (hiding) step; the next idle step resets it.
        hidingFrom = 'exit';
        out.release = true;
        scheduleNext(state, lane, input.laneT);
      }
      break;
    case 'perch':
      if (!input.perchWanted && input.perchOut && input.entryOut) {
        state.mode = 'idle';
        state.modeT = 0;
        state.s = 0;
        hidingFrom = 'perch';
      }
      break;
  }

  // Pose: the perch, else the lane point (the start while idle / pending; the end on the exit's hiding step).
  const frame = out.frame;
  if ((state.mode === 'perch' || hidingFrom === 'perch') && lane.spec.perch !== null) {
    const p = lane.spec.perch;
    frame.x = p.x;
    frame.y = p.y;
    frame.z = p.z;
    frame.yaw = p.yaw;
    frame.pitch = 0;
    frame.bank = 0;
    state.bank = 0;
    state.pitch = 0;
  } else {
    sampleSkyLane(lane, state.s, frame);
    if (state.mode === 'pass' || state.mode === 'exit') {
      const k = dt > 0 ? 1 - Math.exp(-dt / LANE_TILT_TAU_S) : 0;
      const bankTarget = state.mode === 'exit' ? 0 : frame.bank;
      state.bank += (bankTarget - state.bank) * k;
      state.pitch += (frame.pitch - state.pitch) * k;
    } else {
      state.bank = 0;
      state.pitch = frame.pitch;
    }
    frame.bank = state.bank;
    frame.pitch = state.pitch;
  }
  out.wantsVisible = laneFlyerVisible(state);
  return out;
}

/** The flyer's latch wish: shown only in a pass, while leaving the frame, or perched. */
export function laneFlyerVisible(state: LaneFlyerState): boolean {
  return state.mode === 'pass' || state.mode === 'exit' || state.mode === 'perch';
}

/** The phase pin: idle at the lane start, the clock at `t`, the first pass re-armed. */
export function pinLaneFlyer(state: LaneFlyerState, lane: SkyLane): void {
  state.mode = 'idle';
  state.s = 0;
  state.modeT = 0;
  state.n = 0;
  state.nextPassT = lanePass(state.seed, lane.spec.id, 0);
  state.accentAt = laneAccentAt(state.seed, lane.spec.id, 0);
  state.accentDone = false;
  state.forcePending = false;
  state.forcedRequest = false;
  state.bank = 0;
  state.pitch = 0;
}
