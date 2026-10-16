/**
 * Particle discipline — the W1 law for every ambient particle actor (sakura
 * petals, mountain snow, clouds wind streaks): a particle may dress the air,
 * but it may never occlude, dim or fight a data surface.
 *
 * Four terms, one contract shared by the shaders and these tests:
 *
 * 1. NEAR-CAMERA FADE — a particle closer than `NEAR_FADE.startM` to the eye
 *    is invisible and fades in by `NEAR_FADE.endM`, so nothing ever becomes
 *    a lens-sized blur drifting across a board.
 * 2. POINT-SIZE CLAMP — the perspective size law (`size · 12 / depth`) is
 *    capped at `POINT_SIZE_MAX_CSS_PX` CSS px (× the pixel ratio), so no
 *    point sprite grows into a giant soft disc even just past the fade.
 * 3. CONTENT CORRIDOR — the rectangular view wedge from the LIVE eye to the
 *    active station's data face (its frozen look-at station, the face's
 *    centre and half extents from the theme's layout data) is kept clear:
 *    particles inside it fade out, with a soft rim so the edge never reads
 *    as a hard mask. Up to `CORRIDOR_SLOTS` corridors are live at once —
 *    the two stations the conductor lies between, each weighted by its
 *    proximity — so the clear wedge cross-fades with the camera instead of
 *    snapping at a station boundary.
 * 4. STATION DENSITY — the per-station `world.particles` channel
 *    (chapters.ts), which had no consumer, now thins the field: the
 *    channel is normalised against the theme's densest station and mapped
 *    onto [`CHANNEL_FLOOR`, 1], and each particle keeps or drops by a
 *    per-particle hash of its seed (a density, not an alpha dim — the
 *    particles that remain stay crisp).
 *
 * Honest limits (disclosed, never sold as more): the corridor is an
 * analytic wedge toward an AUTHORED face rectangle, not a depth-buffer or
 * screen-space test — a face whose true silhouette is yawed away from the
 * eye is covered conservatively (the wedge is at least as wide as the
 * face). Station-to-face mapping is by station id; a focus pose that frames
 * a different subject than its station's face keeps only the near fade and
 * the size clamp. Everything is deterministic in the camera pose, the
 * conductor position and `uTime`, so the capture harness's phase pin holds.
 *
 * Ladder: this module adds no effect and no draw — it only REMOVES paint
 * from existing particle fields, so it rides the existing
 * `particleDensity` rung field (count × density) and needs no rung of its
 * own. Pure data + math — no client-only imports.
 */

import type { RouteStation, Vec3 } from './chapters';
import type { DataFace } from './data-surfaces';

/** Near-camera fade band (metres from the eye): invisible below start, full by end. */
export const NEAR_FADE = { startM: 1.5, endM: 3.0 } as const;

/** Largest on-screen point sprite, in CSS px (the shader multiplies by the pixel ratio). */
export const POINT_SIZE_MAX_CSS_PX = 18;

/** Density floor: the calmest station keeps this share of the field. */
export const CHANNEL_FLOOR = 0.35;

/** Soft rim beyond the wedge edge, as a fraction of the half extent. */
export const CORRIDOR_SOFT = 0.15;

/**
 * Corridor depth cut, as a fraction of the eye→face distance: particles
 * past the face plane are already depth-tested away behind the opaque
 * face, so the wedge ends just past it (soft over the last few percent).
 */
export const CORRIDOR_DEPTH_END = 1.04;

/** Corridor slots in the shader — the two stations the conductor lies between. */
export const CORRIDOR_SLOTS = 2;

/** One station's data face: centre and half extents in metres (world). */
export interface ContentFace {
  center: Vec3;
  halfWidth: number;
  halfHeight: number;
  /**
   * The RENDERED rectangles (framed board, bezel included) this corridor
   * must cover, when the face was derived by `coveringFace`. Read by the
   * debug readout and the tests that prove corridor ⊇ face on screen.
   */
  rects?: readonly FaceRect[];
}

