/**
 * Rules sun shafts — the placement law (LOOK-PLAN §1.3 "Rules", §2 SEAT M
 * item 1).
 *
 * The #rules camera looks south into the low golden key (contre-jour, the sun
 * ≈ 47° right of the axis). Up to three axial-billboard shafts slant down the
 * key's travel direction through the south-west lime canopy and street gap
 * and land on the setts left of the gate, beside the right-hand plaque as the
 * rules camera sees it. This module decides WHERE, as pure data + math:
 *
 * - A shaft is a segment from its ground landing point (the "pool") back up
 *   the key direction toward the sun, `SHAFT_LIMITS.length` metres long and
 *   `SHAFT_LIMITS.width` wide. The billboard turns about that axis to face
 *   the eye, so its footprint is the swept sphere of radius half-width +
 *   `SHAFT_CLEARANCE_M` along the axis.
 * - `solveShaftSeats` slides candidates (pool on a grid inside
 *   `SHAFT_TARGET_BOX`, each allowed length and width) and keeps the ones
 *   whose `SHAFT_AXIS_SAMPLES` axis samples clear EVERY keep-out wedge of the
 *   world (`data-surfaces.ts`: desktop, 768, landed 390, focus and dolly
 *   poses of every face — a superset of the rules wedges the plan names)
 *   and whose lower run is in frame at the rules desktop pose. Threading a
 *   lime crown (as the rules eye sees it) scores first. Pools are kept apart
 *   so three shafts never merge into one slab.
 * - `plazaShaftSeats()` is the shipped table. The solver is too slow to run
 *   inside the load ceremony (hundreds of wedges × thousands of samples), so
 *   the table is the solver's output frozen as data, and
 *   `__tests__/light-shafts.test.ts` re-solves and requires equality — the
 *   table can never drift from the law it was solved under.
 *
 * Fewer seats are shipped rather than a loosened pad (LOOK-PLAN §6): with 0
 * seats the raking lilac shadows and the backlit canopy carry rules alone.
 *
 * Pure math — no client-only imports.
 */

import type { CameraEndpoint, Vec3 } from './chapters';
import { screenPoint, type KeepOut, type Viewport } from './data-surfaces';

/** Where landing pools must sit (plaza ground, metres): left of the gate, in front of the lime pair. */
export const SHAFT_TARGET_BOX = { x: [-8, -4], z: [4, 9] } as const;

/** Shaft extents (metres). Length runs from the pool back up toward the sun. */
export const SHAFT_LIMITS = {
  length: [14, 26],
  // LOOK r6: narrower ground seats (r6 capture i9: a 1.6 m seat × the pool taper
  // read as a milky wedge over the planter, not a beam).
  width: [0.7, 1.3],
} as const;

/** Samples along each axis the keep-out is tested at. */
export const SHAFT_AXIS_SAMPLES = 12;

/** Extra clearance around the billboard's half-width (metres). */
export const SHAFT_CLEARANCE_M = 0.15;

/** Most shafts the rules moment ever shows (quality rung 0; `quality.lightShafts`). */
export const SHAFT_MAX = 3;

/**
 * Additive ceiling of a shaft, in linear light. LOOK-PLAN §1.3 planned
 * ≤ +0.08; LOOK r2/r3 judged that invisible under AgX ("rules has no
 * shafts"), so the beams take +0.2. They stay calm-masked behind every data
 * face and seated outside every keep-out wedge, so the cap buys visibility
 * only where no face is.
 */
export const SHAFT_MAX_LINEAR = 0.8;

/** Shaft colour (sRGB hex). */
// LOOK r6 (L4a): a deeper gold — against the blue sky and the cool cast shade the
// hue contrast carries the beam where additive value alone is crushed by AgX.
export const SHAFT_COLOR = '#ffc27a';

/** Minimum ground distance between two pools, so shafts read as separate beams. */
export const SHAFT_POOL_SPACING_M = 1.2;

/** A seat must show at least this much of its axis to the rules desktop eye (metres). */
export const SHAFT_MIN_VISIBLE_M = 2.5;

/** One seated shaft. `pool` is on the ground; `top` is up the key toward the sun. */
export interface ShaftSeat {
  id: string;
  pool: Vec3;
  top: Vec3;
  /** Billboard width (metres). */
  width: number;
  /** Axis length (metres). */
  length: number;
}

