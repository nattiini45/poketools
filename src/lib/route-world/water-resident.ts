/**
 * Water residents — the pure half (POKEMON-CORE-PLAN §4 SEAT D step 3; D35
 * 3D SHARED ACTORS; D8 water species live in the water).
 *
 * Three modes share one component (`WaterResident.tsx`): a FLOATER drifts in
 * a keep-out-proven disc and floats on the water field; a WADER walks to the
 * waterline and back (the existing `waterline` behaviour); a SURFACER waits
 * submerged, asks the beat bus for a `surfacing` hero beat, rises, holds and
 * sinks. This module is their clock-and-pose math:
 *
 *  - `buoyancyStep` (C10): the root's height and tilt from the water field,
 *    sampled at 4 points plus the centre (bow / stern at ±L/2 along the
 *    heading, port / starboard at ±B/2), WITHOUT ripples (a floater never
 *    bobs on its own wake — disclosed), or from the centre normal for a small
 *    body (L < 0.5 m). Pitch and roll are clamped to ±8°. The smoothing is
 *    the exact solution of a first-order lag under a linearly interpolated
 *    target (τ_y 0.25 s, τ_tilt 0.4 s), so 30 and 60 fps agree to well under
 *    a millimetre (tested) and a clamped 0.1 s spike cannot snap.
 *  - `maxBreachLift`: the breach / spin lift ceiling under the keep-out
 *    headroom (plan SEAT D step 3; the headroom is pinned per drift disc as
 *    the minimum over the disc, re-derived in a test — never computed at
 *    runtime, C17).
 *  - `stepSurfacer`: submerged (a seeded 40–70 s wait, or the `beatForce`
 *    second) → request → rise 1.4 s (a splash where the top breaks the
 *    surface) → hold 4–6 s (idle, idle2 once) → sink 1.6 s (a splash at 0.6)
 *    → submerged. The beat is released at the sink start; a dormant or
 *    downgraded surfacer mid-beat sinks at once and finishes the sink, then
 *    stops. It is visible only while its top is above `surfaceY − 0.05`:
 *    under the opaque water (surface 6 cm over the lawn; troughs reach at
 *    most `maxTroughDepth` < 5 cm) the show / hide flip is never seen.
 *
 * Time (D40, C9): every clock here advances by the clamped delta the figure
 * director hands each rendered frame; nothing reads wall time.
 *
 * D18: no species, type or stat literals — heights and dims come from the
 * cast figure's measured bounds at runtime.
 *
 * Pure: no React, no three, no DOM. Steady-state steps allocate nothing.
 */

import { hash01, mix32 } from './clip-phase';
import { MAX_STEP_S } from './figure-behavior';
import { createWaterSampleOut, sampleInto, type WaterBodySpec, type WaterSampleOut } from './water';

/* ------------------------------------------------------------------------ */
/* Buoyancy                                                                 */
/* ------------------------------------------------------------------------ */

/** Default draft (the share of the figure's height below the waterline). */
export const DRAFT_FRAC_DEFAULT = 0.35;
/** Tall, thin bodies ride higher. */
export const DRAFT_FRAC_TALL = 0.25;
export const DRAFT_FRAC_MIN = 0.15;
export const DRAFT_FRAC_MAX = 0.6;
/** Heave time constant (s). */
export const BUOY_TAU_Y_S = 0.25;
/** Pitch / roll time constant (s). */
export const BUOY_TAU_TILT_S = 0.4;
/** Pitch and roll clamp (rad): ±8°. */
export const BUOY_TILT_MAX_RAD = (8 * Math.PI) / 180;
/** Below this length the centre normal gives the tilt (4-point spread degenerates). */
export const SMALL_BODY_M = 0.5;
/** The null-handle fallback bob (m): the Lite-like case before the water commits. */
export const FALLBACK_BOB_M = 0.01;

export interface BuoyancyDims {
  /** Fitted figure height (m). */
  heightM: number;
  /** Extent along the heading (local +Z), m. */
  lengthM: number;
  /** Extent across (local X), m. */
  beamM: number;
}

