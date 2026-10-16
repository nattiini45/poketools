/**
 * Station-fitted key shadow (LOOK-PLAN §1.2 / §2 SEAT L item 4).
 *
 * One directional shadow map of a CONSTANT size over a CONSTANT light-space
 * box (plaza: 1024 texels over 32 × 32 m → 3.1 cm/texel, was 5.9 over the
 * old 60 m frustum). The box never resizes — only its centre moves: it lerps
 * between per-station receiver centroids on the conductor's smooth position
 * (the same progress sample the camera rig reads), and it is snapped to
 * whole texels in the light's own right/up axes so a moving box does not
 * shimmer the shadow edges.
 *
 * A receiver centroid is the ground-plane midpoint between a station's
 * landed eye (the mobile endpoint pulled back by the aspect's dolly, as the
 * rig lands it) and its look target: the stretch of plaza the station frames.
 *
 * Pure maths — no three import, safe in tests.
 */

import { endpointFor, type RouteStation, type Vec3 } from './chapters';

/** The fixed light-space box and map of a fitted shadow. */
export interface ShadowFitRig {
  /** Box edge in metres (light space, square). */
  box: number;
  /** Shadow-map edge in texels. */
  mapSize: number;
}

/** Orthonormal basis of a directional light's shadow camera. */
export interface LightBasis {
  right: Vec3;
  up: Vec3;
  /** Unit direction the shadow camera looks along (from the light toward the scene). */
  forward: Vec3;
}

/** A fitted shadow: where the light's target sits and the (constant) ortho half-extent. */
export interface ShadowFit {
  /** Snapped box centre — the light target; the light sits at centre + key offset. */
  center: Vec3;
  /** Constant orthographic half-extent (box / 2). */
  halfExtent: number;
  /** World metres per shadow texel (box / mapSize). */
  texel: number;
}

const WORLD_UP: Vec3 = [0, 1, 0];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
}

/**
 * The shadow camera's basis for a key coming FROM `keyDirection` (toward the
 * light, any length). Matches `Matrix4.lookAt(eye, target, up)` for an eye
 * on that direction: `forward` points from the light into the scene.
 */
export function lightBasis(keyDirection: Vec3): LightBasis {
  const forward = normalize(scale(keyDirection, -1));
  // three's lookAt: z = eye − target (= −forward); x = up × z; y = z × x.
  const z = scale(forward, -1);
  let x = cross(WORLD_UP, z);
  if (Math.hypot(x[0], x[1], x[2]) < 1e-6) x = cross([0, 0, 1], z);
  const right = normalize(x);
  const up = normalize(cross(z, right));
  return { right, up, forward };
}

/**
 * Snap a world point to whole texels along the light's right/up axes
 * (the depth axis is free — it does not move texels on screen).
 */
export function snapToTexel(point: Vec3, basis: LightBasis, texel: number): Vec3 {
  if (!(texel > 0)) return point;
  const r = dot(point, basis.right);
  const u = dot(point, basis.up);
  const f = dot(point, basis.forward);
  const rs = Math.round(r / texel) * texel;
  const us = Math.round(u / texel) * texel;
  return add(add(scale(basis.right, rs), scale(basis.up, us)), scale(basis.forward, f));
}

/**
 * Receiver centroid per station, on the ground plane: the midpoint of the
 * landed eye and the look target. `pullback` is the rig's dolly-back for the
 * current aspect (0 on desktop; `pullbackForAspect`).
 */
export function stationReceiverCentroids(
  stations: readonly RouteStation[],
  mobile: boolean,
  pullback = 0,
): Vec3[] {
  return stations.map((station) => {
    const { position, target } = endpointFor(station, mobile);
    const back = normalize(sub(position, target));
    const eye = add(position, scale(back, pullback));
    return [(eye[0] + target[0]) / 2, 0, (eye[2] + target[2]) / 2];
  });
}

/** Piecewise-linear centroid at a (fractional, clamped) station position. */
export function centroidAt(centroids: readonly Vec3[], position: number): Vec3 {
  if (centroids.length === 0) return [0, 0, 0];
  const p = Math.min(Math.max(position, 0), centroids.length - 1);
  const i = Math.min(Math.floor(p), centroids.length - 1);
  const j = Math.min(i + 1, centroids.length - 1);
  const t = p - i;
  const a = centroids[i];
  const b = centroids[j];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * The fitted shadow at `position`: centroid lerp, texel snap, constant
 * extent. Same inputs → same output (no state), so a capture re-shot at a
 * pinned position renders the same shadow.
 */
export function fitStationShadow(
  centroids: readonly Vec3[],
  position: number,
  basis: LightBasis,
  rig: ShadowFitRig,
): ShadowFit {
  const texel = rig.box / rig.mapSize;
  return {
    center: snapToTexel(centroidAt(centroids, position), basis, texel),
    halfExtent: rig.box / 2,
    texel,
  };
}