/**
 * One rendered data rectangle in world space: a plane whose local +X is
 * swung by `yaw` about world Y (three's `rotation={[0, yaw, 0]}`), so its
 * right axis is (cos yaw, 0, −sin yaw) and its normal (sin yaw, 0, cos yaw).
 */
export interface FaceRect {
  center: Vec3;
  yaw: number;
  halfWidth: number;
  halfHeight: number;
}

/**
 * A data face (`data-surfaces.ts`, the wave-2 face law) as a rendered
 * rectangle, so a corridor can be derived from the SAME faces the keep-out
 * wedges use: `coveringFace(faces.map(faceRectOf), eyes, margin)`. Only the
 * face's yaw is kept — every data face stands vertical today; a tilted face
 * (the planned teams ledger rail) would be approximated by an upright
 * rectangle of the same size, so pass it a margin for the tilt.
 */
export function faceRectOf(face: DataFace): FaceRect {
  return {
    center: face.center,
    yaw: Math.atan2(face.normal[0], face.normal[2]),
    halfWidth: face.size.w / 2,
    halfHeight: face.size.h / 2,
  };
}

/** The four world corners of a rendered rectangle. */
export function rectCorners(rect: FaceRect): Vec3[] {
  const rx = Math.cos(rect.yaw) * rect.halfWidth;
  const rz = -Math.sin(rect.yaw) * rect.halfWidth;
  const [cx, cy, cz] = rect.center;
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) out.push([cx + sx * rx, cy + sy * rect.halfHeight, cz + sx * rz]);
  }
  return out;
}

/**
 * A corridor face that covers every corner of `rects` from every eye in
 * `eyes` (the station's desktop and mobile endpoints), plus `margin` metres.
 *
 * Fidelity W1 r3: the round-2 clouds faces were authored from the layout
 * ANCHORS, but the airship sails render `hullLift` (0.85–0.9 m) higher,
 * riding the hull — so the wedge sat below the painted face and streaks
 * crossed its kicker, headline and LIVE pill with hard cut-offs. Deriving
 * the corridor from the rendered rectangles removes that class of drift:
 * the centre starts at the rects' centroid and is pushed back along each
 * eye's ray until no corner lies past the corridor's depth end (a multi-
 * rank row or a yawed board's far corner), then the half extents are the
 * largest lateral reach of any corner measured in the wedge's own frame
 * (so a corner nearer the eye than the centre plane widens the wedge).
 */
export function coveringFace(rects: readonly FaceRect[], eyes: readonly Vec3[], margin: number): ContentFace {
  const corners = rects.flatMap(rectCorners);
  const n = Math.max(1, rects.length);
  let center: Vec3 = [
    rects.reduce((s, r) => s + r.center[0], 0) / n,
    rects.reduce((s, r) => s + r.center[1], 0) / n,
    rects.reduce((s, r) => s + r.center[2], 0) / n,
  ];
  for (let pass = 0; pass < 3; pass += 1) {
    for (const eye of eyes) {
      const d = sub(center, eye);
      const dd = Math.max(dot(d, d), 1e-6);
      const tMax = corners.reduce((m, c) => Math.max(m, dot(sub(c, eye), d) / dd), 0);
      if (tMax > 1) center = [eye[0] + d[0] * tMax, eye[1] + d[1] * tMax, eye[2] + d[2] * tMax];
    }
  }
  let halfWidth = 0;
  let halfHeight = 0;
  for (const eye of eyes) {
    const d = sub(center, eye);
    const dd = Math.max(dot(d, d), 1e-6);
    let right = cross(d, [0, 1, 0]);
    if (Math.hypot(right[0], right[1], right[2]) < 1e-6) right = [1, 0, 0];
    const rightU = scaleTo(right, 1);
    const upU = scaleTo(cross(right, d), 1);
    for (const c of corners) {
      const rel = sub(c, eye);
      const t = Math.max(dot(rel, d) / dd, 1e-3);
      const lateral: Vec3 = [rel[0] - t * d[0], rel[1] - t * d[1], rel[2] - t * d[2]];
      halfWidth = Math.max(halfWidth, Math.abs(dot(lateral, rightU)) / t);
      halfHeight = Math.max(halfHeight, Math.abs(dot(lateral, upU)) / t);
    }
  }
  return { center, halfWidth: halfWidth + margin, halfHeight: halfHeight + margin, rects };
}

