/**
 * Analytic figure visibility (W4 "no wasted Pokémon"; fidelity proposal S6).
 *
 * The W4 bar: every placed figure is visible from its chapter composition, or
 * it has an authored reveal. Until now the only guard was one-off projection
 * scans that treated "behind a content plane" as sanctioned backdrop; this
 * module turns the question into a pure, unit-testable number so a CI test
 * can fail when a figure becomes hidden (or when a known-hidden one is fixed
 * and its allowlist entry goes stale).
 *
 * Method, per figure and camera pose:
 *  1. Sample a 3 × 3 grid on the figure's camera-facing silhouette plane:
 *     heights 15 / 50 / 85 % of the figure, lateral −40 / 0 / +40 % of its
 *     footprint width across the view.
 *  2. Project each sample with the pose's perspective camera (vertical fov,
 *     the viewport aspect). In-frustum = in front of the eye and inside NDC
 *     [−1, 1]².
 *  3. For in-frustum samples, cast the eye → sample segment against the
 *     scene's obstacles: yawed boxes (oriented about +Y — banner cloths, sign
 *     rows and sails are yawed to their eye, and an axis-aligned box around a
 *     yawed thin panel would over-report occlusion) and an optional ground
 *     height field (the mountain knoll).
 *
 * Honest limits (disclosed, not hidden):
 *  - Occluders are hand-restated boxes from the layout tables and component
 *    constants, not the rendered meshes. Round rocks and hulls are boxed
 *    inside their bounding ellipsoid; alpha-card tree canopies, particles and
 *    thin props (poles, ropes, lanterns' openwork) are not modelled.
 *  - A figure is a box of its manifest bounds at Pokédex height; idle poses,
 *    wings and tails are not sampled. Nine samples resolve occlusion to about
 *    one ninth of the silhouette.
 *  - Figure-on-figure occlusion uses shrunk boxes (bodies are not boxes).
 *  - This is a static composition check at the authored endpoints (desktop and
 *    the landed 390 pose). Moving behaviors (patrol, floating, airborne) need
 *    their own sweep; captures remain the evidence of record.
 *
 * Pure math — no client-only imports.
 */

import type { CameraEndpoint, RouteStation, Vec3 } from './chapters';
import { landedEndpoint } from './legibility';

/** A box yawed about +Y: `center` in world metres, `half` extents in its own frame. */
export interface Obstacle {
  id: string;
  center: Vec3;
  half: Vec3;
  /** Yaw (radians) of the box's local frame; 0 = axis-aligned. */
  yaw?: number;
}

/** One placed figure, as the analytic audit sees it. */
export interface FigureBox {
  id: string;
  x: number;
  z: number;
  /** Feet height (pedestal/plinth/deck top included). */
  baseY: number;
  heightM: number;
  /** Footprint width (m) — the lateral extent sampled across the view. */
  widthM: number;
}

export interface VisibilityPose {
  id: string;
  camera: CameraEndpoint;
  /** Viewport width / height. */
  aspect: number;
}

export interface VisibilityScene {
  obstacles: readonly Obstacle[];
  /** Optional terrain height at (x, z); a sample below it is blocked. */
  ground?: (x: number, z: number) => number;
}

export interface VisibilityResult {
  poseId: string;
  /** Samples inside the view frustum / all samples. */
  onScreenFraction: number;
  /** Blocked samples / in-frustum samples (0 when none is in frustum). */
  occludedFraction: number;
  /** In-frustum AND unblocked samples / all samples. */
  visibleFraction: number;
  /** At least half the silhouette is inside the frame. */
  onScreen: boolean;
  /** Ids of every obstacle that blocked at least one sample. */
  blockers: string[];
}

/** Capture viewports of record (legibility.ts VIEWPORT_H_*; capture-route). */
export const DESKTOP_ASPECT = 1440 / 900;
export const MOBILE_390_ASPECT = 390 / 844;

