import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, Frustum, Group, Matrix4, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene, Sphere } from 'three';
import { createAmbientBeatBus, type BeatGrantContext, type BeatTicket } from '../ambient-beats';
import type { WaterBodySpec } from '../water';
import {
  BUOY_TILT_MAX_RAD,
  buoyancyStep,
  clampDraftFrac,
  createBuoyancyState,
  createResidentFlipOut,
  createSurfacerOut,
  draftFracFor,
  fullDiveDepth,
  initSurfacerState,
  lagStep,
  maxBreachLift,
  pinSurfacer,
  RESIDENT_SHADOW_REACH_HEIGHTS,
  RESIDENT_VIEW_PAD_M,
  RESIDENT_VIEW_PAD_SCALE,
  RESIDENT_SHADOW_SWEEP_MAX_M,
  RESIDENT_STILL_EPS,
  residentFlipInFrustum,
  residentLatchWants,
  residentViewSphere,
  stepSurfacer,
  SURFACER_HOLD_S,
  SURFACER_MIN_RISE_M,
  SURFACER_RISE_S,
  SURFACER_SINK_S,
  SURFACER_WAIT_S,
  surfacerHeights,
  surfacerHeightsInto,
  surfacerHoldClip,
  surfacerIdle2S,
  surfacerInFrustum,
  surfacerVisible,
  waderWet,
  type BuoyancyDims,
  type SurfacerSpot,
  type SurfacerState,
} from '../water-resident';
import { applyLatchVisibility, registerLatchActor, resetResidencyForTests } from '@/components/world/route/residency-store';
import { noteRevealArmed, resetSceneProgressForTests } from '@/components/world/route/scene-progress';
import { beginSceneGeneration, resetSceneReadiness } from '@/components/world/route/world-readiness';

/**
 * POKEMON-CORE SEAT D step 3 (C9, C10, D40): the water residents' pure half.
 * The frame-rate law: every clock is the clamped delta of rendered frames,
 * so 30 and 60 fps (and a 0.1 s clamp spike) end in the same pose.
 */

const SPEC: WaterBodySpec = {
  id: 'test-lake',
  center: [0, -8.5],
  radii: [10, 4.8],
  surfaceY: 0.06,
  floorY: 0.012,
  depthM: 1.3,
  shoreBandM: 0.8,
  waves: [
    { dirRad: 0.35, wavelengthM: 7.5, amplitudeM: 0.03, speed: 1.0, steepness: 0.3 },
    { dirRad: 2.2, wavelengthM: 3.6, amplitudeM: 0.02, speed: 0.75, steepness: 0.2 },
    { dirRad: -0.7, wavelengthM: 1.6, amplitudeM: 0.009, speed: 0.55, steepness: 0.1 },
  ],
  capillary: { scaleM: 0.5, strength: 0.07 },
  colors: {
    deep: '#2c6f79',
    shallow: '#79b8b5',
    absorb: '#3f8f8a',
    foam: '#e6eef0',
    shore: '#c9b28d',
    skyZenith: '#8ec8e8',
    skyHorizon: '#f6dfda',
  },
  ambient: { periodS: 5.5, streams: 2, strength: 0.75, seed: 7 },
};

const DIMS: BuoyancyDims = { heightM: 1.1, lengthM: 1.2, beamM: 0.7 };
const DEG = Math.PI / 180;

/** Frame deltas for `seconds` at `fps`, with a 0.1 s spike (a hitch the clamp passes whole) at each `spikeAt`. */
function frames(fps: number, seconds: number, spikeAt: number | readonly number[]): number[] {
  const spikes = typeof spikeAt === 'number' ? [spikeAt] : [...spikeAt];
  const out: number[] = [];
  let t = 0;
  let next = 0;
  while (t < seconds - 1e-9) {
    let dt = 1 / fps;
    if (next < spikes.length && t >= spikes[next]) {
      dt = 0.1;
      next += 1;
    }
    dt = Math.min(dt, seconds - t);
    out.push(dt);
    t += dt;
  }
  return out;
}

/** A floater drifting along a fixed path (x, z, yaw as functions of time): only the buoyancy is under test. */
function runBuoyancy(fps: number, dims: BuoyancyDims = DIMS) {
  const state = createBuoyancyState();
  let t = 0;
  const path = (time: number) => ({ x: -3 + 0.08 * time, z: -8 + 0.03 * Math.sin(time), yaw: 0.4 + 0.05 * time });
  const p0 = path(0);
  buoyancyStep(state, SPEC, p0.x, p0.z, p0.yaw, 0, dims, 0.35, 0, 0, SPEC.surfaceY);
  for (const dt of frames(fps, 10, 5)) {
    t += dt;
    const p = path(t);
    buoyancyStep(state, SPEC, p.x, p.z, p.yaw, t, dims, 0.35, 0, dt, SPEC.surfaceY);
  }
  return state;
}