/** A theme's data faces keyed by station id. */
export type StationFaces = Readonly<Record<string, ContentFace>>;

/** A corridor the shader consumes: its face plus a proximity weight in [0, 1]. */
export interface WeightedFace {
  face: ContentFace;
  weight: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Near-camera visibility in [0, 1] for a particle `distanceM` from the eye. */
export function nearFade(distanceM: number): number {
  return smoothstep(NEAR_FADE.startM, NEAR_FADE.endM, distanceM);
}

/**
 * The shader's point size law, clamped: `size · pixelRatio · 12 / depth`
 * capped at `POINT_SIZE_MAX_CSS_PX · pixelRatio`. Returns device px.
 */
export function pointSizePx(size: number, depthM: number, pixelRatio: number): number {
  const raw = (size * pixelRatio * 12) / Math.max(depthM, 1e-3);
  return Math.min(raw, POINT_SIZE_MAX_CSS_PX * pixelRatio);
}

/**
 * The station density multiplier: the sampled `particles` channel
 * normalised against the theme's densest station, mapped onto
 * [`CHANNEL_FLOOR`, 1]. A theme with no particle channel authored (max 0)
 * keeps the whole field.
 */
export function channelDensity(particles: number, maxParticles: number): number {
  if (!(maxParticles > 0)) return 1;
  const norm = Math.min(1, Math.max(0, particles / maxParticles));
  return CHANNEL_FLOOR + (1 - CHANNEL_FLOOR) * norm;
}

/** The densest station's `particles` value across a ledger. */
export function maxStationParticles(stations: readonly RouteStation[]): number {
  return stations.reduce((max, station) => Math.max(max, station.world.particles), 0);
}

/**
 * Per-particle keep factor for the density term: the particle's hash in
 * [0, 1) against the density, with a narrow soft edge so a rising density
 * fades particles in rather than popping them. Mirrors `pdDensityKeep`.
 */
export function densityKeep(hash: number, density: number): number {
  return Math.min(1, Math.max(0, (density - hash) * 12 + 0.5));
}

/** The shader's per-particle hash of its seed (mirrors `pdHash`). */
export function particleHash(seed: number): number {
  const v = seed * 7.31 + 0.137;
  return v - Math.floor(v);
}

/**
 * The corridors live at a conductor position: the floor and ceil stations,
 * each weighted `1 − |position − index|`. Stations without an authored face
 * contribute nothing. Always returns exactly `CORRIDOR_SLOTS` entries or
 * fewer (never more).
 */
export function activeCorridors(
  stations: readonly RouteStation[],
  faces: StationFaces,
  position: number,
): WeightedFace[] {
  const last = stations.length - 1;
  if (last < 0 || !Number.isFinite(position)) return [];
  const p = Math.min(last, Math.max(0, position));
  const i0 = Math.floor(p);
  const i1 = Math.min(last, i0 + 1);
  const frac = p - i0;
  const out: WeightedFace[] = [];
  const push = (index: number, weight: number) => {
    const face = faces[stations[index].id];
    if (face && weight > 0) out.push({ face, weight });
  };
  push(i0, 1 - frac);
  if (i1 !== i0) push(i1, frac);
  return out.slice(0, CORRIDOR_SLOTS);
}

/** Wedge basis the shader receives per corridor: right/up pre-divided by the half extents. */
export interface CorridorBasis {
  center: Vec3;
  /** Unit right (⊥ eye→face, horizontal) divided by `halfWidth`. */
  right: Vec3;
  /** Unit up (⊥ eye→face and right) divided by `halfHeight`. */
  up: Vec3;
}

function sub(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function scaleTo(v: Vec3, length: number): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return [0, 0, 0];
  const k = length / len;
  return [v[0] * k, v[1] * k, v[2] * k];
}

/**
 * The wedge basis from the live eye to a face. `right` is horizontal (world
 * up × view), `up` completes the frame; both are pre-divided by the face's
 * half extents so the shader's wedge metric is a plain max(|x|, |y|).
 */
export function corridorBasis(eye: Vec3, face: ContentFace): CorridorBasis {
  const d = sub(face.center, eye);
  let right = cross(d, [0, 1, 0]);
  if (Math.hypot(right[0], right[1], right[2]) < 1e-6) right = [1, 0, 0];
  const up = cross(right, d);
  return {
    center: face.center,
    right: scaleTo(right, 1 / Math.max(face.halfWidth, 1e-3)),
    up: scaleTo(up, 1 / Math.max(face.halfHeight, 1e-3)),
  };
}

/**
 * Visibility of a world point against one corridor, in [0, 1] (1 = clear
 * of the wedge). Mirrors the GLSL `pdCorridorKeep` term exactly.
 */
export function corridorKeep(point: Vec3, eye: Vec3, basis: CorridorBasis, weight: number): number {
  const d = sub(basis.center, eye);
  const rel = sub(point, eye);
  const t = dot(rel, d) / Math.max(dot(d, d), 1e-4);
  const lateral: Vec3 = [rel[0] - t * d[0], rel[1] - t * d[1], rel[2] - t * d[2]];
  const r = Math.max(Math.abs(dot(lateral, basis.right)), Math.abs(dot(lateral, basis.up))) / Math.max(t, 1e-3);
  const inside =
    (1 - smoothstep(1, 1 + CORRIDOR_SOFT, r)) *
    (t >= 0 ? 1 : 0) *
    (1 - smoothstep(1, CORRIDOR_DEPTH_END, t));
  return 1 - inside * weight;
}

/** Combined visibility of a world point against every active corridor. */
export function corridorsKeep(point: Vec3, eye: Vec3, corridors: readonly WeightedFace[]): number {
  let keep = 1;
  for (const { face, weight } of corridors) keep *= corridorKeep(point, eye, corridorBasis(eye, face), weight);
  return keep;
}

/**
 * GLSL shared by every particle vertex shader. Declares the discipline
 * uniforms and three helpers; the numeric constants are baked from this
 * module so shader and tests can never drift. `cameraPosition` is the
 * built-in three.js ShaderMaterial uniform (world-space eye).
 */
export const PARTICLE_DISCIPLINE_GLSL = /* glsl */ `
  uniform vec3 uCorCenter[${CORRIDOR_SLOTS}];
  uniform vec3 uCorRight[${CORRIDOR_SLOTS}];
  uniform vec3 uCorUp[${CORRIDOR_SLOTS}];
  uniform float uCorWeight[${CORRIDOR_SLOTS}];
  uniform float uDensity;

  float pdNearFade(float dist) {
    return smoothstep(${NEAR_FADE.startM.toFixed(3)}, ${NEAR_FADE.endM.toFixed(3)}, dist);
  }

  float pdHash(float seed) {
    return fract(seed * 7.31 + 0.137);
  }

  float pdDensityKeep(float seed) {
    return clamp((uDensity - pdHash(seed)) * 12.0 + 0.5, 0.0, 1.0);
  }

  float pdCorridorKeep(vec3 wp) {
    float keep = 1.0;
    for (int i = 0; i < ${CORRIDOR_SLOTS}; i++) {
      vec3 d = uCorCenter[i] - cameraPosition;
      vec3 rel = wp - cameraPosition;
      float t = dot(rel, d) / max(dot(d, d), 1e-4);
      vec3 lateral = rel - t * d;
      float r = max(abs(dot(lateral, uCorRight[i])), abs(dot(lateral, uCorUp[i]))) / max(t, 1e-3);
      float inside = (1.0 - smoothstep(1.0, ${(1 + CORRIDOR_SOFT).toFixed(3)}, r))
        * step(0.0, t)
        * (1.0 - smoothstep(1.0, ${CORRIDOR_DEPTH_END.toFixed(3)}, t));
      keep *= 1.0 - inside * uCorWeight[i];
    }
    return keep;
  }
`;
