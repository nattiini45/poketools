import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { createAmbientBeatBus, type BeatGrantContext, type BeatTicket } from '../ambient-beats';
import {
  bankFor,
  buildSkyLane,
  createLaneFrame,
  createLaneStepOut,
  initLaneFlyerState,
  lanePass,
  laneAccentAt,
  laneFlyerVisible,
  laneLimits,
  LANE_BANK_MAX_RAD,
  LANE_PERIOD_S,
  LANE_PITCH_MAX_RAD,
  LANE_STEP_M,
  pinLaneFlyer,
  sampleSkyLane,
  stepLaneFlyer,
  type LaneFlyerState,
  type LaneStepInput,
  type SkyLane,
  type SkyLaneSpec,
} from '../sky-lanes';
import {
  createSurfacerOut,
  initSurfacerState,
  stepSurfacer,
  surfacerHeights,
} from '../water-resident';
import {
  applyLatchVisibility,
  assertLatchVisible,
  latchHideAllowed,
  registerLatchActor,
  resetResidencyForTests,
} from '@/components/world/route/residency-store';
import { markVeiledGeneration, noteRevealArmed, resetSceneProgressForTests } from '@/components/world/route/scene-progress';
import { beginSceneGeneration, resetSceneReadiness } from '@/components/world/route/world-readiness';

/**
 * POKEMON-CORE SEAT D step 4 (L2): the sky-lane contract — the arc-length
 * table, the lane limits (yaw rate ≤ 20°/s, bank ≤ 18°), the seeded pass
 * schedule ([45, 90] s, `beatForce` places the first pass), and the flyer's
 * state machine (hidden between passes, a pass starts only off frame and
 * granted, it hides only off frame). Plus the push latch (C5, L7) against
 * A1's `residency-store`: an actor that wants to hide is shown whenever a
 * load or veil warm runs.
 */

const DEG = Math.PI / 180;

function arcLane(radius: number, speed: number, sweepDeg = 120): SkyLane {
  const points: [number, number, number][] = [];
  for (let a = 0; a <= sweepDeg; a += 10) {
    const r = a * DEG;
    points.push([radius * Math.sin(r), 10, radius * (1 - Math.cos(r))]);
  }
  const spec: SkyLaneSpec = {
    id: `arc-${radius}`,
    station: 0,
    points,
    speedMps: speed,
    bodyRadiusM: 1,
    perch: null,
    entryExitMarginNdc: 0.05,
  };
  return buildSkyLane(spec);
}

const STRAIGHT: SkyLaneSpec = {
  id: 'straight',
  station: 0,
  points: [
    [0, 20, 0],
    [10, 12, 0],
    [20, 12, 0],
    [30, 20, 0],
  ],
  speedMps: 5,
  bodyRadiusM: 1,
  perch: { x: 5, y: 3, z: 5, yaw: 0 },
  entryExitMarginNdc: 0.05,
};

