import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _roots, advance as r3fAdvance, invalidate as r3fInvalidate } from '@react-three/fiber';
import {
  clearLeftoverFrames,
  createDrivenClock,
  driveClock,
  DRIVEN_CLOCK_DRIFT_S,
  frameCapReadout,
  noteFrameCapDriver,
  noteParkedFrame,
  onDrivenFrameloopChange,
  plausibleClockSeconds,
  resetFrameCapForTests,
  restartDrivenClock,
  type DrivenClock,
  type R3fLoopState,
} from '../frame-cap';
import { canvasSource } from './route-sources';

/**
 * ENGINE-A5 fix (verify-a5 regression: "D40 unpark clock jump"). Under the
 * default cap the canvas runs `frameloop="never"` and FrameCapDriver advances
 * it; while the tab is parked it runs `demand`. verify-a5 caught r3f's OWN
 * rAF loop advancing the root after an unpark: `invalidate()` under `demand`
 * leaves `internal.frames` > 0 and the loop scheduled, and r3f 9.7's `loop()`
 * updates a root whenever `frameloop === 'always' || internal.frames > 0` —
 * under `never`, `update(rafMs)` takes the delta as `rafMs - clock.elapsedTime`
 * (a millisecond stamp read as seconds): every mixer got ~29,584 s.
 *
 * These tests run r3f 9.7's REAL `loop` (captured from `invalidate`'s
 * requestAnimationFrame), `invalidate` and `advance` against a root whose
 * `setFrameloop` is a line-for-line copy of r3f's (events-*.esm.js), with a
 * frame subscriber standing in for every AnimationMixer.
 */

type Frameloop = R3fLoopState['frameloop'];
type Listener = (next: FakeState, previous: FakeState) => void;
interface FakeState extends R3fLoopState {
  clock: THREE.Clock;
  scene: object;
  camera: object;
  gl: { xr: { isPresenting: boolean }; render: () => void };
  internal: { active: boolean; frames: number; priority: number; subscribers: unknown[] };
  setFrameloop: (next: Frameloop) => void;
}

const VSYNC = 1000 / 60;
/** One even40 interval on 60 Hz, plus rAF jitter. */
const INTERVAL_S = (2 * VSYNC) / 1000 + 0.0005;

let pendingRaf: FrameRequestCallback[] = [];
const rootKeys: object[] = [];

beforeEach(() => {
  pendingRaf = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pendingRaf.push(cb);
    return pendingRaf.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    pendingRaf = [];
  });
});

afterEach(() => {
  for (const key of rootKeys.splice(0)) _roots.delete(key as HTMLCanvasElement);
  vi.unstubAllGlobals();
  resetFrameCapForTests();
});

/** A root r3f's loop can see, with a subscriber that records every frame's delta (a mixer). */
function fakeRoot(frameloop: Frameloop) {
  const listeners = new Set<Listener>();
  const deltas: { delta: number; frameloop: Frameloop; elapsed: number }[] = [];
  const state = {
    frameloop,
    clock: new THREE.Clock(),
    scene: {},
    camera: {},
    gl: { xr: { isPresenting: false }, render: () => {} },
    internal: { active: true, frames: 0, priority: 0, subscribers: [] as unknown[] },
    setFrameloop(next: Frameloop) {
      // r3f 9.7 setFrameloop, verbatim apart from the zustand set().
      const clock = state.clock;
      clock.stop();
      clock.elapsedTime = 0;
      if (next !== 'never') {
        clock.start();
        clock.elapsedTime = 0;
      }
      const previous = { ...state };
      state.frameloop = next;
      for (const listener of listeners) listener(state, previous);
    },
  } as FakeState;
  if (frameloop === 'never') state.clock.stop();
  state.internal.subscribers.push({
    ref: { current: (_s: unknown, delta: number) => deltas.push({ delta, frameloop: state.frameloop, elapsed: state.clock.elapsedTime }) },
    store: { getState: () => state },
    priority: 0,
  });
  const store = { getState: () => state, subscribe: (listener: Listener) => (listeners.add(listener), () => listeners.delete(listener)) };
  const key = {};
  rootKeys.push(key);
  _roots.set(key as HTMLCanvasElement, { store } as never);
  return { state, store, deltas };
}