describe('buoyancy (C10)', () => {
  it('30 vs 60 fps agree within 1 mm / 0.2° after 10 s, a 0.1 s spike included', () => {
    const a = runBuoyancy(30);
    const b = runBuoyancy(60);
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.001);
    expect(Math.abs(a.pitch - b.pitch)).toBeLessThan(0.2 * DEG);
    expect(Math.abs(a.roll - b.roll)).toBeLessThan(0.2 * DEG);
  });

  it('the small-body path (L < 0.5 m, the centre normal) agrees across frame rates too', () => {
    const small: BuoyancyDims = { heightM: 0.4, lengthM: 0.35, beamM: 0.3 };
    const a = runBuoyancy(30, small);
    const b = runBuoyancy(60, small);
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.001);
    expect(Math.abs(a.pitch - b.pitch)).toBeLessThan(0.2 * DEG);
  });

  it('rides the field: the root sits draftFrac·height under the mean surface, tilt within ±8°', () => {
    const state = createBuoyancyState();
    for (let i = 0; i <= 600; i += 1) {
      buoyancyStep(state, SPEC, -2, -8.5, 0.3, i / 60, DIMS, 0.35, 0, 1 / 60, SPEC.surfaceY);
      expect(Math.abs(state.pitch)).toBeLessThanOrEqual(BUOY_TILT_MAX_RAD);
      expect(Math.abs(state.roll)).toBeLessThanOrEqual(BUOY_TILT_MAX_RAD);
      // Σ amplitude 5.9 cm; the waterline stays within it of the rest surface.
      expect(Math.abs(state.y + 0.35 * DIMS.heightM - SPEC.surfaceY)).toBeLessThan(0.07);
    }
  });

  it('clamps tilt at ±8° on a steep field', () => {
    const steep: WaterBodySpec = {
      ...SPEC,
      waves: [
        { dirRad: 0, wavelengthM: 1.2, amplitudeM: 0.2, speed: 1, steepness: 0 },
        { dirRad: 1.57, wavelengthM: 1.2, amplitudeM: 0.2, speed: 1, steepness: 0 },
        { dirRad: 0.5, wavelengthM: 3, amplitudeM: 0.0, speed: 1, steepness: 0 },
      ],
      floorY: -2,
    };
    const state = createBuoyancyState();
    let maxTilt = 0;
    for (let i = 0; i < 300; i += 1) {
      buoyancyStep(state, steep, -2, -8.5, 0, i / 60, { heightM: 1, lengthM: 0.6, beamM: 0.6 }, 0.35, 0, 1 / 60, SPEC.surfaceY);
      maxTilt = Math.max(maxTilt, Math.abs(state.pitch), Math.abs(state.roll));
    }
    expect(maxTilt).toBeGreaterThan(7 * DEG);
    expect(maxTilt).toBeLessThanOrEqual(BUOY_TILT_MAX_RAD + 1e-12);
  });

  it('without a water handle it rests at the rest surface with a 1 cm bob (the synthetic bob is buoyancyStep’s alone)', () => {
    const state = createBuoyancyState();
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 600; i += 1) {
      buoyancyStep(state, null, 0, 0, 0, i / 60, DIMS, 0.35, 0, 1 / 60, 0.06);
      lo = Math.min(lo, state.y);
      hi = Math.max(hi, state.y);
    }
    expect(hi - lo).toBeLessThanOrEqual(0.02 + 1e-9);
    expect((hi + lo) / 2).toBeCloseTo(0.06 - 0.35 * DIMS.heightM, 2);
  });

  it('the lag is exact under a linear target (frame-rate independent) and holds on dt 0', () => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 30; i += 1) a = lagStep(a, i / 30, (i + 1) / 30, 1 / 30, 0.25);
    for (let i = 0; i < 60; i += 1) b = lagStep(b, i / 60, (i + 1) / 60, 1 / 60, 0.25);
    expect(Math.abs(a - b)).toBeLessThan(1e-12);
    expect(lagStep(0.3, 0, 1, 0, 0.25)).toBe(0.3);
  });

  it('draft: 0.35 by default, 0.25 for tall thin bodies, clamped to [0.15, 0.6]', () => {
    expect(draftFracFor(DIMS)).toBe(0.35);
    expect(draftFracFor({ heightM: 2.5, lengthM: 0.6, beamM: 0.5 })).toBe(0.25);
    expect(clampDraftFrac(0.9)).toBe(0.6);
    expect(clampDraftFrac(0.01)).toBe(0.15);
  });
});

describe('breach clamp and dive depth', () => {
  it('lift ≤ headroomBelow − (surfaceY + (1 − draftFrac)·height) − 0.3', () => {
    expect(maxBreachLift(3, 0.06, 1.2, 0.35)).toBeCloseTo(3 - (0.06 + 0.65 * 1.2) - 0.3, 12);
    // A low ceiling leaves no breach.
    expect(maxBreachLift(1, 0.06, 1.2, 0.35)).toBeLessThan(0);
  });

  it('a dive goes fully under: (1 − draftFrac)·height + 0.1', () => {
    expect(fullDiveDepth(1.2, 0.35)).toBeCloseTo(0.65 * 1.2 + 0.1, 12);
  });
});