describe('buildSkyLane / sampleSkyLane', () => {
  it('passes through its ends and spaces the table at ≈ 0.25 m of arc', () => {
    const lane = buildSkyLane(STRAIGHT);
    expect([lane.px[0], lane.py[0], lane.pz[0]]).toEqual([0, 20, 0]);
    const last = lane.count - 1;
    expect(lane.px[last]).toBeCloseTo(30, 9);
    expect(lane.py[last]).toBeCloseTo(20, 9);
    expect(lane.step).toBeLessThanOrEqual(LANE_STEP_M + 1e-9);
    expect(lane.step).toBeGreaterThan(LANE_STEP_M * 0.95);
    // Uniform arc length: consecutive samples one step apart (to the chord).
    for (let i = 1; i < lane.count; i += 1) {
      const d = Math.hypot(lane.px[i] - lane.px[i - 1], lane.py[i] - lane.py[i - 1], lane.pz[i] - lane.pz[i - 1]);
      expect(Math.abs(d - lane.step)).toBeLessThan(0.01);
    }
  });

  it('interpolates the table and clamps pitch to ±10°', () => {
    const lane = buildSkyLane(STRAIGHT);
    const frame = createLaneFrame();
    sampleSkyLane(lane, 0, frame);
    expect(frame.pitch).toBeGreaterThanOrEqual(-LANE_PITCH_MAX_RAD);
    // The entry dives ~39° down; the clamp holds the nose at −10°.
    expect(frame.pitch).toBeCloseTo(-LANE_PITCH_MAX_RAD, 9);
    // Centripetal Catmull–Rom between the two 12 m points sags under them (their neighbours are high).
    sampleSkyLane(lane, lane.length / 2, frame);
    expect(frame.y).toBeGreaterThan(10.5);
    expect(frame.y).toBeLessThan(12.01);
    sampleSkyLane(lane, 1e9, frame);
    expect(frame.x).toBeCloseTo(30, 9);
  });

  it('banks atan(v²κ/g), clamped to ±18°, into the turn', () => {
    expect(bankFor(3.5, 1 / 10)).toBeCloseTo(Math.atan((3.5 * 3.5) / (9.81 * 10)), 12);
    expect(bankFor(30, 1)).toBe(LANE_BANK_MAX_RAD);
    expect(bankFor(30, -1)).toBe(-LANE_BANK_MAX_RAD);
    const lane = arcLane(10, 3.5);
    const frame = createLaneFrame();
    sampleSkyLane(lane, lane.length / 2, frame);
    // This arc turns toward −yaw, so it banks negative (into the turn).
    expect(Math.abs(frame.bank) / DEG).toBeCloseTo(Math.atan((3.5 * 3.5) / (9.81 * 10)) / DEG, 0);
    expect(Math.sign(frame.bank)).toBe(Math.sign(lane.kappa[Math.floor(lane.count / 2)]));
  });
});

describe('laneLimits', () => {
  it('yaw rate v·κ on a 10 m arc at 3.5 m/s: 20.05°/s mid-arc; the limits take the maximum (the end segments bend harder)', () => {
    const lane = arcLane(10, 3.5);
    const mid = Math.abs(lane.kappa[Math.floor(lane.count / 2)]) * 3.5;
    expect(mid / DEG).toBeCloseTo(3.5 / 10 / DEG, 0);
    const limits = laneLimits(lane);
    expect(limits.maxYawRateDegS).toBeGreaterThanOrEqual(mid / DEG - 1e-9);
    expect(limits.maxBankDeg).toBeGreaterThanOrEqual(7.1 - 0.05);
  });

  it('a lawful lane stays ≤ 20°/s and ≤ 18°; a tight one is caught (the test rejects it, the runtime never clamps)', () => {
    const ok = laneLimits(arcLane(20, 3.5));
    expect(ok.maxYawRateDegS).toBeLessThanOrEqual(20);
    expect(ok.maxBankDeg).toBeLessThanOrEqual(18);
    const tight = laneLimits(arcLane(4, 6));
    expect(tight.maxYawRateDegS).toBeGreaterThan(20);
    expect(tight.maxBankDeg).toBeGreaterThan(18);
  });
});

describe('lanePass (the pass schedule)', () => {
  it('is deterministic, inside [45, 90] s, and jitters by ≥ 20 % of its mean', () => {
    const delays = Array.from({ length: 40 }, (_, k) => lanePass(7, 'probe', k));
    expect(delays).toEqual(Array.from({ length: 40 }, (_, k) => lanePass(7, 'probe', k)));
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(LANE_PERIOD_S[0]);
      expect(d).toBeLessThanOrEqual(LANE_PERIOD_S[1]);
    }
    const mean = delays.reduce((s, d) => s + d, 0) / delays.length;
    expect(Math.max(...delays) - Math.min(...delays)).toBeGreaterThanOrEqual(0.2 * mean);
    expect(lanePass(8, 'probe', 0)).not.toBe(lanePass(7, 'probe', 0));
    expect(lanePass(7, 'other', 0)).not.toBe(lanePass(7, 'probe', 0));
    for (let k = 0; k < 20; k += 1) {
      expect(laneAccentAt(7, 'probe', k)).toBeGreaterThanOrEqual(0.3);
      expect(laneAccentAt(7, 'probe', k)).toBeLessThanOrEqual(0.4);
    }
  });
});

/* ------------------------------------------------------------------------ */
/* The flyer's state machine                                                */
/* ------------------------------------------------------------------------ */

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

function baseInput(): LaneStepInput {
  return { laneT: 0, active: true, forced: false, granted: false, entryOut: true, currentOut: true, perchWanted: false, perchOut: true };
}