export function clampDraftFrac(draftFrac: number): number {
  if (!Number.isFinite(draftFrac)) return DRAFT_FRAC_DEFAULT;
  return Math.min(DRAFT_FRAC_MAX, Math.max(DRAFT_FRAC_MIN, draftFrac));
}

/** The default draft for a body: tall and thin (height ≥ 2.5 × its footprint) rides at 0.25. */
export function draftFracFor(dims: BuoyancyDims): number {
  const foot = Math.max(dims.lengthM, dims.beamM, 1e-3);
  return dims.heightM >= 2.5 * foot ? DRAFT_FRAC_TALL : DRAFT_FRAC_DEFAULT;
}

/** The smoothed root pose. Mutated in place by `buoyancyStep`. */
export interface BuoyancyState {
  /** Root y (world). */
  y: number;
  /** Bow-up pitch (rad; apply as `rotation.x = −pitch` in a YXZ Euler). */
  pitch: number;
  /** +X-side-up roll (rad; apply as `rotation.z = roll`). */
  roll: number;
  /** The previous frame's targets (the first-order hold). */
  uy: number;
  upitch: number;
  uroll: number;
  /** False until the first step snaps to the target. */
  primed: boolean;
}

export function createBuoyancyState(): BuoyancyState {
  return { y: 0, pitch: 0, roll: 0, uy: 0, upitch: 0, uroll: 0, primed: false };
}

/** The target of one frame (module scratch; `buoyancyStep` is synchronous). */
const target = { y: 0, pitch: 0, roll: 0 };
const probe: WaterSampleOut = createWaterSampleOut();

function clampTilt(a: number): number {
  return Math.max(-BUOY_TILT_MAX_RAD, Math.min(BUOY_TILT_MAX_RAD, a));
}

/**
 * The un-smoothed target at (x, z, yaw) and water time `t`: the root height
 * `hC − draftFrac·height + lift` and the clamped tilt. `spec` null (the body
 * is not mounted yet): rest at `fallbackSurfaceY` with a 1 cm bob, level.
 */
export function buoyancyTarget(
  spec: WaterBodySpec | null,
  x: number,
  z: number,
  yaw: number,
  t: number,
  dims: BuoyancyDims,
  draftFrac: number,
  lift: number,
  fallbackSurfaceY: number,
  out: { y: number; pitch: number; roll: number },
): { y: number; pitch: number; roll: number } {
  const draft = clampDraftFrac(draftFrac) * Math.max(dims.heightM, 0);
  if (spec === null) {
    out.y = fallbackSurfaceY + FALLBACK_BOB_M * Math.sin((2 * Math.PI * t) / 2.8) - draft + lift;
    out.pitch = 0;
    out.roll = 0;
    return out;
  }
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // Local +X in world (three's rotation about +Y): (cos yaw, 0, −sin yaw).
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const centre = sampleInto(spec, x, z, t, probe).height;
  if (dims.lengthM < SMALL_BODY_M) {
    // Small body: the centre normal (`probe` still holds the centre sample) projected on the heading frame.
    const ny = Math.max(probe.ny, 1e-6);
    out.pitch = clampTilt(Math.atan(-(probe.nx * fx + probe.nz * fz) / ny));
    out.roll = clampTilt(Math.atan(-(probe.nx * rx + probe.nz * rz) / ny));
    out.y = centre - draft + lift;
    return out;
  }
  const hl = dims.lengthM / 2;
  const hb = Math.max(dims.beamM, 1e-3) / 2;
  const bow = sampleInto(spec, x + fx * hl, z + fz * hl, t, probe).height;
  const stern = sampleInto(spec, x - fx * hl, z - fz * hl, t, probe).height;
  const px = sampleInto(spec, x + rx * hb, z + rz * hb, t, probe).height;
  const nx = sampleInto(spec, x - rx * hb, z - rz * hb, t, probe).height;
  const hC = (bow + stern + px + nx + centre) / 5;
  out.y = hC - draft + lift;
  out.pitch = clampTilt(Math.atan2(bow - stern, dims.lengthM));
  out.roll = clampTilt(Math.atan2(px - nx, 2 * hb));
  return out;
}