/** A canopy the shaft should thread (crown centre and radius, metres). */
export interface ShaftCanopy {
  center: Vec3;
  radius: number;
}

export interface ShaftSolveInput {
  keepOut: KeepOut;
  /** Direction TOWARD the key (theme `lights.keyDirection`), any length. */
  keyDirection: Vec3;
  /** Canopies a shaft may slant through; a seat must pass inside at least one. */
  canopies: readonly ShaftCanopy[];
  /** The rules desktop eye: every pool must be in its frame. */
  frame: { camera: CameraEndpoint; viewport: Viewport };
  /** Ground height of the pools (plaza floor 0). */
  groundY?: number;
  /** Grid step over the target box (metres). */
  gridStepM?: number;
  max?: number;
}

type V3 = [number, number, number];

function normalize(v: Vec3): V3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return [0, 1, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Top of a shaft: `length` metres from the pool along the direction toward the key. */
export function shaftTop(pool: Vec3, keyDirection: Vec3, length: number): V3 {
  const d = normalize(keyDirection);
  return [round3(pool[0] + d[0] * length), round3(pool[1] + d[1] * length), round3(pool[2] + d[2] * length)];
}

/** The `n` evenly spaced axis samples of a seat, pool first, top last. */
export function shaftAxisSamples(seat: Pick<ShaftSeat, 'pool' | 'top'>, n: number = SHAFT_AXIS_SAMPLES): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 0 : i / (n - 1);
    out.push([
      seat.pool[0] + (seat.top[0] - seat.pool[0]) * t,
      seat.pool[1] + (seat.top[1] - seat.pool[1]) * t,
      seat.pool[2] + (seat.top[2] - seat.pool[2]) * t,
    ]);
  }
  return out;
}

/**
 * LOOK r6 (L4a): the rendered beam's width along its axis, as a multiple of
 * the seat width — wide at the pool, tapering toward the sun
 * (`SunShafts.tsx` vertex: `aWidth · mix(pool, top, t)`). The brief's 1.6×
 * pool read as a milky wedge on the ground seats close to the rules eye
 * (capture i9); 1.3× keeps the taper and a defined beam.
 */
export const SHAFT_TAPER = { pool: 1.3, top: 0.7 } as const;

/**
 * Swept-sphere radius a seat is tested with: the WIDEST rendered half-width
 * (the pool's taper) plus the clearance — the law holds the drawn beam, never
 * a narrower stand-in (LOOK r6 tightened this from `width / 2`; never loosened).
 */
export function shaftSampleRadius(width: number): number {
  return (width * Math.max(SHAFT_TAPER.pool, SHAFT_TAPER.top)) / 2 + SHAFT_CLEARANCE_M;
}

/** Does every axis sample of the seat clear every wedge? */
export function shaftClears(keepOut: KeepOut, seat: Pick<ShaftSeat, 'pool' | 'top' | 'width'>): boolean {
  const r = shaftSampleRadius(seat.width);
  return shaftAxisSamples(seat).every((p) => keepOut.sphereClear(p, r));
}

/** Is the pool inside the target box? */
export function poolInTargetBox(pool: Vec3): boolean {
  return (
    pool[0] >= SHAFT_TARGET_BOX.x[0] - 1e-9 &&
    pool[0] <= SHAFT_TARGET_BOX.x[1] + 1e-9 &&
    pool[2] >= SHAFT_TARGET_BOX.z[0] - 1e-9 &&
    pool[2] <= SHAFT_TARGET_BOX.z[1] + 1e-9
  );
}

/**
 * How deep (0..1, 1 = through the centre) the shaft threads the best canopy
 * AS THE RULES EYE SEES IT: the largest `1 − d / r` over the axis samples,
 * with `d` the screen distance from a sample to a crown's projected centre
 * and `r` the crown's projected radius; 0 = the axis misses every crown.
 *
 * Honest limit: this is a picture-plane test, not a 3D one. The key is low
 * (≈ 21°), so a beam that physically passes a 3–5 m crown lands ≈ 11 m
 * down-sun of it — never in the target box beside the gate. The shaft
 * instead rises from the box into the south-west street gap BEHIND the lime
 * crown, and reads through it from the rules camera, which is the moment the
 * plan asks for.
 */