/** A figure counts as wasted at a pose when this much of it is hidden. */
export const WASTED_THRESHOLD = 0.5;

const HEIGHT_SAMPLES = [0.15, 0.5, 0.85] as const;
const LATERAL_SAMPLES = [-0.4, 0, 0.4] as const;
/** Ground-ray march resolution (m). */
const GROUND_STEP_M = 0.25;

function sub(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalize(v: readonly [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Camera basis (right, up, forward) for a look-at pose with world +Y up. */
function basis(camera: CameraEndpoint) {
  const forward = normalize(sub(camera.target, camera.position));
  let right = cross(forward, [0, 1, 0]);
  if (Math.hypot(right[0], right[1], right[2]) < 1e-6) right = [1, 0, 0];
  right = normalize(right);
  const up = cross(right, forward);
  return { forward, right, up };
}

export interface Projection {
  ndcX: number;
  ndcY: number;
  /** Distance along the view axis (m); ≤ 0 is behind the eye. */
  depth: number;
}

/** Perspective projection of a world point for a pose (three.js conventions). */
export function projectPoint(point: Vec3, camera: CameraEndpoint, aspect: number): Projection {
  const { forward, right, up } = basis(camera);
  const rel = sub(point, camera.position);
  const depth = dot(rel, forward);
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  if (depth <= 1e-6) return { ndcX: Infinity, ndcY: Infinity, depth };
  return {
    ndcX: dot(rel, right) / (depth * tanHalf * aspect),
    ndcY: dot(rel, up) / (depth * tanHalf),
    depth,
  };
}

export function inFrustum(p: Projection): boolean {
  return p.depth > 0.05 && Math.abs(p.ndcX) <= 1 && Math.abs(p.ndcY) <= 1;
}

/**
 * Does the open segment eye → point pass through the yawed box? Slab test in
 * the box's local frame; hits at the very ends (t ≈ 0 or 1) are ignored so a
 * sample on a surface is not blocked by that surface.
 */
export function segmentHitsObstacle(eye: Vec3, point: Vec3, obstacle: Obstacle): boolean {
  const yaw = obstacle.yaw ?? 0;
  const c = Math.cos(-yaw);
  const s = Math.sin(-yaw);
  const toLocal = (p: Vec3): [number, number, number] => {
    const dx = p[0] - obstacle.center[0];
    const dy = p[1] - obstacle.center[1];
    const dz = p[2] - obstacle.center[2];
    // Rotation about +Y by −yaw (three.js: x' = x cos + z sin, z' = −x sin + z cos).
    return [dx * c + dz * s, dy, -dx * s + dz * c];
  };
  const o = toLocal(eye);
  const e = toLocal(point);
  const d = [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
  let t0 = 1e-4;
  let t1 = 1 - 1e-4;
  for (let axis = 0; axis < 3; axis += 1) {
    const h = obstacle.half[axis];
    if (Math.abs(d[axis]) < 1e-12) {
      if (o[axis] < -h || o[axis] > h) return false;
      continue;
    }
    let a = (-h - o[axis]) / d[axis];
    let b = (h - o[axis]) / d[axis];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

function groundBlocks(eye: Vec3, point: Vec3, ground: (x: number, z: number) => number): boolean {
  const length = Math.hypot(point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]);
  const steps = Math.max(2, Math.ceil(length / GROUND_STEP_M));
  // Skip the last metre: the figure stands ON the ground there.
  const stop = Math.max(0, 1 - 1 / Math.max(length, 1));
  for (let i = 1; i < steps; i += 1) {
    const t = (i / steps) * stop;
    const x = eye[0] + (point[0] - eye[0]) * t;
    const y = eye[1] + (point[1] - eye[1]) * t;
    const z = eye[2] + (point[2] - eye[2]) * t;
    if (ground(x, z) > y) return true;
  }
  return false;
}

/** The 3 × 3 silhouette samples of a figure seen from `eye`. */
export function figureSamples(figure: FigureBox, eye: Vec3): Vec3[] {
  const vx = figure.x - eye[0];
  const vz = figure.z - eye[2];
  const len = Math.hypot(vx, vz) || 1;
  // Horizontal axis perpendicular to the view: the silhouette's width axis.
  const px = -vz / len;
  const pz = vx / len;
  const out: Vec3[] = [];
  for (const h of HEIGHT_SAMPLES) {
    for (const l of LATERAL_SAMPLES) {
      out.push([figure.x + px * l * figure.widthM, figure.baseY + h * figure.heightM, figure.z + pz * l * figure.widthM]);
    }
  }
  return out;
}

/**
 * Visibility of one figure from one pose. Obstacles whose id is in `ignore`
 * (the figure's own proxy box, its own pedestal) are skipped.
 */
export function figureVisibility(
  figure: FigureBox,
  pose: VisibilityPose,
  scene: VisibilityScene,
  ignore: readonly string[] = [],
): VisibilityResult {
  const eye = pose.camera.position;
  const samples = figureSamples(figure, eye);
  let inside = 0;
  let blocked = 0;
  const blockers = new Set<string>();
  for (const sample of samples) {
    if (!inFrustum(projectPoint(sample, pose.camera, pose.aspect))) continue;
    inside += 1;
    let hit = false;
    for (const obstacle of scene.obstacles) {
      if (ignore.includes(obstacle.id)) continue;
      if (segmentHitsObstacle(eye, sample, obstacle)) {
        hit = true;
        blockers.add(obstacle.id);
      }
    }
    if (!hit && scene.ground && groundBlocks(eye, sample, scene.ground)) {
      hit = true;
      blockers.add('ground');
    }
    if (hit) blocked += 1;
  }
  const n = samples.length;
  return {
    poseId: pose.id,
    onScreenFraction: inside / n,
    occludedFraction: inside > 0 ? blocked / inside : 0,
    visibleFraction: (inside - blocked) / n,
    onScreen: inside / n >= 0.5,
    blockers: [...blockers].sort(),
  };
}

/** Wasted at this pose: mostly out of frame, or mostly blocked. */
export function isWasted(result: VisibilityResult): boolean {
  return !result.onScreen || result.occludedFraction >= WASTED_THRESHOLD;
}

/**
 * The two poses a station is judged at: the authored desktop endpoint (1440
 * × 900) and the LANDED 390 pose (`cameraMobile` pulled back by the rig's
 * MAX_PULLBACK — the same geometry the legibility floors use).
 */
export function stationPoses(station: RouteStation): VisibilityPose[] {
  return [
    { id: `${station.id}:desktop`, camera: station.camera, aspect: DESKTOP_ASPECT },
    { id: `${station.id}:landed390`, camera: landedEndpoint(station.cameraMobile), aspect: MOBILE_390_ASPECT },
  ];
}

/**
 * A figure as an occluder for its neighbours: its box shrunk (bodies are not
 * boxes — a 0.7 width/height factor keeps shoulders and heads from blocking
 * rays that would really pass beside or over them).
 */
export function figureObstacle(figure: FigureBox, shrink = 0.7): Obstacle {
  const h = figure.heightM * shrink;
  return {
    id: `figure:${figure.id}`,
    center: [figure.x, figure.baseY + h / 2, figure.z],
    half: [(figure.widthM * shrink) / 2, h / 2, (figure.widthM * shrink) / 2],
  };
}

/** A panel of `width × height` (thin) at a local offset inside a yawed group. */
export function yawedPanel(
  id: string,
  group: { x: number; z: number; yaw: number },
  local: Vec3,
  half: Vec3,
): Obstacle {
  const c = Math.cos(group.yaw);
  const s = Math.sin(group.yaw);
  // three.js rotation about +Y: world = (x c + z s, y, −x s + z c).
  return {
    id,
    center: [group.x + local[0] * c + local[2] * s, local[1], group.z - local[0] * s + local[2] * c],
    half,
    yaw: group.yaw,
  };
}