/**
 * One exact first-order-lag step under a target moving linearly from `u0`
 * to `u1` over `dt`: y' = (u − y)/τ. Frame-rate independent to second order.
 */
export function lagStep(y0: number, u0: number, u1: number, dt: number, tau: number): number {
  if (!(dt > 0)) return y0;
  const a = Math.exp(-dt / tau);
  return u1 + (y0 - u0) * a - (u1 - u0) * (tau / dt) * (1 - a);
}

/**
 * Advance the buoyed pose by `dt` (clamped to [0, MAX_STEP_S]) toward the
 * target at the CURRENT (x, z, yaw, t). The first step snaps. `lift` is the
 * play offset (breach / dive) and is followed with the heave lag too.
 */
export function buoyancyStep(
  state: BuoyancyState,
  spec: WaterBodySpec | null,
  x: number,
  z: number,
  yaw: number,
  t: number,
  dims: BuoyancyDims,
  draftFrac: number,
  lift: number,
  dtSeconds: number,
  fallbackSurfaceY: number,
): BuoyancyState {
  const dt = Math.min(Math.max(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0), MAX_STEP_S);
  buoyancyTarget(spec, x, z, yaw, t, dims, draftFrac, lift, fallbackSurfaceY, target);
  if (!state.primed) {
    state.y = target.y;
    state.pitch = target.pitch;
    state.roll = target.roll;
    state.primed = true;
  } else if (dt > 0) {
    state.y = lagStep(state.y, state.uy, target.y, dt, BUOY_TAU_Y_S);
    state.pitch = clampTilt(lagStep(state.pitch, state.upitch, target.pitch, dt, BUOY_TAU_TILT_S));
    state.roll = clampTilt(lagStep(state.roll, state.uroll, target.roll, dt, BUOY_TAU_TILT_S));
  }
  state.uy = target.y;
  state.upitch = target.pitch;
  state.uroll = target.roll;
  return state;
}

/* ------------------------------------------------------------------------ */
/* Drift discs and the breach clamp                                         */
/* ------------------------------------------------------------------------ */

/** A floater's drift region (the `FloatingSpec` anchor + radius). */
export interface DriftDisc {
  x: number;
  z: number;
  r: number;
}

/** Keep-out clearance kept above a breaching body (m). */
export const BREACH_HEADROOM_MARGIN_M = 0.3;
/** Extra depth a dive goes past full submersion (m). */
export const DIVE_EXTRA_M = 0.1;
/** Default play lift / dive depth (figure-behavior defaults). */
export const BREACH_LIFT_DEFAULT_M = 0.6;
/** A lift under this is not a breach: the kind is dropped from the play set. */
export const BREACH_LIFT_MIN_M = 0.05;

/**
 * The breach / spin lift ceiling (plan SEAT D step 3): the top of the lifted
 * body stays `BREACH_HEADROOM_MARGIN_M` under the keep-out headroom,
 * `lift ≤ headroomBelowY − (surfaceY + (1 − draftFrac)·height) − 0.3`.
 * `headroomBelowY` is the minimum over the drift disc (pinned data).
 */
export function maxBreachLift(headroomBelowY: number, surfaceY: number, heightM: number, draftFrac: number): number {
  return headroomBelowY - (surfaceY + (1 - clampDraftFrac(draftFrac)) * heightM) - BREACH_HEADROOM_MARGIN_M;
}

/** The dive depth that fully submerges the body: `(1 − draftFrac)·height + 0.1`. */
export function fullDiveDepth(heightM: number, draftFrac: number): number {
  return (1 - clampDraftFrac(draftFrac)) * heightM + DIVE_EXTRA_M;
}