/** Run whatever r3f's loop has scheduled, once, at `rafMs` (r3f's real `loop`). */
function runR3fLoop(rafMs: number): void {
  const due = pendingRaf;
  pendingRaf = [];
  for (const cb of due) cb(rafMs);
}

/** FrameCapDriver's tick as RouteWorldCanvas runs it (a rendered rAF). */
function driverTick(state: FakeState, clock: DrivenClock, rafMs: number, withGuard: boolean): void {
  if (withGuard) clearLeftoverFrames(state);
  const { seconds, seat } = driveClock(clock, rafMs, state.clock.elapsedTime);
  if (seat !== null) state.clock.elapsedTime = seat;
  r3fAdvance(seconds, true, state as never);
}

/** The listener FrameCapDriver installs on r3f's store. */
function installGuard(store: ReturnType<typeof fakeRoot>['store'], clock: DrivenClock, nowMs: () => number): void {
  clearLeftoverFrames(store.getState());
  store.subscribe((next, previous) => {
    if (next.frameloop !== previous.frameloop) onDrivenFrameloopChange(clock, next, previous.frameloop, nowMs());
  });
}

/**
 * The verifier's park: ~9 s of driven frames from page time 20 s, park
 * (`demand`), a few invalidated demand frames, one more invalidate that leaves
 * the loop pending with frames > 0, unpark (`never`) at ~29.6 s, then r3f's
 * pending loop fires in the same rAF as the driver's first frames.
 */
function parkScenario(withGuard: boolean) {
  const root = fakeRoot('never');
  const clock = createDrivenClock();
  let page = 20_000;
  if (withGuard) {
    installGuard(root.store, clock, () => page);
    // FrameCapDriver's useFrame: parked frames set the resume point.
    root.state.internal.subscribers.push({
      ref: { current: (s: FakeState) => (s.frameloop !== 'never' ? noteParkedFrame(clock, s.clock.elapsedTime, page) : undefined) },
      store: { getState: () => root.state },
      priority: 0,
    });
  }
  restartDrivenClock(clock);
  for (let i = 0; i < 270; i += 1) {
    page = 20_000 + i * 2 * VSYNC;
    driverTick(root.state, clock, page, withGuard);
  }
  const beforePark = root.state.clock.elapsedTime;
  // Park: frameloop -> demand; the driver stops.
  page += 50;
  root.state.setFrameloop('demand');
  const parkSeat = root.state.clock.elapsedTime;
  for (let i = 0; i < 3; i += 1) {
    r3fInvalidate(root.state as never);
    page += 200;
    runR3fLoop(page);
  }
  // The last invalidate before the unpark: frames 1, loop scheduled.
  r3fInvalidate(root.state as never);
  const leftover = root.state.internal.frames;
  const mark = root.deltas.length;
  // Unpark ~4.7 s later: frameloop -> never, the driver re-enables.
  page += 4_700;
  root.state.setFrameloop('never');
  if (withGuard) clearLeftoverFrames(root.state);
  restartDrivenClock(clock);
  const samples: number[] = [root.state.clock.elapsedTime];
  // The rAF right after the unpark: r3f's pending loop was registered first
  // (a frame earlier), so it runs before the driver's first frame.
  runR3fLoop(page);
  samples.push(root.state.clock.elapsedTime);
  driverTick(root.state, clock, page, withGuard);
  samples.push(root.state.clock.elapsedTime);
  for (let i = 1; i <= 30; i += 1) {
    const ts = page + i * 2 * VSYNC;
    if (withGuard) clearLeftoverFrames(root.state);
    runR3fLoop(ts);
    driverTick(root.state, clock, ts, withGuard);
    samples.push(root.state.clock.elapsedTime);
  }
  return { root, clock, beforePark, parkSeat, leftover, after: root.deltas.slice(mark), samples };
}