interface FlyerRun {
  state: LaneFlyerState;
  passStarts: number[];
  hiddenAt: number[];
  visibleFrames: number;
  maxBankDeg: number;
}

/** Drive the flyer against the real bus; `inView(t)` says whether the camera sees the flyer's current point. */
function runFlyer(lane: SkyLane, fps: number, seconds: number, force: number | null, inView: (t: number) => boolean = () => false): FlyerRun {
  const bus = createAmbientBeatBus({ force: { surfacing: null, flyover: force, play: null } });
  const state = initLaneFlyerState(11, lane);
  const out = createLaneStepOut();
  const input = baseInput();
  let ticket: BeatTicket | null = null;
  let t = 0;
  const passStarts: number[] = [];
  const hiddenAt: number[] = [];
  let visibleFrames = 0;
  let maxBankDeg = 0;
  const dt = 1 / fps;
  for (let i = 0; i < seconds * fps; i += 1) {
    t += dt;
    input.laneT = t;
    input.forced = bus.consumeForce('flyover', t);
    input.granted = ticket?.state === 'granted';
    input.currentOut = !inView(t);
    const was = state.mode;
    stepLaneFlyer(state, lane, dt, input, out);
    // A sphere with no active face in view (the grant context's faceDistanceNdc says null): the NDC rule passes.
    if (out.request) ticket = bus.request('flyover', 'flyer', { x: 0, y: 0, z: 0, r: 1 }, out.forced ? { forced: true } : undefined);
    if (out.release && ticket) {
      bus.release(ticket);
      ticket = null;
    }
    if (was !== 'pass' && state.mode === 'pass') passStarts.push(t);
    if (was === 'exit' && state.mode === 'idle') hiddenAt.push(t);
    if (out.wantsVisible) visibleFrames += 1;
    maxBankDeg = Math.max(maxBankDeg, Math.abs(out.frame.bank) / DEG);
    bus.grant(grantCtx(dt));
  }
  return { state, passStarts, hiddenAt, visibleFrames, maxBankDeg };
}