/** Sample points over a disc: the centre, then `rings` rings of `spokes` points (tests, authoring). */
export function discSamples(disc: DriftDisc, rings = 3, spokes = 16): [number, number][] {
  const out: [number, number][] = [[disc.x, disc.z]];
  for (let ring = 1; ring <= rings; ring += 1) {
    const r = (disc.r * ring) / rings;
    for (let k = 0; k < spokes; k += 1) {
      const a = (k / spokes) * Math.PI * 2;
      out.push([disc.x + Math.cos(a) * r, disc.z + Math.sin(a) * r]);
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* The wader                                                                */
/* ------------------------------------------------------------------------ */

/** The wader counts as in the water (a waterline crossing, R12) within this of its edge point (m). */
export const WADER_WET_M = 0.35;

export function waderWet(x: number, z: number, edgeX: number, edgeZ: number): boolean {
  return Math.hypot(x - edgeX, z - edgeZ) <= WADER_WET_M;
}

/* ------------------------------------------------------------------------ */
/* The surfacer                                                             */
/* ------------------------------------------------------------------------ */

export const SURFACER_RISE_S = 1.4;
export const SURFACER_SINK_S = 1.6;
export const SURFACER_HOLD_S: readonly [number, number] = [4, 6];
export const SURFACER_WAIT_S: readonly [number, number] = [40, 70];
/** The sink splash lands at this share of the sink. */
export const SURFACER_SINK_SPLASH_AT = 0.6;
/** The idle2 accent starts at this share of the hold. */
export const SURFACER_ACCENT_AT = 0.35;
/** Rest: the top this far under the rest surface (hidden by the opaque water). */
export const SURFACER_REST_BELOW_M = 0.08;
/** Visible only while the top is above `surfaceY − this`. */
export const SURFACER_VISIBLE_BELOW_M = 0.05;
/** The rise is at most this share of the figure's height. */
export const SURFACER_RISE_FRAC = 0.75;
/** A spot whose rise is shorter than this is rejected (the test moves the spot; never a silent shrink). */
export const SURFACER_MIN_RISE_M = 0.6;

/**
 * A surfacer spot (per-world authoring data). `headroomTopY` is pinned from
 * `keepOut.headroomAt(...).below − 0.3` at the spot (re-derived in the
 * probe's keep-out test).
 */
export interface SurfacerSpot {
  x: number;
  z: number;
  /** Facing yaw (rad) while surfaced. */
  yaw: number;
  surfaceY: number;
  headroomTopY: number;
}

export interface SurfacerHeights {
  surfaceY: number;
  restTopY: number;
  riseTopY: number;
}

/** The pinned rest / rise heights of a spot for a cast figure's height (allocates; load-time use). */
export function surfacerHeights(spot: SurfacerSpot, heightM: number): SurfacerHeights {
  return surfacerHeightsInto(spot, heightM, { surfaceY: 0, restTopY: 0, riseTopY: 0 });
}

/** `surfacerHeights` into a reused record (the per-frame path: no allocation). */
export function surfacerHeightsInto(spot: SurfacerSpot, heightM: number, out: SurfacerHeights): SurfacerHeights {
  out.surfaceY = spot.surfaceY;
  out.restTopY = spot.surfaceY - SURFACER_REST_BELOW_M;
  out.riseTopY = Math.min(spot.surfaceY + SURFACER_RISE_FRAC * Math.max(heightM, 0), spot.headroomTopY);
  return out;
}

export type SurfacerMode = 'submerged' | 'pending' | 'rise' | 'hold' | 'sink';

/** JSON-safe surfacer state (numbers, strings, booleans only). */
export interface SurfacerState {
  mode: SurfacerMode;
  seed: number;
  /** Seconds in the current mode (the wait accumulates only while active). */
  t: number;
  /** This wait's length (s). */
  waitS: number;
  /** This hold's length (s). */
  holdS: number;
  /** Beats begun (the draw counter). */
  n: number;
  /** The top at the sink start (a cut-short rise sinks from where it is). */
  sinkFromY: number;
  /** The last written top (world y). */
  topY: number;
  breakDone: boolean;
  accentState: 0 | 1 | 2;
  sinkSplashDone: boolean;
  /** The pending request came from a `beatForce` second. */
  forced: boolean;
  /**
   * A `beatForce` second fired and its beat has not begun yet: latched here
   * (like the flyer's `forcePending`) so a force landing while inactive or
   * mid-beat is honoured at the next active `submerged` step, never lost.
   */
  forceLatched: boolean;
}

export interface SurfacerInput {
  /** May begin / continue a beat: awake, live, `figureLife` full, full motion (else it sinks or stays down). */
  active: boolean;
  /** The bus granted the pending ticket. */
  granted: boolean;
  /** A `beatForce=surfacing@` second fired this frame (`bus.consumeForce`). */
  forced: boolean;
  /** Loop length of the figure's idle2 (s); 0 = none (no accent). */
  idle2S: number;
}

/** What one step asks the glue to do (reused; every flag is per-step). */
export interface SurfacerOut {
  topY: number;
  wantsVisible: boolean;
  /** Request the `surfacing` beat now (entered `pending`). */
  request: boolean;
  /** Release the ticket now (sink start, or a withdrawn request). */
  release: boolean;
  /** The top broke the surface: a `splash` contact at the spot. */
  splashBreak: boolean;
  /** The sink passed 0.6: a `splash` contact. */
  splashSink: boolean;
  /** The hold began: a soft `step` contact. */
  stepHold: boolean;
  /** Flip the clip this step (null: keep). */
  clip: 'idle' | 'idle2' | null;
}

export function createSurfacerOut(): SurfacerOut {
  return { topY: 0, wantsVisible: false, request: false, release: false, splashBreak: false, splashSink: false, stepHold: false, clip: null };
}

function draw(seed: number, n: number, salt: number, lo: number, hi: number): number {
  return lo + (hi - lo) * hash01(mix32(seed, n), salt);
}

export function initSurfacerState(seed: number, heights: SurfacerHeights): SurfacerState {
  const s = seed >>> 0;
  return {
    mode: 'submerged',
    seed: s,
    t: 0,
    waitS: draw(s, 0, 0x5a17, SURFACER_WAIT_S[0], SURFACER_WAIT_S[1]),
    holdS: draw(s, 0, 0x401d, SURFACER_HOLD_S[0], SURFACER_HOLD_S[1]),
    n: 0,
    sinkFromY: heights.restTopY,
    topY: heights.restTopY,
    breakDone: false,
    accentState: 0,
    sinkSplashDone: false,
    forced: false,
    forceLatched: false,
  };
}

/** C¹/C² smootherstep on [0, 1]. */
export function smootherstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function toSubmerged(s: SurfacerState, heights: SurfacerHeights): void {
  s.mode = 'submerged';
  s.t = 0;
  s.n += 1;
  s.waitS = draw(s.seed, s.n, 0x5a17, SURFACER_WAIT_S[0], SURFACER_WAIT_S[1]);
  s.holdS = draw(s.seed, s.n, 0x401d, SURFACER_HOLD_S[0], SURFACER_HOLD_S[1]);
  s.topY = heights.restTopY;
  s.forced = false;
}

/** Enter the sink, carrying `carry` seconds already spent in it (frame-rate independence). */
function toSink(s: SurfacerState, out: SurfacerOut, carry = 0): void {
  s.mode = 'sink';
  s.t = carry;
  s.sinkFromY = s.topY;
  s.sinkSplashDone = false;
  out.release = true;
}

/**
 * One surfacer step (in place). `dt` is the clamped frame delta the glue
 * passes: the ACTOR's awake delta, except that a running sink keeps
 * finishing on the frame delta while dormant (plan: the sink finishes, then
 * it stops).
 */
export function stepSurfacer(
  s: SurfacerState,
  heights: SurfacerHeights,
  dtSeconds: number,
  input: SurfacerInput,
  out: SurfacerOut,
): SurfacerOut {
  const dt = Math.min(Math.max(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0), MAX_STEP_S);
  out.request = false;
  out.release = false;
  out.splashBreak = false;
  out.splashSink = false;
  out.stepHold = false;
  out.clip = null;
  if (input.forced) s.forceLatched = true;

  switch (s.mode) {
    case 'submerged':
      if (s.forceLatched && input.active) {
        s.mode = 'pending';
        s.forced = true;
        s.forceLatched = false;
        out.request = true;
      } else if (input.active) {
        s.t += dt;
        if (s.t >= s.waitS) {
          s.mode = 'pending';
          s.forced = false;
          out.request = true;
        }
      }
      break;
    case 'pending':
      if (!input.active) {
        // Withdraw: no backlog, a fresh seeded wait; a forced request waits for the next active step.
        out.release = true;
        const wasForced = s.forced;
        toSubmerged(s, heights);
        if (wasForced) s.forceLatched = true;
      } else if (input.granted) {
        s.mode = 'rise';
        s.t = 0;
        s.breakDone = false;
        s.accentState = 0;
        out.clip = 'idle';
      }
      break;
    case 'rise': {
      if (!input.active) {
        toSink(s, out);
        break;
      }
      s.t += dt;
      const k = smootherstep(s.t / SURFACER_RISE_S);
      s.topY = heights.restTopY + (heights.riseTopY - heights.restTopY) * k;
      if (!s.breakDone && s.topY >= heights.surfaceY) {
        s.breakDone = true;
        out.splashBreak = true;
      }
      if (s.t >= SURFACER_RISE_S) {
        // The overshoot carries into the hold: the timeline does not depend on the frame rate.
        s.mode = 'hold';
        s.t -= SURFACER_RISE_S;
        s.topY = heights.riseTopY;
        out.stepHold = true;
      }
      break;
    }
    case 'hold':
      if (!input.active) {
        toSink(s, out);
        break;
      }
      s.t += dt;
      if (input.idle2S > 0 && s.accentState === 0 && s.t >= SURFACER_ACCENT_AT * s.holdS) {
        s.accentState = 1;
        out.clip = 'idle2';
      } else if (s.accentState === 1 && s.t >= SURFACER_ACCENT_AT * s.holdS + input.idle2S) {
        s.accentState = 2;
        out.clip = 'idle';
      }
      if (s.t >= s.holdS) {
        const carry = s.t - s.holdS;
        s.topY = heights.riseTopY;
        toSink(s, out, carry);
        const k = smootherstep(s.t / SURFACER_SINK_S);
        s.topY = s.sinkFromY + (heights.restTopY - s.sinkFromY) * k;
      }
      break;
    case 'sink': {
      s.t += dt;
      const k = smootherstep(s.t / SURFACER_SINK_S);
      s.topY = s.sinkFromY + (heights.restTopY - s.sinkFromY) * k;
      if (!s.sinkSplashDone && s.t >= SURFACER_SINK_SPLASH_AT * SURFACER_SINK_S) {
        s.sinkSplashDone = true;
        // Only a body that broke the surface splashes going down.
        if (s.sinkFromY > heights.surfaceY) out.splashSink = true;
      }
      if (s.t >= SURFACER_SINK_S) {
        toSubmerged(s, heights);
        if (s.accentState === 1) out.clip = 'idle';
      }
      break;
    }
  }
  out.topY = s.topY;
  out.wantsVisible = surfacerVisible(s.topY, heights.surfaceY);
  return out;
}

/**
 * The surfacer's `surfacing` request sphere (the bus's NDC precondition
 * projects it): the bounding sphere of the held pose's VISIBLE box — the
 * part above the opaque water, `beamM` wide. The probe keep-out test proves
 * this very sphere ≥ 0.06 NDC from every padded face at the desktop and 768
 * station poses.
 */
export function surfacerBeatSphere(
  spot: SurfacerSpot,
  heights: SurfacerHeights,
  beamM: number,
  out: { x: number; y: number; z: number; r: number },
): { x: number; y: number; z: number; r: number } {
  const h = Math.max(heights.riseTopY - heights.surfaceY, 0);
  out.x = spot.x;
  out.y = heights.surfaceY + h / 2;
  out.z = spot.z;
  out.r = Math.hypot(Math.max(beamM, 0) / 2, h / 2);
  return out;
}

/** The surfacer's latch wish: its top is above `surfaceY − 0.05` (else it is under the opaque water). */
export function surfacerVisible(topY: number, surfaceY: number): boolean {
  return topY > surfaceY - SURFACER_VISIBLE_BELOW_M;
}

/**
 * R31 (the relaxed surfacer): the clip the hold actually plays for a step's
 * wish, given the cast figure's clips. A strict cast has idle and idle2; a
 * `relax-clips` cast may have idle only (idle2 is then never asked for:
 * the glue passes `idle2S = 0`), or no clips at all — a static pose (null:
 * the figure's held freeze frame). An `idle2` wish without idle2 falls back
 * to idle; an `idle` wish without idle is the static pose. No allocation.
 */
export function surfacerHoldClip(want: 'idle' | 'idle2', clips: readonly string[] | undefined): 'idle' | 'idle2' | null {
  if (!clips) return null;
  if (want === 'idle2' && clips.includes('idle2')) return 'idle2';
  return clips.includes('idle') ? 'idle' : null;
}

/** The idle2 accent's length for a cast figure (0: no idle2, so the hold never asks for it; R31). */
export function surfacerIdle2S(clips: readonly string[] | undefined, durations: Readonly<Record<string, number>> | undefined): number {
  if (!clips || !clips.includes('idle2')) return 0;
  const d = durations?.idle2 ?? 0;
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/**
 * R32: the surfacer's own in-frustum answer for the push latch's flip log
 * (`LatchActor.inFrustum`, K8). While its top is at or under the waterline
 * it is under the opaque water — not visible, whatever the frustum says —
 * so a flip there is never an in-frustum appearance; above it, the generic
 * test decides. `generic` is called only above the water (no allocation).
 */
export function surfacerInFrustum<R>(topY: number, surfaceY: number, root: R, generic: (root: R) => boolean): boolean {
  if (!(topY > surfaceY)) return false;
  return generic(root);
}

/* ------------------------------------------------------------------------ */
/* Off-screen cost (R49 K9)                                                 */
/* ------------------------------------------------------------------------ */

/** The view sphere's padding (the figure director's R14 gate convention: radius × 1.5 + 0.5 m). */
export const RESIDENT_VIEW_PAD_SCALE = 1.5;
export const RESIDENT_VIEW_PAD_M = 0.5;
/** The longest shadow sweep a caster's view sphere is padded by (the director's `SHADOW_SWEEP_MAX_M`). */
export const RESIDENT_SHADOW_SWEEP_MAX_M = 40;
/**
 * A shadow-casting resident's sweep when the key light is unknown (none
 * found yet): its shadow may land this many body heights away (a key ≥ 14°
 * above the horizon), so it is never hidden while its shadow could show.
 */
export const RESIDENT_SHADOW_REACH_HEIGHTS = 4;

/**
 * R49 K9 ("actors that are not on screen cost nothing per frame"): the
 * sphere a floater or the wader must keep in the frame's frustum to stay
 * shown, written into `out`. The figure director's R14 gate math: the body
 * sphere (half a body height above the root) padded to radius × 1.5 + 0.5 m;
 * for a shadow caster, swept down the key light (`shadowDir`, unit, light →
 * target) by its shadow's reach (top height over the key's descent, at most
 * 40 m), the sphere enclosing the swept capsule; with no known key, padded
 * by `RESIDENT_SHADOW_REACH_HEIGHTS` body heights instead. Outside it (the
 * camera still: the director hands an "everywhere" frustum while it moves
 * or a focus is open) the push latch hides the root — no draw, no shadow
 * draw, no skinning, no mixer — and shows it again before the padded sphere
 * reaches the view, so a flip is never an in-frustum appearance (K8). Pure,
 * no allocation.
 */
export function residentViewSphere(
  x: number,
  rootY: number,
  z: number,
  dims: BuoyancyDims,
  castsShadow: boolean,
  shadowDir: { x: number; y: number; z: number } | null,
  out: { x: number; y: number; z: number; r: number },
): { x: number; y: number; z: number; r: number } {
  const h = Math.max(dims.heightM, 0);
  const body = 0.5 * Math.hypot(Math.max(dims.beamM, 0), h, Math.max(dims.lengthM, 0));
  out.x = x;
  out.y = rootY + h / 2;
  out.z = z;
  out.r = body * RESIDENT_VIEW_PAD_SCALE + RESIDENT_VIEW_PAD_M;
  if (!castsShadow) return out;
  if (shadowDir === null) {
    out.r += h * RESIDENT_SHADOW_REACH_HEIGHTS;
    return out;
  }
  // The top of the padded sphere above the feet, cast down the key (the director's sweep).
  const top = Math.max(out.y - rootY, 0) + out.r;
  let reach = RESIDENT_SHADOW_SWEEP_MAX_M;
  if (shadowDir.y < -1e-3 && top < RESIDENT_SHADOW_SWEEP_MAX_M * -shadowDir.y) reach = top / -shadowDir.y;
  const half = reach / 2;
  out.x += shadowDir.x * half;
  out.y += shadowDir.y * half;
  out.z += shadowDir.z * half;
  out.r += half;
  return out;
}

/** The progress change under which the camera counts as still (the director's R14 `moved` epsilon). */
export const RESIDENT_STILL_EPS = 1e-6;

/**
 * R49 fix D-R2: the off-screen resident's wish as the push latch reads it.
 * The latch runs BEFORE the director's step, so the step's wish
 * (`stepWants`, its padded view sphere against the step's frustum) is one
 * frame old when the latch applies it; on the first frame of a camera move
 * (a scroll start, a station jump, a focus open) the camera rig moves the
 * camera AFTER the latch, and a root hidden by the last still frame would
 * render hidden at the new pose. So the latch also shows it as soon as the
 * camera is about to move in this frame: the conductor's damped progress
 * (`smoothNow`, advanced before the director's frame) differs from the one
 * the last step saw (`smoothAtStep`, NaN before any step), there is no
 * progress (`null`, the director's "moved" too), or a focus is open — the
 * same signals the director turns into its "everywhere" frustum one step
 * later. Pure, no allocation.
 */
export function residentLatchWants(stepWants: boolean, smoothNow: number | null, smoothAtStep: number, focusOpen: boolean): boolean {
  if (stepWants || focusOpen || smoothNow === null) return true;
  return !(Math.abs(smoothNow - smoothAtStep) < RESIDENT_STILL_EPS);
}

/** `residentFlipInFrustum`'s reused record. */
export interface ResidentFlipOut {
  inFrustum: boolean;
  /** The surfacer only: its top at or under the waterline; undefined for a floater or the wader. */
  underWater: boolean | undefined;
}

export function createResidentFlipOut(): ResidentFlipOut {
  return { inFrustum: false, underWater: undefined };
}

/**
 * The water resident's `LatchActor.inFrustum` answer at a visibility flip
 * (K8), written into `out`: the surfacer (`surfacerTopY` non-null) answers
 * R32's `surfacerInFrustum` (false at or under the waterline); a floater or
 * the wader answers the director's generic root-box test. The root's world
 * matrix is the scene's last update of its CURRENT transform (fix D-R1: the
 * actors never freeze it), so the answer is at where the root is now.
 */
export function residentFlipInFrustum<R>(
  surfacerTopY: number | null,
  surfaceY: number,
  root: R,
  generic: (root: R) => boolean,
  out: ResidentFlipOut,
): ResidentFlipOut {
  if (surfacerTopY === null) {
    out.underWater = undefined;
    out.inFrustum = generic(root);
    return out;
  }
  out.underWater = !(surfacerTopY > surfaceY);
  out.inFrustum = surfacerInFrustum(surfacerTopY, surfaceY, root, generic);
  return out;
}

/** Set the surfacer to canonical time `t` for the phase pin: submerged, `t` into its first wait. */
export function pinSurfacer(s: SurfacerState, heights: SurfacerHeights, t: number): void {
  s.mode = 'submerged';
  s.n = 0;
  s.waitS = draw(s.seed, 0, 0x5a17, SURFACER_WAIT_S[0], SURFACER_WAIT_S[1]);
  s.holdS = draw(s.seed, 0, 0x401d, SURFACER_HOLD_S[0], SURFACER_HOLD_S[1]);
  s.t = Math.min(Math.max(0, t), s.waitS);
  s.topY = heights.restTopY;
  s.sinkFromY = heights.restTopY;
  s.breakDone = false;
  s.accentState = 0;
  s.sinkSplashDone = false;
  s.forced = false;
  s.forceLatched = false;
}