describe('r3f 9.7 loop under never after a park (the verify-a5 defect, reproduced on r3f itself)', () => {
  it('without the guard, r3f\'s pending loop runs update(rafMs) under never: a millisecond stamp becomes a delta of thousands of seconds', () => {
    const { leftover, after, samples, beforePark } = parkScenario(false);
    expect(leftover).toBe(1);
    // r3f's loop: one update under never with delta = rafMs - clock (seconds) ~ 29,6xx.
    expect(after[0].frameloop).toBe('never');
    expect(after[0].delta).toBeGreaterThan(20_000);
    expect(samples[1]).toBeGreaterThan(20_000);
    // The driver's plausibility check no longer ADOPTS that clock (the pre-fix start did,
    // which kept every later frame ~29,584 s ahead): it re-seats on the driven clock.
    expect(samples[2]).toBeLessThan(beforePark + 2);
    expect(samples[samples.length - 1]).toBeLessThan(beforePark + 3);
  });
});

describe('ENGINE-A5 fix: r3f\'s loop never advances a never-root; the clock is continuous across park / unpark', () => {
  it('the unpark leaves no leftover frame, every delta after it is 0 or one displayed interval, and the clock never runs back or jumps', () => {
    resetFrameCapForTests();
    const { root, clock, beforePark, parkSeat, leftover, after, samples } = parkScenario(true);
    expect(leftover).toBe(1); // the parked loop DID leave a frame; the listener cleared it at the switch
    expect(root.state.internal.frames).toBe(0);
    // Park: r3f's restarted clock was seated on the driven clock (no zero).
    expect(parkSeat).toBeCloseTo(beforePark, 9);
    // Only the driver advanced the root after the unpark.
    expect(after.every((d) => d.frameloop === 'never')).toBe(true);
    expect(after.length).toBe(31);
    expect(after[0].delta).toBe(0);
    for (const d of after) {
      expect(d.delta).toBeGreaterThanOrEqual(0);
      expect(d.delta).toBeLessThanOrEqual(INTERVAL_S);
    }
    // The clock resumed where the last parked frame left it (demand frames tick the
    // seated clock on wall time) and only moves forward.
    const parked = root.deltas.filter((d) => d.frameloop === 'demand');
    expect(parked).toHaveLength(3);
    expect(parked[0].elapsed).toBeGreaterThanOrEqual(beforePark);
    expect(samples[0]).toBe(parked[parked.length - 1].elapsed);
    expect(samples[0]).toBeLessThan(beforePark + 2);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
      expect(samples[i] - samples[i - 1]).toBeLessThanOrEqual(0.05);
    }
    expect(clock.reseats).toBe(0);
    expect(frameCapReadout().framesCleared).toBe(1);
  });

  it('the driver alone (a loop that slipped through before the listener) is caught: an implausible r3f clock is never adopted, a moved clock is re-seated', () => {
    // Run start: a millisecond stamp in r3f's clock is not page time.
    const clock = createDrivenClock();
    clock.seconds = 21.3;
    restartDrivenClock(clock);
    expect(driveClock(clock, 29_600, 29_584.2)).toEqual({ seconds: 21.3, seat: 21.3 });
    // Demand frames that legitimately moved it ahead ARE adopted (A4R).
    const clock2 = createDrivenClock();
    clock2.seconds = 21.3;
    restartDrivenClock(clock2);
    expect(driveClock(clock2, 29_600, 22.1)).toEqual({ seconds: 22.1, seat: 22.1 });
    // Mid-run: another writer moved r3f's clock -> seat back on the driven clock, delta one interval.
    const step = driveClock(clock2, 29_600 + 2 * VSYNC, 29_600.03);
    expect(step.seat).toBeCloseTo(22.1, 9);
    expect(step.seconds - (step.seat as number)).toBeCloseTo((2 * VSYNC) / 1000, 6);
    expect(clock2.reseats).toBe(1);
    // ...and a clock zeroed under the driver (a stray setFrameloop) likewise.
    const zeroed = driveClock(clock2, 29_600 + 4 * VSYNC, 0);
    expect(zeroed.seat).toBeCloseTo(step.seconds, 9);
    expect(clock2.reseats).toBe(2);
    // On the driven clock: no seat.
    expect(driveClock(clock2, 29_600 + 6 * VSYNC, zeroed.seconds).seat).toBeNull();
    expect(DRIVEN_CLOCK_DRIFT_S).toBeCloseTo(1 / 60, 9);
  });

  it('plausibleClockSeconds: page time up to the page\'s age (+1 s); a ms stamp read as seconds, NaN or a negative is not', () => {
    expect(plausibleClockSeconds(0, 0)).toBe(true);
    expect(plausibleClockSeconds(29.5, 29_600)).toBe(true);
    expect(plausibleClockSeconds(30.5, 29_600)).toBe(true);
    expect(plausibleClockSeconds(29_584.2, 29_600)).toBe(false);
    expect(plausibleClockSeconds(Number.NaN, 29_600)).toBe(false);
    expect(plausibleClockSeconds(-1, 29_600)).toBe(false);
  });

  it('the listener: a park seats the demand clock on the driven clock, parked frames advance the resume point, an unpark clears frames and resumes (never earlier than the driven clock)', () => {
    const clock = createDrivenClock();
    clock.seconds = 10;
    const state: R3fLoopState = { frameloop: 'demand', clock: { elapsedTime: 0 }, internal: { frames: 0 } };
    onDrivenFrameloopChange(clock, state, 'never', 12_000);
    expect(state.clock.elapsedTime).toBe(10);
    expect(clock.parkedSeconds).toBe(10);
    noteParkedFrame(clock, 10.6, 12_600);
    noteParkedFrame(clock, 9_999, 12_700); // implausible: ignored
    expect(clock.parkedSeconds).toBeCloseTo(10.6, 9);
    state.internal.frames = 2;
    state.frameloop = 'never';
    state.clock.elapsedTime = 0; // setFrameloop's zero
    onDrivenFrameloopChange(clock, state, 'demand', 17_000);
    expect(state.internal.frames).toBe(0);
    expect(state.clock.elapsedTime).toBeCloseTo(10.6, 9);
    expect(clock.seconds).toBeCloseTo(10.6, 9);
    expect(clock.parkedSeconds).toBeNull();
    // Same loop: nothing to do. Outside a park, parked frames are not recorded.
    onDrivenFrameloopChange(clock, state, 'never', 17_100);
    noteParkedFrame(clock, 11, 17_200);
    expect(clock.parkedSeconds).toBeNull();
  });

  it('clearLeftoverFrames touches only a never-root, and the readout reports the driver clock and the guard counters', () => {
    resetFrameCapForTests();
    const demand: R3fLoopState = { frameloop: 'demand', clock: { elapsedTime: 0 }, internal: { frames: 1 } };
    expect(clearLeftoverFrames(demand)).toBe(false);
    expect(demand.internal.frames).toBe(1);
    const never: R3fLoopState = { frameloop: 'never', clock: { elapsedTime: 0 }, internal: { frames: 2 } };
    expect(clearLeftoverFrames(never)).toBe(true);
    expect(never.internal.frames).toBe(0);
    expect(clearLeftoverFrames(never)).toBe(false);
    const clock = createDrivenClock();
    clock.seconds = 3.25;
    clock.reseats = 2;
    noteFrameCapDriver(true, null, clock);
    expect(frameCapReadout()).toMatchObject({ framesCleared: 1, clockReseats: 2, clockSeconds: 3.25 });
  });

  it('FrameCapDriver installs the guard: a store listener mounted for the canvas life, a clear on enable and on every rAF, parked frames noted', () => {
    const canvas = canvasSource();
    expect(canvas).toMatch(/const store = useStore\(\);/);
    expect(canvas).toMatch(/return store\.subscribe\(\(next, previous\) => \{\s*if \(next\.frameloop !== previous\.frameloop\) onDrivenFrameloopChange\(clock, next, previous\.frameloop, performance\.now\(\)\);/);
    expect(canvas).toMatch(/if \(root\.frameloop !== 'never'\) noteParkedFrame\(clock, root\.clock\.elapsedTime, performance\.now\(\)\);/);
    expect(canvas).toMatch(/noteFrameCapDriver\(true, state, clock\);\s*clearLeftoverFrames\(get\(\)\);\s*restartDrivenClock\(clock\);/);
    // The per-rAF clear runs BEFORE the cap's skip decision (skipped rAFs clear too).
    expect(canvas).toMatch(/const root = get\(\);\s*\/\/[^\n]*\n\s*clearLeftoverFrames\(root\);\s*if \(!stepFrameCap\(/);
  });
});