describe('stepLaneFlyer', () => {
  const lane = buildSkyLane(STRAIGHT);

  it('is hidden between passes and flies its first natural pass at lanePass(seed, id, 0)', () => {
    const first = lanePass(11, STRAIGHT.id, 0);
    const run = runFlyer(lane, 30, first + 20, null);
    expect(run.passStarts.length).toBe(1);
    expect(run.passStarts[0]).toBeGreaterThanOrEqual(first);
    expect(run.passStarts[0]).toBeLessThan(first + 0.1);
    expect(run.hiddenAt.length).toBe(1);
    expect(run.state.mode).toBe('idle');
    expect(laneFlyerVisible(run.state)).toBe(false);
    // Visible only for the pass itself (+ the frame it leaves).
    expect(run.visibleFrames / 30).toBeCloseTo(lane.length / STRAIGHT.speedMps, 0);
  });

  it('beatForce places the first pass at the forced second, then the seeded schedule resumes', () => {
    const run = runFlyer(lane, 30, 12 + 10 + 95, 12);
    expect(run.passStarts[0]).toBeGreaterThanOrEqual(12);
    expect(run.passStarts[0]).toBeLessThan(12.1);
    expect(run.passStarts.length).toBeGreaterThanOrEqual(2);
    const gap = run.passStarts[1] - run.hiddenAt[0];
    expect(gap).toBeGreaterThanOrEqual(LANE_PERIOD_S[0] - 0.1);
    expect(gap).toBeLessThanOrEqual(LANE_PERIOD_S[1] + 0.1);
  });

  it('never starts while its entry is in the frustum, and keeps the request', () => {
    const state = initLaneFlyerState(11, lane);
    const out = createLaneStepOut();
    const input = { ...baseInput(), forced: true, entryOut: false };
    stepLaneFlyer(state, lane, 1 / 30, input, out);
    expect(state.mode).toBe('idle');
    input.forced = false;
    input.entryOut = true;
    stepLaneFlyer(state, lane, 1 / 30, input, out);
    expect(out.request && out.forced).toBe(true);
    input.granted = true;
    input.entryOut = false;
    stepLaneFlyer(state, lane, 1 / 30, input, out);
    expect(state.mode).toBe('pending');
    input.entryOut = true;
    stepLaneFlyer(state, lane, 1 / 30, input, out);
    expect(state.mode).toBe('pass');
    expect(out.wantsVisible).toBe(true);
  });

  it('at the end it stays shown until it is out of the frustum, then hides and releases', () => {
    const inViewUntil = 12 + lane.length / STRAIGHT.speedMps + 3;
    const run = runFlyer(lane, 30, 40, 12, (t) => t < inViewUntil);
    expect(run.hiddenAt.length).toBe(1);
    expect(run.hiddenAt[0]).toBeGreaterThanOrEqual(inViewUntil);
  });

  it('30 vs 60 fps fly the same pass (pose within 1 mm, bank within 0.2°) — the glide is the clamped delta', () => {
    // Measured from the pass start (the grant lands on a frame boundary; the glide itself is the clamped delta).
    const at = (fps: number, seconds: number) => {
      const state = initLaneFlyerState(11, lane);
      const out = createLaneStepOut();
      const input = { ...baseInput(), forced: true, granted: true };
      while (state.mode !== 'pass') stepLaneFlyer(state, lane, 1 / fps, input, out);
      const n = Math.round((seconds - state.s / STRAIGHT.speedMps) * fps);
      for (let i = 0; i < n; i += 1) stepLaneFlyer(state, lane, 1 / fps, input, out);
      return { ...out.frame };
    };
    const a = at(30, 3);
    const b = at(60, 3);
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(1e-3);
    expect(Math.abs(a.bank - b.bank) / DEG).toBeLessThan(0.2);
  });

  it('the hiding step keeps the pose where the flyer was (lane end / perch): it never draws at the entry while still shown', () => {
    // R27: the latch runs BEFORE the step, so the root is still shown on the frame the step flips wantsVisible false.
    const state = initLaneFlyerState(11, lane);
    const out = createLaneStepOut();
    const input = { ...baseInput(), forced: true, granted: true, currentOut: false };
    while (state.mode !== 'exit') stepLaneFlyer(state, lane, 1 / 30, input, out);
    const end = { x: lane.px[lane.count - 1], y: lane.py[lane.count - 1], z: lane.pz[lane.count - 1] };
    input.currentOut = true;
    stepLaneFlyer(state, lane, 1 / 30, input, out);
    expect(state.mode).toBe('idle');
    expect(out.wantsVisible).toBe(false);
    expect(out.release).toBe(true);
    expect(Math.hypot(out.frame.x - end.x, out.frame.y - end.y, out.frame.z - end.z)).toBeLessThan(1e-9);
    // The next step (root hidden by the latch now) parks it at the entry.
    stepLaneFlyer(state, lane, 1 / 30, input, out);
    expect(state.s).toBe(0);
    expect(Math.hypot(out.frame.x - lane.px[0], out.frame.y - lane.py[0], out.frame.z - lane.pz[0])).toBeLessThan(1e-9);

    // Perch → idle: the hiding step stays on the perch.
    const perched = initLaneFlyerState(11, lane);
    const pin = { ...baseInput(), perchWanted: true, perchOut: true };
    stepLaneFlyer(perched, lane, 0.1, pin, out);
    expect(perched.mode).toBe('perch');
    pin.perchWanted = false;
    stepLaneFlyer(perched, lane, 0.1, pin, out);
    expect(perched.mode).toBe('idle');
    expect(out.wantsVisible).toBe(false);
    expect([out.frame.x, out.frame.y, out.frame.z]).toEqual([5, 3, 5]);
  });

  it('below full it perches only while both points are off frame; perch null stays hidden; the pin re-arms', () => {
    const state = initLaneFlyerState(11, lane);
    const out = createLaneStepOut();
    const input = { ...baseInput(), perchWanted: true, perchOut: false };
    stepLaneFlyer(state, lane, 0.1, input, out);
    expect(state.mode).toBe('idle');
    input.perchOut = true;
    stepLaneFlyer(state, lane, 0.1, input, out);
    expect(state.mode).toBe('perch');
    expect(out.wantsVisible).toBe(true);
    expect([out.frame.x, out.frame.y, out.frame.z]).toEqual([5, 3, 5]);
    // Back to full: leaves the perch only off frame.
    input.perchWanted = false;
    input.perchOut = false;
    stepLaneFlyer(state, lane, 0.1, input, out);
    expect(state.mode).toBe('perch');
    input.perchOut = true;
    stepLaneFlyer(state, lane, 0.1, input, out);
    expect(state.mode).toBe('idle');
    const noPerch = buildSkyLane({ ...STRAIGHT, id: 'np', perch: null });
    const s2 = initLaneFlyerState(11, noPerch);
    stepLaneFlyer(s2, noPerch, 0.1, { ...baseInput(), perchWanted: true }, out);
    expect(s2.mode).toBe('idle');
    expect(out.wantsVisible).toBe(false);
    pinLaneFlyer(state, lane);
    expect(state).toEqual(initLaneFlyerState(11, lane));
  });

  it('a withdrawn natural request re-arms (no backlog) when the flyer turns inactive', () => {
    const state = initLaneFlyerState(11, lane);
    const out = createLaneStepOut();
    const input = { ...baseInput(), laneT: 100 };
    stepLaneFlyer(state, lane, 0.1, input, out);
    expect(out.request).toBe(true);
    input.active = false;
    stepLaneFlyer(state, lane, 0.1, input, out);
    expect(out.release).toBe(true);
    expect(state.mode).toBe('idle');
    expect(state.nextPassT).toBeGreaterThanOrEqual(100 + LANE_PERIOD_S[0]);
  });
});