export function canopyThreading(
  seat: Pick<ShaftSeat, 'pool' | 'top'>,
  canopies: readonly ShaftCanopy[],
  frame: { camera: CameraEndpoint; viewport: Viewport },
): number {
  const samples = shaftAxisSamples(seat).map((p) => screenPoint(p, frame.camera, frame.viewport));
  let best = 0;
  for (const canopy of canopies) {
    const centre = screenPoint(canopy.center, frame.camera, frame.viewport);
    if (!centre) continue;
    const depth = Math.hypot(
      canopy.center[0] - frame.camera.position[0],
      canopy.center[1] - frame.camera.position[1],
      canopy.center[2] - frame.camera.position[2],
    );
    const pxPerM = frame.viewport.height / (2 * depth * Math.tan((frame.camera.fov * Math.PI) / 360));
    const r = canopy.radius * pxPerM;
    if (r <= 0) continue;
    for (const s of samples) {
      if (!s) continue;
      const d = Math.hypot(s.x - centre.x, s.y - centre.y);
      if (d < r) best = Math.max(best, 1 - d / r);
    }
  }
  return best;
}

function inFrame(p: Vec3, frame: ShaftSolveInput['frame']): boolean {
  const s = screenPoint(p, frame.camera, frame.viewport);
  if (!s) return false;
  return s.x >= 0 && s.x <= frame.viewport.width && s.y >= 0 && s.y <= frame.viewport.height;
}

/**
 * Metres of the axis the rules eye sees (in-frame axis samples × sample
 * spacing). The key sits ≈ 47° right of the rules axis, outside the 36°
 * lens, so every beam leaves the frame on its way up to the sun: what reads
 * is the lower run slanting down to its pool.
 */
export function shaftVisibleMetres(
  seat: Pick<ShaftSeat, 'pool' | 'top' | 'length'>,
  frame: { camera: CameraEndpoint; viewport: Viewport },
): number {
  const samples = shaftAxisSamples(seat);
  const spacing = seat.length / Math.max(1, samples.length - 1);
  return samples.filter((p) => inFrame(p, frame)).length * spacing;
}

function steps(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  const n = Math.max(0, Math.round((hi - lo) / step));
  for (let i = 0; i <= n; i += 1) out.push(round3(lo + (hi - lo) * (n === 0 ? 0 : i / n)));
  return out;
}

/**
 * Slide candidates through the target box and seat up to `max` shafts that
 * clear every wedge, land in frame at the rules desktop pose and show at
 * least `SHAFT_MIN_VISIBLE_M` of their axis there. Deterministic: each
 * (pool, length) keeps its widest clearing width; candidates are scored
 * (canopy threading, visible run, width) and taken greedily, best first,
 * with `SHAFT_POOL_SPACING_M` between pools.
 */