describe('the wader waterline (R12)', () => {
  it('counts as in the water within 0.35 m of its edge point', () => {
    expect(waderWet(1, 1, 1.2, 1.2)).toBe(true);
    expect(waderWet(0, 0, 1, 1)).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */
/* The surfacer                                                             */
/* ------------------------------------------------------------------------ */

const SPOT: SurfacerSpot = { x: -8, z: -8, yaw: 0.7, surfaceY: 0.06, headroomTopY: 3.2 };
const HEIGHT = 2.0;
const HEIGHTS = surfacerHeights(SPOT, HEIGHT);

const grantCtx = (dt: number): BeatGrantContext => ({
  dt,
  hidden: false,
  loader: false,
  focusOpen: false,
  focusSubjectId: null,
  live: true,
  settled: true,
  sinceSettleS: 100,
  station: 0,
  staticMotion: false,
  faceDistanceNdc: () => null,
});

interface SurfacerRun {
  topAt: (t: number) => number;
  /** Every frame's (t, top). */
  samples: readonly (readonly [number, number])[];
  state: SurfacerState;
  splashes: number;
  requestsAt: number[];
  riseAt: number[];
}

/**
 * Drive a surfacer against the real bus for `seconds` at `fps`, forcing the
 * surfacing at `forceAt` (the `beatForce` second on the settle clock).
 */
function runSurfacer(fps: number, seconds: number, forceAt: number, spikeAt: number | readonly number[] = 5): SurfacerRun {
  const bus = createAmbientBeatBus({ force: { surfacing: forceAt, flyover: null, play: null } });
  const state = initSurfacerState(0x1234, HEIGHTS);
  const out = createSurfacerOut();
  let ticket: BeatTicket | null = null;
  let t = 0;
  let splashes = 0;
  const samples: [number, number][] = [];
  const requestsAt: number[] = [];
  const riseAt: number[] = [];
  for (const dt of frames(fps, seconds, spikeAt)) {
    t += dt;
    const forced = bus.consumeForce('surfacing', t);
    const before = state.mode;
    stepSurfacer(state, HEIGHTS, dt, { active: true, granted: ticket?.state === 'granted', forced, idle2S: 1.5 }, out);
    if (out.request) {
      ticket = bus.request('surfacing', 'surfacer', { x: 0, y: 0, z: 0, r: 1 }, state.forced ? { forced: true } : undefined);
      requestsAt.push(t);
    }
    if (out.release && ticket) {
      bus.release(ticket);
      ticket = null;
    }
    if (before === 'pending' && state.mode === 'rise') riseAt.push(t);
    if (out.splashBreak || out.splashSink) splashes += 1;
    bus.grant(grantCtx(dt));
    samples.push([t, out.topY]);
  }
  const topAt = (time: number) => {
    let best = samples[0];
    for (const s of samples) if (s[0] <= time + 1e-9) best = s;
    return best[1];
  };
  return { topAt, samples, state, splashes, requestsAt, riseAt };
}

describe('surfacer (plan SEAT D step 3)', () => {
  it('heights: rest 8 cm under, rise min(0.75·h, the pinned headroom top), ≥ 0.6 m', () => {
    expect(HEIGHTS.restTopY).toBeCloseTo(SPOT.surfaceY - 0.08, 12);
    expect(HEIGHTS.riseTopY).toBeCloseTo(SPOT.surfaceY + 0.75 * HEIGHT, 12);
    expect(surfacerHeights({ ...SPOT, headroomTopY: 0.9 }, HEIGHT).riseTopY).toBe(0.9);
    expect(HEIGHTS.riseTopY - HEIGHTS.restTopY).toBeGreaterThanOrEqual(SURFACER_MIN_RISE_M);
  });

  it('beatForce places the surfacing: requested at the forced second, granted, risen with a splash at the break', () => {
    const run = runSurfacer(60, 20, 10);
    expect(run.requestsAt[0]).toBeGreaterThanOrEqual(10);
    expect(run.requestsAt[0]).toBeLessThan(10 + 1 / 30);
    expect(run.riseAt[0]).toBeLessThan(10 + 0.1);
    // Rise 1.4 s, hold 4–6 s, sink 1.6 s: back under by forced + 1.4 + 6 + 1.6 + a frame.
    expect(run.topAt(10 + SURFACER_RISE_S + 1)).toBeCloseTo(HEIGHTS.riseTopY, 9);
    expect(run.state.mode).toBe('submerged');
    expect(run.splashes).toBe(2);
  });

  it('30 vs 60 fps: the same top within 1 mm through the hold and at 10 s after the force (a 0.1 s spike included)', () => {
    const a = runSurfacer(30, 25, 10, 12);
    const b = runSurfacer(60, 25, 10, 12);
    for (const t of [12, 14, 15, 20, 24]) expect(Math.abs(a.topAt(t) - b.topAt(t)), `t=${t}`).toBeLessThan(0.001);
  });

  it('30 vs 60 fps mid-RISE and mid-SINK, 0.1 s spikes inside the rise and inside the sink: the same curve from each run\'s own rise start', () => {
    // The grant lands on a frame boundary, so the two runs' rise starts differ by the grant latency
    // (at most two 30 fps frames; several cm mid-rise if compared at the same ABSOLUTE second). That
    // offset is bounded here; the curve itself (and the rise->hold->sink overshoot carry) is compared
    // relative to each run's own rise start, where it must agree to float precision.
    const holdS = initSurfacerState(0x1234, HEIGHTS).holdS;
    const sinkRel = SURFACER_RISE_S + holdS;
    const spikes = [10.5, 10 + sinkRel + 0.5];
    const a = runSurfacer(30, 25, 10, spikes);
    const b = runSurfacer(60, 25, 10, spikes);
    expect(a.riseAt.length).toBe(1);
    expect(b.riseAt.length).toBe(1);
    // The request lands on the first frame at or after the forced second, the grant one frame later.
    expect(Math.abs(a.riseAt[0] - b.riseAt[0])).toBeLessThanOrEqual(2 / 30 + 1e-6);
    /** The top at exactly `u` s after the run's rise start (a frame both grids share; never inside a spike's gap). */
    const topRel = (run: SurfacerRun, u: number) => {
      const t0 = run.riseAt[0];
      const hit = run.samples.find(([t]) => Math.abs(t - t0 - u) < 1e-6);
      expect(hit, `no frame at rise + ${u.toFixed(4)} s`).toBeDefined();
      return (hit as readonly [number, number])[1];
    };
    const onGrid = (u: number) => Math.round(u * 30) / 30;
    // Mid-rise (either side of the rise spike), across the rise->hold carry, mid-hold,
    // then mid-sink (either side of the sink spike) and across the sink's end.
    const rel = [0.2, 0.3, 0.8, 1.0, 1.3, 1.5, 3.0, sinkRel + 0.1, sinkRel + 0.3, sinkRel + 0.9, sinkRel + 1.2, sinkRel + 1.5, sinkRel + 1.8].map(onGrid);
    let moving = 0;
    for (const u of rel) {
      const ta = topRel(a, u);
      const tb = topRel(b, u);
      expect(Math.abs(ta - tb), `rise + ${u.toFixed(4)} s`).toBeLessThan(0.001);
      if (ta > HEIGHTS.restTopY + 0.05 && ta < HEIGHTS.riseTopY - 0.05) moving += 1;
    }
    // The samples really are mid-motion (not only plateaus).
    expect(moving).toBeGreaterThanOrEqual(6);
    // Both spikes really land inside the motion they test.
    for (const run of [a, b]) {
      expect(spikes[0]).toBeGreaterThan(run.riseAt[0]);
      expect(spikes[0]).toBeLessThan(run.riseAt[0] + SURFACER_RISE_S - 0.1);
      const sinkStart = run.riseAt[0] + sinkRel;
      expect(spikes[1]).toBeGreaterThan(sinkStart);
      expect(spikes[1]).toBeLessThan(sinkStart + SURFACER_SINK_S - 0.1);
    }
  });

  it('a beatForce second landing while inactive, or mid-beat, is latched and honoured at the next active submerged step', () => {
    const idle = { granted: false, idle2S: 0 };
    // Inactive (portrait-blocked, not full life, not live): the force is latched, not lost.
    const state = initSurfacerState(21, HEIGHTS);
    const out = createSurfacerOut();
    stepSurfacer(state, HEIGHTS, 0.05, { ...idle, active: false, forced: true }, out);
    expect(state.mode).toBe('submerged');
    expect(state.forceLatched).toBe(true);
    for (let i = 0; i < 20; i += 1) stepSurfacer(state, HEIGHTS, 0.05, { ...idle, active: false, forced: false }, out);
    stepSurfacer(state, HEIGHTS, 0.05, { ...idle, active: true, forced: false }, out);
    expect(out.request).toBe(true);
    expect(state.mode).toBe('pending');
    expect(state.forced).toBe(true);
    expect(state.forceLatched).toBe(false);
    // A forced request withdrawn (inactive while pending) waits for the next active step.
    stepSurfacer(state, HEIGHTS, 0.05, { ...idle, active: false, forced: false }, out);
    expect(out.release).toBe(true);
    expect(state.mode).toBe('submerged');
    stepSurfacer(state, HEIGHTS, 0.05, { ...idle, active: true, forced: false }, out);
    expect(out.request).toBe(true);
    // Mid-beat (in the hold): the force waits for the beat to finish, then requests at once.
    for (let i = 0; i < 40; i += 1) stepSurfacer(state, HEIGHTS, 0.05, { active: true, granted: true, forced: false, idle2S: 0 }, out);
    expect(state.mode).toBe('hold');
    stepSurfacer(state, HEIGHTS, 0.05, { active: true, granted: true, forced: true, idle2S: 0 }, out);
    expect(state.mode).toBe('hold');
    let requested = false;
    for (let i = 0; i < 400 && !requested; i += 1) {
      stepSurfacer(state, HEIGHTS, 0.05, { active: true, granted: false, forced: false, idle2S: 0 }, out);
      requested = out.request;
    }
    expect(requested).toBe(true);
    expect(state.forced).toBe(true);
    // The pin clears a latched force.
    stepSurfacer(state, HEIGHTS, 0.05, { ...idle, active: false, forced: true }, out);
    pinSurfacer(state, HEIGHTS, 0);
    expect(state.forceLatched).toBe(false);
  });

  it('surfacerHeightsInto writes the same heights into the reused record (the per-frame path allocates nothing)', () => {
    const rec = { surfaceY: 0, restTopY: 0, riseTopY: 0 };
    expect(surfacerHeightsInto(SPOT, HEIGHT, rec)).toBe(rec);
    expect(rec).toEqual(HEIGHTS);
    surfacerHeightsInto({ ...SPOT, headroomTopY: 0.9 }, HEIGHT, rec);
    expect(rec).toEqual(surfacerHeights({ ...SPOT, headroomTopY: 0.9 }, HEIGHT));
  });

  it('waits a seeded 40–70 s between beats, and never builds a backlog while inactive', () => {
    const state = initSurfacerState(99, HEIGHTS);
    expect(state.waitS).toBeGreaterThanOrEqual(SURFACER_WAIT_S[0]);
    expect(state.waitS).toBeLessThanOrEqual(SURFACER_WAIT_S[1]);
    expect(state.holdS).toBeGreaterThanOrEqual(SURFACER_HOLD_S[0]);
    expect(state.holdS).toBeLessThanOrEqual(SURFACER_HOLD_S[1]);
    const out = createSurfacerOut();
    // An hour inactive (dormant, downgraded, hidden): the wait does not advance.
    for (let i = 0; i < 36000; i += 1) stepSurfacer(state, HEIGHTS, 0.1, { active: false, granted: false, forced: false, idle2S: 0 }, out);
    expect(state.mode).toBe('submerged');
    expect(state.t).toBe(0);
    // Active: the request lands at the wait, once.
    let requests = 0;
    for (let i = 0; i < 710; i += 1) {
      stepSurfacer(state, HEIGHTS, 0.1, { active: true, granted: false, forced: false, idle2S: 0 }, out);
      if (out.request) requests += 1;
    }
    expect(requests).toBe(1);
    expect(state.mode).toBe('pending');
    // Pending and then inactive: the request is withdrawn (released), a fresh wait begins.
    stepSurfacer(state, HEIGHTS, 0.1, { active: false, granted: false, forced: false, idle2S: 0 }, out);
    expect(out.release).toBe(true);
    expect(state.mode).toBe('submerged');
  });

  it('releases at the sink start, plays idle2 once in the hold, and hides only under the water', () => {
    const state = initSurfacerState(5, HEIGHTS);
    const out = createSurfacerOut();
    const clips: string[] = [];
    let releasedAtMode: string | null = null;
    stepSurfacer(state, HEIGHTS, 0.05, { active: true, granted: false, forced: true, idle2S: 1.2 }, out);
    expect(out.request).toBe(true);
    expect(out.wantsVisible).toBe(false);
    for (let i = 0; i < 400; i += 1) {
      const wasMode = state.mode;
      stepSurfacer(state, HEIGHTS, 0.05, { active: true, granted: true, forced: false, idle2S: 1.2 }, out);
      if (out.clip) clips.push(out.clip);
      if (out.release && releasedAtMode === null) releasedAtMode = `${wasMode}->${state.mode}`;
      expect(out.wantsVisible).toBe(surfacerVisible(out.topY, HEIGHTS.surfaceY));
      if (!out.wantsVisible) expect(out.topY).toBeLessThanOrEqual(HEIGHTS.surfaceY - 0.05);
      if (state.mode === 'submerged' && i > 10) break;
    }
    expect(releasedAtMode).toBe('hold->sink');
    expect(clips).toEqual(['idle', 'idle2', 'idle']);
  });

  it('a dormant (inactive) surfacer mid-beat sinks at once and finishes the sink', () => {
    const state = initSurfacerState(5, HEIGHTS);
    const out = createSurfacerOut();
    stepSurfacer(state, HEIGHTS, 0.05, { active: true, granted: false, forced: true, idle2S: 0 }, out);
    for (let i = 0; i < 40; i += 1) stepSurfacer(state, HEIGHTS, 0.05, { active: true, granted: true, forced: false, idle2S: 0 }, out);
    expect(state.mode).toBe('hold');
    stepSurfacer(state, HEIGHTS, 0.05, { active: false, granted: true, forced: false, idle2S: 0 }, out);
    expect(state.mode).toBe('sink');
    expect(out.release).toBe(true);
    let steps = 0;
    while (state.mode === 'sink' && steps < 100) {
      stepSurfacer(state, HEIGHTS, 0.05, { active: false, granted: false, forced: false, idle2S: 0 }, out);
      steps += 1;
    }
    expect(state.mode).toBe('submerged');
    expect(steps * 0.05).toBeCloseTo(SURFACER_SINK_S, 1);
    expect(out.topY).toBe(HEIGHTS.restTopY);
  });

  it('the pin puts it submerged, t into its first wait, deterministically', () => {
    const a = initSurfacerState(77, HEIGHTS);
    const b = initSurfacerState(77, HEIGHTS);
    const out = createSurfacerOut();
    stepSurfacer(a, HEIGHTS, 0.05, { active: true, granted: false, forced: true, idle2S: 0 }, out);
    pinSurfacer(a, HEIGHTS, 3);
    pinSurfacer(b, HEIGHTS, 3);
    expect(a).toEqual(b);
    expect(a.mode).toBe('submerged');
    expect(a.t).toBe(3);
  });
});

/* ------------------------------------------------------------------------ */
/* R31: the relaxed surfacer's hold                                         */
/* ------------------------------------------------------------------------ */

/** One forced beat, start to back under; every clip the glue would PLAY (after `surfacerHoldClip`). */
function holdClips(clips: readonly string[] | undefined, durations?: Readonly<Record<string, number>>): ('idle' | 'idle2' | null)[] {
  const state = initSurfacerState(0x51, HEIGHTS);
  const out = createSurfacerOut();
  const idle2S = surfacerIdle2S(clips, durations);
  const played: ('idle' | 'idle2' | null)[] = [];
  stepSurfacer(state, HEIGHTS, 1 / 30, { active: true, granted: false, forced: true, idle2S }, out);
  for (let i = 0; i < 30 * 12 && !(i > 0 && state.mode === 'submerged'); i += 1) {
    stepSurfacer(state, HEIGHTS, 1 / 30, { active: true, granted: true, forced: false, idle2S }, out);
    if (out.clip !== null) played.push(surfacerHoldClip(out.clip, clips));
  }
  expect(state.mode).toBe('submerged');
  expect(state.n).toBe(1);
  return played;
}

describe('R31: the relaxed surfacer hold (idle only, or a static pose; idle2 only when it exists)', () => {
  it('a strict cast (idle + idle2): idle, the idle2 accent once, back to idle', () => {
    expect(holdClips(['idle', 'idle2'], { idle: 2, idle2: 1.2 })).toEqual(['idle', 'idle2', 'idle']);
  });

  it('idle only: the hold plays idle and never asks for idle2', () => {
    expect(surfacerIdle2S(['idle'], { idle: 2 })).toBe(0);
    expect(holdClips(['idle'], { idle: 2 })).toEqual(['idle']);
  });

  it('no clips: a static pose (null), the beat still runs rise, hold, sink', () => {
    expect(surfacerIdle2S([], {})).toBe(0);
    expect(surfacerIdle2S(undefined, undefined)).toBe(0);
    expect(holdClips([])).toEqual([null]);
    expect(holdClips(undefined)).toEqual([null]);
  });

  it('idle2 without idle: the accent plays, the rest is the static pose', () => {
    expect(holdClips(['idle2'], { idle2: 1 })).toEqual([null, 'idle2', null]);
  });

  it('an idle2 with no usable length is treated as absent', () => {
    expect(surfacerIdle2S(['idle', 'idle2'], { idle: 2 })).toBe(0);
    expect(surfacerIdle2S(['idle', 'idle2'], { idle2: Number.NaN })).toBe(0);
    expect(surfacerHoldClip('idle2', ['idle'])).toBe('idle');
    expect(surfacerHoldClip('idle', ['idle2'])).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* R32: the surfacer's own in-frustum answer, through A1's push latch        */
/* ------------------------------------------------------------------------ */

describe('R32: the surfacer reports in-frustum only above the waterline (K8)', () => {
  beforeEach(() => {
    resetResidencyForTests();
    resetSceneReadiness();
    resetSceneProgressForTests();
  });
  afterEach(() => {
    resetResidencyForTests();
    resetSceneReadiness();
    resetSceneProgressForTests();
  });

  it('surfacerInFrustum: false at or under the waterline (the generic test is not even asked), the generic test above it', () => {
    let asked = 0;
    const always = () => {
      asked += 1;
      return true;
    };
    expect(surfacerInFrustum(SPOT.surfaceY - 0.04, SPOT.surfaceY, null, always)).toBe(false);
    expect(surfacerInFrustum(SPOT.surfaceY, SPOT.surfaceY, null, always)).toBe(false);
    expect(asked).toBe(0);
    expect(surfacerInFrustum(SPOT.surfaceY + 0.01, SPOT.surfaceY, null, always)).toBe(true);
    expect(surfacerInFrustum(SPOT.surfaceY + 0.01, SPOT.surfaceY, null, () => false)).toBe(false);
    expect(asked).toBe(1);
  });

  it('a whole beat with the lake in view: the latch logs the show and hide flips inFrustum:false (under water), and true above it', () => {
    const gen = beginSceneGeneration('sakura:day')!;
    const state = initSurfacerState(0x77, HEIGHTS);
    const out = createSurfacerOut();
    const root = new Object3D();
    let wants = true;
    // The surfacer's registration, as WaterResident.tsx makes it (the R32 hook).
    const release = registerLatchActor({
      id: 'sakura-prop-resident-core-probe-surfacer-0',
      root: () => root,
      wants: () => wants,
      inFrustum: (r, generic) => surfacerInFrustum(state.topY, HEIGHTS.surfaceY, r, generic),
    });
    const flips: { visible: boolean; inFrustum: boolean; topY: number }[] = [];
    // The lake is in view: the generic root-box test says true on every frame.
    const lakeInView = () => true;
    const frame = (forced: boolean) => {
      // R27 order: the latch first, then the step.
      applyLatchVisibility(lakeInView, (_id, visible, inFrustum) => flips.push({ visible, inFrustum, topY: state.topY }));
      stepSurfacer(state, HEIGHTS, 1 / 60, { active: true, granted: state.mode !== 'submerged', forced, idle2S: 1 }, out);
      wants = out.wantsVisible;
    };
    noteRevealArmed(gen, 1000);
    frame(false);
    frame(false);
    expect(root.visible).toBe(false);
    expect(flips).toEqual([{ visible: false, inFrustum: false, topY: HEIGHTS.restTopY }]);
    frame(true);
    let held = false;
    let injected = false;
    for (let i = 0; i < 60 * 12 && !(held && state.mode === 'submerged'); i += 1) {
      frame(false);
      if (state.mode === 'hold') held = true;
      if (!injected && state.mode === 'hold' && root.visible) {
        // Mid-hold, above the water: a stray hide re-shown by the latch is an honest in-frustum flip.
        injected = true;
        root.visible = false;
        frame(false);
      }
    }
    frame(false);
    frame(false);
    expect(held).toBe(true);
    expect(injected).toBe(true);
    expect(state.mode).toBe('submerged');
    const shown = flips.filter((f) => f.visible);
    const hidden = flips.filter((f) => !f.visible);
    expect(shown).toHaveLength(2);
    // The show flip: the top crossed surfaceY - 0.05, still under the waterline.
    expect(shown[0].inFrustum).toBe(false);
    expect(shown[0].topY).toBeLessThanOrEqual(HEIGHTS.surfaceY);
    // Above the water the flag is the generic test's (true: the lake is in view).
    expect(shown[1].inFrustum).toBe(true);
    expect(shown[1].topY).toBeGreaterThan(HEIGHTS.surfaceY);
    // Every hide flip (the initial one and the sink's) happened under the water and logged false.
    expect(hidden).toHaveLength(2);
    for (const f of hidden) {
      expect(f.inFrustum).toBe(false);
      expect(f.topY).toBeLessThanOrEqual(HEIGHTS.surfaceY);
    }
    // K8: the only in-frustum flip is the one the test injected above the water.
    expect(flips.filter((f) => f.inFrustum)).toHaveLength(1);
    release();
  });
});

/* ------------------------------------------------------------------------ */

describe('R49 K9: an off-screen floater or wader costs nothing (hidden by the latch), and never pops in', () => {
  beforeEach(() => {
    resetResidencyForTests();
    resetSceneReadiness();
    resetSceneProgressForTests();
  });
  afterEach(() => {
    resetResidencyForTests();
    resetSceneReadiness();
    resetSceneProgressForTests();
  });

  const DIMS: BuoyancyDims = { heightM: 0.8, lengthM: 0.6, beamM: 0.6 };
  const bodyR = 0.5 * Math.hypot(DIMS.beamM, DIMS.heightM, DIMS.lengthM);

  const sphere = (castsShadow: boolean, dir: { x: number; y: number; z: number } | null, dims: BuoyancyDims = DIMS) =>
    residentViewSphere(1, 0.2, -2, dims, castsShadow, dir, { x: 0, y: 0, z: 0, r: 0 });

  it('the view sphere pads the body sphere by the director convention, centred half a body above the root', () => {
    const s = sphere(false, null);
    expect(s.x).toBe(1);
    expect(s.y).toBeCloseTo(0.2 + DIMS.heightM / 2, 12);
    expect(s.z).toBe(-2);
    expect(s.r).toBeCloseTo(bodyR * RESIDENT_VIEW_PAD_SCALE + RESIDENT_VIEW_PAD_M, 12);
    // Always strictly larger than the body (the hide / show margin).
    expect(s.r - bodyR).toBeGreaterThanOrEqual(RESIDENT_VIEW_PAD_M);
    // A non-caster ignores the key light.
    expect(sphere(false, { x: 0, y: -1, z: 0 })).toEqual(s);
    expect(residentViewSphere(0, 0, 0, { heightM: -1, lengthM: -1, beamM: -1 }, false, null, { x: 0, y: 0, z: 0, r: 0 }).r).toBe(RESIDENT_VIEW_PAD_M);
  });

  it('a caster: swept down the key light by its shadow reach (the director sweep), or padded by 4 body heights with no key known', () => {
    const plain = sphere(false, null);
    expect(sphere(true, null).r).toBeCloseTo(plain.r + DIMS.heightM * RESIDENT_SHADOW_REACH_HEIGHTS, 12);
    // A key straight down: the shadow is under the feet; the sphere grows by half the reach and moves down.
    const top = DIMS.heightM / 2 + plain.r;
    const down = sphere(true, { x: 0, y: -1, z: 0 });
    expect(down.r).toBeCloseTo(plain.r + top / 2, 12);
    expect(down.y).toBeCloseTo(plain.y - top / 2, 12);
    // A 30° key toward +x: the sphere encloses the swept capsule, off toward the shadow.
    const e = Math.PI / 6;
    const dir = { x: Math.cos(e), y: -Math.sin(e), z: 0 };
    const low = sphere(true, dir);
    const reach = top / Math.sin(e);
    expect(low.r).toBeCloseTo(plain.r + reach / 2, 12);
    expect(low.x).toBeCloseTo(plain.x + (dir.x * reach) / 2, 12);
    // The capsule's far end (the shadow tip) is inside the sphere.
    const tipX = plain.x + dir.x * reach;
    const tipY = plain.y + dir.y * reach;
    expect(Math.hypot(tipX - low.x, tipY - low.y) + plain.r).toBeLessThanOrEqual(low.r + 1e-9);
    // A grazing (or upward) key is bounded by the 40 m sweep.
    expect(sphere(true, { x: 1, y: 0, z: 0 }).r).toBeCloseTo(plain.r + RESIDENT_SHADOW_SWEEP_MAX_M / 2, 12);
  });

  it('hidden while still and out of view, shown while the camera moves or once the padded sphere reaches the view; no flip is in-frustum', () => {
    const gen = beginSceneGeneration('sakura:day')!;
    // A 1-D view: x > 0 is on screen (the still frustum); "everywhere" while the camera moves.
    const still = (x: number, r: number) => x + r > 0;
    let moving = false;
    const intersects = (x: number, r: number) => moving || still(x, r);
    const root = new Object3D();
    root.position.set(-3, 0, 0);
    let wants = true;
    const flips: { visible: boolean; inFrustum: boolean; x: number }[] = [];
    // WaterResident.tsx's registration: the wish is the padded view sphere; the flip is judged by the
    // director's REAL root-box test (the body sphere against the still frustum).
    const release = registerLatchActor({ id: 'sakura-prop-resident-core-probe-float-0', root: () => root, wants: () => wants });
    const realRootTest = (r: Object3D) => still(r.position.x, bodyR);
    const frame = (dx: number) => {
      applyLatchVisibility(realRootTest, (_id, visible, inFrustum) => flips.push({ visible, inFrustum, x: root.position.x }));
      root.position.x += dx;
      wants = intersects(root.position.x, residentViewSphere(root.position.x, 0, 0, DIMS, false, null, { x: 0, y: 0, z: 0, r: 0 }).r);
    };
    noteRevealArmed(gen, 1000);
    frame(0);
    frame(0);
    expect(root.visible).toBe(false);
    // The camera moves: shown at once (the director hands "everywhere"), out of the real view.
    moving = true;
    frame(0);
    frame(0);
    expect(root.visible).toBe(true);
    moving = false;
    frame(0);
    frame(0);
    expect(root.visible).toBe(false);
    // Drifting into view with the camera still (10 cm per frame, far faster than any drift):
    // shown while the body is still off screen.
    for (let i = 0; i < 40; i += 1) frame(0.1);
    expect(root.visible).toBe(true);
    expect(flips.filter((f) => f.visible)).toHaveLength(2);
    expect(flips.filter((f) => !f.visible)).toHaveLength(2);
    expect(flips.filter((f) => f.inFrustum)).toHaveLength(0);
    release();
  });
});

/* ------------------------------------------------------------------------ */

describe('R49 fix D-R1 / D-R2: a show flip is judged where the resident is now, and lands in the frame the camera starts moving', () => {
  beforeEach(() => {
    resetResidencyForTests();
    resetSceneReadiness();
    resetSceneProgressForTests();
  });
  afterEach(() => {
    resetResidencyForTests();
    resetSceneReadiness();
    resetSceneProgressForTests();
  });

  /** A camera at the origin looking down −z, and the director's real root-box test (FigureDirector `rootInFrustum`). */
  const view = () => {
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.updateMatrixWorld();
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const box = new Box3();
    const sphere = new Sphere();
    return (root: Object3D): boolean => {
      box.setFromObject(root);
      if (box.isEmpty()) return false;
      box.getBoundingSphere(sphere);
      return frustum.intersectsSphere(sphere);
    };
  };

  /** A resident-shaped root (a group with a 0.6 m body mesh) far off to the side, in a scene. */
  const resident = () => {
    const scene = new Scene();
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(0.6, 0.6, 0.6), new MeshBasicMaterial()));
    root.position.set(-40, 0, -10);
    scene.add(root);
    scene.updateMatrixWorld();
    return { scene, root };
  };

  it('D-R1: a root that moved into view while hidden gets its show-flip answer at its CURRENT transform (the scene keeps its world matrix live)', () => {
    const gen = beginSceneGeneration('sakura:day')!;
    const rootInFrustum = view();
    const { scene, root } = resident();
    let wants = false;
    const flips: { visible: boolean; inFrustum: boolean }[] = [];
    const flip = createResidentFlipOut();
    // WaterResident.tsx's registration: the flip answer through `residentFlipInFrustum` (a floater: the generic test).
    const release = registerLatchActor({
      id: 'sakura-prop-resident-core-probe-float-0',
      root: () => root,
      wants: () => wants,
      inFrustum: (r, generic) => residentFlipInFrustum(null, 0, r, generic, flip).inFrustum,
    });
    // One frame: the latch (director, before the step), the step moves the root, the render updates the scene.
    const frame = (dx: number) => {
      applyLatchVisibility(rootInFrustum, (_id, visible, inFrustum) => flips.push({ visible, inFrustum }));
      root.position.x += dx;
      scene.updateMatrixWorld();
    };
    noteRevealArmed(gen, 1000);
    frame(0);
    expect(root.visible).toBe(false);
    expect(flips).toEqual([{ visible: false, inFrustum: false }]);
    // Hidden, it drifts 40 m into the middle of the view (frames rendered meanwhile).
    for (let i = 0; i < 10; i += 1) frame(4);
    expect(root.position.x).toBeCloseTo(0, 9);
    wants = true;
    frame(0);
    expect(root.visible).toBe(true);
    // The show is judged where the body is now: in the middle of the frame.
    expect(flips[1]).toEqual({ visible: true, inFrustum: true });
    // The world matrix followed the drift while hidden.
    expect(root.matrixWorld.elements[12]).toBeCloseTo(0, 9);
    // The old `matrixWorldAutoUpdate = visible` toggle froze it: the same test then reads the stale transform.
    const stale = resident();
    stale.root.visible = false;
    stale.root.matrixWorldAutoUpdate = false;
    stale.root.position.x = 0;
    stale.scene.updateMatrixWorld();
    stale.root.visible = true;
    expect(rootInFrustum(stale.root)).toBe(false);
    release();
  });

  it('residentFlipInFrustum: a floater or the wader answers the generic test; the surfacer keeps R32 (under water: false, the generic test not asked)', () => {
    const out = createResidentFlipOut();
    let asked = 0;
    const yes = () => {
      asked += 1;
      return true;
    };
    expect(residentFlipInFrustum(null, 0, null, yes, out)).toEqual({ inFrustum: true, underWater: undefined });
    expect(residentFlipInFrustum(null, 0, null, () => false, out)).toEqual({ inFrustum: false, underWater: undefined });
    expect(asked).toBe(1);
    expect(residentFlipInFrustum(SPOT.surfaceY - 0.08, SPOT.surfaceY, null, yes, out)).toEqual({ inFrustum: false, underWater: true });
    expect(residentFlipInFrustum(SPOT.surfaceY, SPOT.surfaceY, null, yes, out)).toEqual({ inFrustum: false, underWater: true });
    expect(asked).toBe(1);
    expect(residentFlipInFrustum(SPOT.surfaceY + 0.2, SPOT.surfaceY, null, yes, out)).toEqual({ inFrustum: true, underWater: false });
    expect(residentFlipInFrustum(SPOT.surfaceY + 0.2, SPOT.surfaceY, null, () => false, out)).toEqual({ inFrustum: false, underWater: false });
    // The reused record (no allocation per flip).
    expect(residentFlipInFrustum(null, 0, null, yes, out)).toBe(out);
  });

  it('residentLatchWants: the step wish, or shown when the progress changed since the step, there is none, or a focus is open', () => {
    expect(residentLatchWants(true, 2, 2, false)).toBe(true);
    expect(residentLatchWants(false, 2, 2, false)).toBe(false);
    expect(residentLatchWants(false, 2 + RESIDENT_STILL_EPS / 2, 2, false)).toBe(false);
    expect(residentLatchWants(false, 2 + RESIDENT_STILL_EPS * 2, 2, false)).toBe(true);
    expect(residentLatchWants(false, 2 - RESIDENT_STILL_EPS * 2, 2, false)).toBe(true);
    expect(residentLatchWants(false, 2, 2, true)).toBe(true);
    expect(residentLatchWants(false, null, 2, false)).toBe(true);
    // Before any step (NaN): shown.
    expect(residentLatchWants(false, 2, Number.NaN, false)).toBe(true);
  });

  it('final review (dormant latch): a dormant stay across a camera move keeps the root shown once the camera stops', () => {
    // Hidden while still and out of view: the wish (false) is written at progress 0.2 (WaterResident noteWish).
    const wish = { wants: false, smooth: 0.2 };
    // A far station jump: the dormancy flag flips with the scroll, so every step during the flight
    // returns before noteWish and writes neither field. The latch shows the root while the progress moves...
    for (const smooth of [0.25, 0.35, 0.45, 0.5]) expect(residentLatchWants(wish.wants, smooth, wish.smooth, false)).toBe(true);
    // ...and keeps it shown after the camera stops (progress 0.5 != the stale 0.2): no pop-out on landing.
    expect(residentLatchWants(wish.wants, 0.5, wish.smooth, false)).toBe(true);
    // The defect this guards: refreshing only the progress on dormant steps re-applies the stale false.
    expect(residentLatchWants(wish.wants, 0.5, 0.5, false)).toBe(false);
  });

  it('D-R2: hidden with the camera still, the latch shows the root in the very frame the conductor starts moving (before the rig moves the camera)', () => {
    const gen = beginSceneGeneration('sakura:day')!;
    const root = new Object3D();
    const progress = { smooth: 3 };
    let focusOpen = false;
    const scratch = { wants: true, smooth: Number.NaN };
    const release = registerLatchActor({
      id: 'sakura-prop-resident-core-probe-wader',
      root: () => root,
      wants: () => residentLatchWants(scratch.wants, progress.smooth, scratch.smooth, focusOpen),
    });
    const renders: boolean[] = [];
    // One frame: the conductor advances (priority −1), the latch, the step (off screen while still,
    // "everywhere" while the director sees a move or a focus), then the rig and the render.
    const frame = (smoothStep: number) => {
      const before = progress.smooth;
      progress.smooth += smoothStep;
      const directorMoved = progress.smooth !== before || focusOpen;
      applyLatchVisibility();
      scratch.smooth = progress.smooth;
      scratch.wants = directorMoved;
      renders.push(root.visible);
    };
    noteRevealArmed(gen, 1000);
    frame(0);
    frame(0);
    expect(root.visible).toBe(false);
    // The first frame of a scroll / station jump: shown in that frame's render.
    frame(0.05);
    expect(renders.at(-1)).toBe(true);
    frame(0.02);
    expect(renders.at(-1)).toBe(true);
    // Still again: hidden once the step saw the stop.
    frame(0);
    frame(0);
    expect(root.visible).toBe(false);
    // A focus opening with the progress unchanged: shown in that frame too.
    focusOpen = true;
    frame(0);
    expect(renders.at(-1)).toBe(true);
    release();
  });
});