/* ------------------------------------------------------------------------ */
/* The push latch (C5, L7) against A1's residency store                     */
/* ------------------------------------------------------------------------ */

describe('push latch: D actors are shown whenever a load or veil warm runs', () => {
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

  /**
   * One frame in R27 order (A2's `FigureDirector.tsx`): the latch applies
   * the wishes FIRST, then the actors step (and update their wishes for the
   * next frame). This test assumes that order.
   */
  it('a hidden-wanting flyer and a submerged surfacer: shown through the load warm, hidden live, shown again by the veil swap', () => {
    const lane = buildSkyLane(STRAIGHT);
    const flyer = initLaneFlyerState(3, lane);
    const flyerOut = createLaneStepOut();
    const heights = surfacerHeights({ x: 0, z: 0, yaw: 0, surfaceY: 0.06, headroomTopY: 3 }, 2);
    const surfacer = initSurfacerState(3, heights);
    const surfacerOut = createSurfacerOut();
    const flyerRoot = new Object3D();
    const surfacerRoot = new Object3D();
    const wants = { flyer: true, surfacer: true };
    const releases = [
      registerLatchActor({ id: 'sakura-prop-flyer-probe', root: () => flyerRoot, wants: () => wants.flyer }),
      registerLatchActor({ id: 'sakura-prop-resident-surfacer', root: () => surfacerRoot, wants: () => wants.surfacer }),
    ];
    const frame = (live: boolean) => {
      applyLatchVisibility();
      stepLaneFlyer(flyer, lane, 1 / 30, { ...baseInput(), active: live, laneT: 0 }, flyerOut);
      stepSurfacer(surfacer, heights, 1 / 30, { active: live, granted: false, forced: false, idle2S: 0 }, surfacerOut);
      wants.flyer = flyerOut.wantsVisible;
      wants.surfacer = surfacerOut.wantsVisible;
    };

    const load = beginSceneGeneration('sakura:day')!;
    for (let i = 0; i < 5; i += 1) frame(false);
    expect([wants.flyer, wants.surfacer]).toEqual([false, false]);
    // The load warm: nothing hidden before the first buffer slice.
    expect(latchHideAllowed()).toBe(false);
    expect([flyerRoot.visible, surfacerRoot.visible]).toEqual([true, true]);
    expect(assertLatchVisible(load)).toBe(0);

    noteRevealArmed(load, 1000);
    frame(true);
    expect([flyerRoot.visible, surfacerRoot.visible]).toEqual([false, false]);

    // The D32 veil swap: shown synchronously at the new generation, before its warm.
    markVeiledGeneration(load + 1);
    const swap = beginSceneGeneration('sakura:night')!;
    expect([flyerRoot.visible, surfacerRoot.visible]).toEqual([true, true]);
    frame(true);
    expect([flyerRoot.visible, surfacerRoot.visible]).toEqual([true, true]);
    expect(assertLatchVisible(swap)).toBe(0);
    for (const release of releases) release();
  });
});