export function solveShaftSeats(input: ShaftSolveInput): ShaftSeat[] {
  const groundY = input.groundY ?? 0;
  const step = input.gridStepM ?? 0.25;
  const max = input.max ?? SHAFT_MAX;
  const lengths = steps(SHAFT_LIMITS.length[0], SHAFT_LIMITS.length[1], 3);
  const widths = steps(SHAFT_LIMITS.width[0], SHAFT_LIMITS.width[1], 0.35).reverse();
  const xs = steps(SHAFT_TARGET_BOX.x[0], SHAFT_TARGET_BOX.x[1], step);
  const zs = steps(SHAFT_TARGET_BOX.z[0], SHAFT_TARGET_BOX.z[1], step);

  interface Scored {
    seat: Omit<ShaftSeat, 'id'>;
    score: number;
    order: number;
  }
  const candidates: Scored[] = [];
  let order = 0;
  for (const x of xs) {
    for (const z of zs) {
      const pool: Vec3 = [x, groundY, z];
      if (!inFrame(pool, input.frame)) continue;
      for (const length of lengths) {
        const top = shaftTop(pool, input.keyDirection, length);
        const visible = shaftVisibleMetres({ pool, top, length }, input.frame);
        if (visible < SHAFT_MIN_VISIBLE_M) continue;
        const threading = canopyThreading({ pool, top }, input.canopies, input.frame);
        // Widest clearing width only: a narrower beam of the same axis is
        // never preferred over a wider one that also clears.
        for (const width of widths) {
          order += 1;
          if (!shaftClears(input.keepOut, { pool, top, width })) continue;
          candidates.push({
            seat: { pool, top, width, length },
            score: threading * 4 + Math.min(visible, 6) * 0.5 + width,
            order,
          });
          break;
        }
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.order - b.order);

  const chosen: ShaftSeat[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= max) break;
    const { pool } = candidate.seat;
    const apart = chosen.every((seat) => Math.hypot(seat.pool[0] - pool[0], seat.pool[2] - pool[2]) >= SHAFT_POOL_SPACING_M);
    if (!apart) continue;
    chosen.push({ id: `shaft:${chosen.length}`, ...candidate.seat });
  }
  return chosen;
}

/**
 * The shipped plaza seats (the solver's output under the plaza keep-out, the
 * plaza key direction and the south-west lime canopies, frozen as data; see
 * the module header). Ordered best first, so `quality.lightShafts = 1` keeps
 * the strongest beam.
 */
// LOOK r6 (L4a): re-solved under the tapered beam's real width (1.3× at the
// pool) and the r6 width limits — the r5 pools, narrower beams.
const PLAZA_SHAFT_SEATS: readonly ShaftSeat[] = [
  { id: 'shaft:0', pool: [-5, 0, 9], top: [-22.68, 8.16, 21.24], width: 0.7, length: 23 },
  { id: 'shaft:1', pool: [-5.25, 0, 7.75], top: [-25.236, 9.224, 21.587], width: 1.3, length: 26 },
  { id: 'shaft:2', pool: [-4.5, 0, 6.5], top: [-24.486, 9.224, 20.337], width: 0.7, length: 26 },
];

export function plazaShaftSeats(): readonly ShaftSeat[] {
  return PLAZA_SHAFT_SEATS;
}

/**
 * LOOK r5 (rules hero: "the only shaft is at the frame edge"): three GAP beams
 * hang in the air BEHIND the gate — they start above its cornice in the
 * street gap between the south blocks and climb toward the low sun, so the
 * rules eye sees golden beams in the sky gap at left-centre and right-centre
 * of the gate. Authored, not solved (the solver seats ground pools): every
 * gap seat lies wholly behind the gate's face plane (z ≥ `GAP_SHAFT_MIN_Z`,
 * beyond every rules wedge, which is cut at its face plane) and its test
 * holds the same keep-out law as the ground seats (every axis sample clears
 * every wedge of the world at every pose). The beam's `pool` is its lower,
 * in-air end (the shader fades it in there).
 */
export const GAP_SHAFT_MIN_Z = 18.5;

const GAP_SHAFT_LENGTH = 12;

function gapSeat(id: string, start: Vec3, width: number, keyDirection: Vec3): ShaftSeat {
  return { id, pool: start, top: shaftTop(start, keyDirection, GAP_SHAFT_LENGTH), width, length: GAP_SHAFT_LENGTH };
}

/** LOOK r6 (L4a): gap beam widths (metres) — broad enough to read as beams, not threads, spaced so they never merge. */
export const GAP_SHAFT_WIDTH = [1.2, 2.0] as const;

/**
 * The three gap beams for a key direction (pure; the plaza ships `plazaGapShaftSeats`).
 *
 * LOOK r6 (L4a, "one modest shaft at frame right"): the beams are WIDER
 * (1.2–1.6 m, tapering from 1.6× at the lower end), ≈ 2.6 m apart so they
 * never merge into a wash, and keep their strength to
 * near their top, each rising from just above the gate head across the street
 * gap toward the sun on the right, until the south-west block's hip hides it,
 * in front of the (deeper, L5) sky. Honest limit: the brief asked for beams
 * against shaded stone at y 2–6 m, but behind the gate plane (z ≥ 18.5, the
 * clarity guard) that band is hidden by the gate itself from the rules eye.
 * HERO FIRST: a rung that draws one beam (rung 2) keeps the centre one. Every seat stays wholly
 * behind the gate (z ≥ `GAP_SHAFT_MIN_Z`) and clears every wedge (the test).
 */
export function gapShaftSeats(keyDirection: Vec3): ShaftSeat[] {
  return [
    gapSeat('shaft:gap-hero', [1.2, 7.3, 19.2], 1.6, keyDirection),
    gapSeat('shaft:gap-left', [3.8, 7.0, 18.7], 1.2, keyDirection),
    gapSeat('shaft:gap-right', [-1.4, 7.7, 20.4], 1.3, keyDirection),
  ];
}
