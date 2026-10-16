import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  advanceSmooth,
  beginSkipThrough,
  endSkipThrough,
  NO_SKIP,
  SKIP_APPROACH,
  SKIP_MAX_S,
  skipThroughOf,
  type RouteProgress,
} from '../useScrollConductor';
import {
  enqueueWindowLatch,
  initSkipGate,
  queuedWindowLatches,
  resetWindowLatchQueueForTests,
  skipGateOpen,
  skipWindowRole,
  stepSkipGate,
  type SkipGateState,
} from '../useStationWarmup';

/**
 * D23 (complete at reveal) note, seat R: the station-window hooks
 * (`useStationWindow`, `use{Sakura,Mountain,Clouds}StationWindow`) no longer
 * use the skip-through gate — every window is resident from load, so a
 * skip-through has nothing left to mount (the W6 residual is absorbed; the
 * D23 source scan lives in `src/lib/route-world/__tests__/residency.test.ts`).
 * What remains below is a unit test of the gate's pure exports in
 * `useStationWarmup.ts`; retire this file together with those exports when
 * ENGINE-GATE deletes them.
 *
 * Wave 2, W6 residual 1: the plaza pulse → schedule chip jump froze
 * 250–267 ms mid-skip because the roster/teams windows it only skims past
 * latched (and mounted) in the jump's first commit. While a skip-through is
 * in flight only the target's windows latch — as the jump approaches, one per
 * slice — and the passed stations' windows stay closed through the landing.
 */

function progressAt(exact: number, smooth: number): RouteProgress {
  return {
    exact,
    smooth,
    index: Math.floor(exact),
    localT: exact - Math.floor(exact),
    direction: 0,
    velocity: 0,
    pin: null,
    nearest: Math.round(exact),
    jump: { token: 0, from: 0, to: 0 },
    lastSampleKind: 'travel',
    mapVersion: 1,
    sampleScrollY: 0,
    settleToken: 0,
  };
}

/** One residency window as the hooks drive it: `[from, to]`, gated by `windowStation`. */
interface SimWindow {
  name: string;
  from: number;
  to: number;
  windowStation: number;
  latched: boolean;
  latchedAtFrame: number | null;
  gate: SkipGateState;
}

function simWindow(name: string, from: number, to: number, windowStation: number, latched = false): SimWindow {
  return { name, from, to, windowStation, latched, latchedAtFrame: null, gate: initSkipGate(NO_SKIP) };
}

/**
 * Drive the windows for one frame the way the hooks do: step the gate, latch
 * an entered window whose gate is open, and grant at most ONE queued window
 * per frame (the shared latch queue's contract).
 */
function stepWindows(windows: SimWindow[], progress: RouteProgress, frame: number): void {
  const skip = skipThroughOf(progress);
  const station = progress.nearest;
  let granted = false;
  for (const w of windows) {
    const want = station >= w.from && station <= w.to;
    w.gate = stepSkipGate(w.gate, { skip, want, done: w.latched, station, windowStation: w.windowStation });
    if (w.gate.mode === 'queued' && !granted) {
      w.gate = { ...w.gate, mode: 'free' };
      granted = true;
    }
    if (want && skipGateOpen(w.gate) && !w.latched) {
      w.latched = true;
      w.latchedAtFrame = frame;
    }
  }
}

/** The plaza windows (station = from + 1) plus the sakura figure groups (station = from). */
function pulseWindows(): SimWindow[] {
  return [
    simWindow('plaza aces [1,3] (teams content)', 1, 3, 2),
    simWindow('plaza kiosk [2,4] (schedule content)', 2, 4, 3),
    simWindow('sakura pulse group (0,4)', 0, 4, 0, true),
    simWindow('sakura roster group (1,4)', 1, 4, 1),
    simWindow('sakura teams group (2,4)', 2, 4, 2),
    simWindow('sakura schedule group (3,4)', 3, 4, 3),
  ];
}

/** A chip jump pulse (0) → schedule (3): `exact` and the nearest latch land at once. */
function chipJump(progress: RouteProgress, to: number): void {
  progress.jump = { token: progress.jump.token + 1, from: progress.smooth, to };
  beginSkipThrough(progress, progress.jump.token, progress.smooth, to);
  progress.exact = to;
  progress.index = to;
  progress.localT = 0;
  progress.nearest = to;
  progress.direction = 1;
}

const byName = (windows: SimWindow[], prefix: string) => windows.find((w) => w.name.startsWith(prefix))!;

describe('skip-through lifecycle (conductor)', () => {
  it('approaches at SKIP_APPROACH of the span and lands in the land band', () => {
    const progress = progressAt(0, 0);
    chipJump(progress, 3);
    const first = skipThroughOf(progress);
    expect(first.active).toBe(true);
    let approachSmooth: number | null = null;
    for (let i = 0; i < 240 && skipThroughOf(progress).active; i += 1) {
      advanceSmooth(progress, 1 / 60);
      if (approachSmooth === null && skipThroughOf(progress).approaching) approachSmooth = progress.smooth;
    }
    expect(approachSmooth).not.toBeNull();
    expect(approachSmooth!).toBeGreaterThanOrEqual(3 * SKIP_APPROACH);
    expect(approachSmooth!).toBeLessThan(3 * SKIP_APPROACH + 0.2);
    const landed = skipThroughOf(progress);
    expect(landed.active).toBe(false);
    expect(landed.end).toBe('landed');
  });

  it('the same record is kept while only the clock moves (no per-frame re-render)', () => {
    const progress = progressAt(0, 0);
    chipJump(progress, 3);
    const before = skipThroughOf(progress);
    advanceSmooth(progress, 1 / 120);
    expect(skipThroughOf(progress)).toBe(before);
  });

  it('a stalled flight times out instead of holding the windows forever', () => {
    const progress = progressAt(0, 0);
    chipJump(progress, 4);
    // 2 fps: the follower's dt clamp crawls, the wall clock does not.
    for (let t = 0; t <= SKIP_MAX_S + 0.5 && skipThroughOf(progress).active; t += 0.5) advanceSmooth(progress, 0.5);
    expect(skipThroughOf(progress).end).toBe('timeout');
  });

  it('endSkipThrough releases only a skip in flight', () => {
    const progress = progressAt(0, 0);
    expect(endSkipThrough(progress, 'input')).toBe(false);
    chipJump(progress, 3);
    expect(endSkipThrough(progress, 'input')).toBe(true);
    expect(skipThroughOf(progress).end).toBe('input');
    expect(endSkipThrough(progress, 'input')).toBe(false);
  });
});

describe('skipWindowRole', () => {
  it('names target, passed and other stations for both directions', () => {
    expect(skipWindowRole(0, 3, 3)).toBe('target');
    expect(skipWindowRole(0, 3, 1)).toBe('passed');
    expect(skipWindowRole(0, 3, 2)).toBe('passed');
    expect(skipWindowRole(0, 3, 4)).toBe('other');
    expect(skipWindowRole(0, 3, 0)).toBe('other');
    // rules → roster, upward
    expect(skipWindowRole(4, 1, 1)).toBe('target');
    expect(skipWindowRole(4, 1, 3)).toBe('passed');
    expect(skipWindowRole(4, 1, 2)).toBe('passed');
    expect(skipWindowRole(4, 1, 0)).toBe('other');
    // A re-aim from mid-flight rounds the start.
    expect(skipWindowRole(1.4, 3, 2)).toBe('passed');
  });
});

describe('pulse → schedule chip jump (the r5 freeze)', () => {
  it('never latches the roster/teams windows during the jump or at its landing', () => {
    const progress = progressAt(0, 0);
    const windows = pulseWindows();
    stepWindows(windows, progress, 0);
    chipJump(progress, 3);

    let frame = 1;
    const latchesPerFrame = new Map<number, number>();
    let approachFrame: number | null = null;
    let landFrame: number | null = null;
    // Fly, land, then 30 more frames at rest (well under the rest latch).
    for (; frame < 400; frame += 1) {
      advanceSmooth(progress, 1 / 60);
      const skip = skipThroughOf(progress);
      if (approachFrame === null && skip.approaching) approachFrame = frame;
      if (landFrame === null && !skip.active) landFrame = frame;
      const before = windows.filter((w) => w.latched).length;
      stepWindows(windows, progress, frame);
      const after = windows.filter((w) => w.latched).length;
      if (after > before) latchesPerFrame.set(frame, after - before);
      if (landFrame !== null && frame > landFrame + 30) break;
    }
    expect(approachFrame).not.toBeNull();
    expect(landFrame).not.toBeNull();

    for (const prefix of ['plaza aces', 'sakura roster', 'sakura teams']) {
      const w = byName(windows, prefix);
      expect(w.latched, `${w.name} latched`).toBe(false);
      expect(w.gate.mode).toBe('passed');
    }
    // The target's windows latch — on the approach, not at the click.
    for (const prefix of ['plaza kiosk', 'sakura schedule']) {
      const w = byName(windows, prefix);
      expect(w.latched, `${w.name} latched`).toBe(true);
      expect(w.latchedAtFrame!).toBeGreaterThanOrEqual(approachFrame!);
    }
    // Staggered: never two latches in one frame.
    for (const count of latchesPerFrame.values()) expect(count).toBe(1);
  });

  it('the skipped windows resume normally once the visitor moves on (no burst)', () => {
    const progress = progressAt(0, 0);
    const windows = pulseWindows();
    stepWindows(windows, progress, 0);
    chipJump(progress, 3);
    let frame = 1;
    for (; frame < 400 && skipThroughOf(progress).active; frame += 1) {
      advanceSmooth(progress, 1 / 60);
      stepWindows(windows, progress, frame);
    }
    for (let i = 0; i < 10; i += 1, frame += 1) stepWindows(windows, progress, frame);
    expect(byName(windows, 'plaza aces').latched).toBe(false);

    // The visitor scrolls back up to teams: normal entry latching.
    progress.exact = 2;
    progress.nearest = 2;
    progress.direction = -1;
    const latchesPerFrame: number[] = [];
    for (let i = 0; i < 6; i += 1, frame += 1) {
      const before = windows.filter((w) => w.latched).length;
      stepWindows(windows, progress, frame);
      latchesPerFrame.push(windows.filter((w) => w.latched).length - before);
    }
    expect(byName(windows, 'plaza aces').latched).toBe(true);
    expect(byName(windows, 'sakura teams').latched).toBe(true);
    expect(byName(windows, 'sakura roster').latched).toBe(true);
    // Three skipped windows resume on one station change — one per frame.
    expect(Math.max(...latchesPerFrame)).toBe(1);
  });

  it('a user interruption mid-skip resumes normal latching, one window per frame', () => {
    const progress = progressAt(0, 0);
    const windows = pulseWindows();
    stepWindows(windows, progress, 0);
    chipJump(progress, 3);
    let frame = 1;
    // Fly a little (well before the approach), then the visitor wheels.
    for (; frame < 6; frame += 1) {
      advanceSmooth(progress, 1 / 60);
      stepWindows(windows, progress, frame);
    }
    expect(skipThroughOf(progress).approaching).toBe(false);
    expect(windows.filter((w) => w.latched).map((w) => w.name)).toEqual(['sakura pulse group (0,4)']);

    expect(endSkipThrough(progress, 'input')).toBe(true);
    const latchesPerFrame: number[] = [];
    for (let i = 0; i < 20; i += 1, frame += 1) {
      advanceSmooth(progress, 1 / 60);
      const before = windows.filter((w) => w.latched).length;
      stepWindows(windows, progress, frame);
      latchesPerFrame.push(windows.filter((w) => w.latched).length - before);
    }
    // Every window containing the visitor's station latches — the camera now
    // flies the real path through roster and teams — but never two at once.
    expect(windows.every((w) => w.latched)).toBe(true);
    expect(Math.max(...latchesPerFrame)).toBe(1);
    for (const w of windows) expect(w.gate.mode).toBe('free');
  });

  it('a second chip click re-aims: the new jump re-classifies every window', () => {
    const progress = progressAt(0, 0);
    const windows = pulseWindows();
    stepWindows(windows, progress, 0);
    chipJump(progress, 3);
    advanceSmooth(progress, 1 / 60);
    stepWindows(windows, progress, 1);
    // Re-aim to teams (2) from mid-flight: teams is now the target.
    chipJump(progress, 2);
    stepWindows(windows, progress, 2);
    expect(byName(windows, 'sakura teams').gate.mode).toBe('target');
    expect(byName(windows, 'plaza aces').gate.mode).toBe('target');
    expect(byName(windows, 'sakura roster').gate.mode).toBe('passed');
    // The kiosk is a prefetch window beyond the target: held, not latched.
    expect(byName(windows, 'plaza kiosk').gate.mode).toBe('held');
  });

  it('a window already resident is never gated', () => {
    const state = stepSkipGate(initSkipGate(NO_SKIP), {
      skip: { token: 1, active: true, approaching: false, from: 0, to: 3, end: null },
      want: true,
      done: true,
      station: 3,
      windowStation: 2,
    });
    expect(skipGateOpen(state)).toBe(true);
  });

  it('the gate step is idempotent (safe to derive during render)', () => {
    const skip = { token: 1, active: true, approaching: false, from: 0, to: 3, end: null } as const;
    const input = { skip, want: true, done: false, station: 3, windowStation: 2 };
    const once = stepSkipGate(initSkipGate(NO_SKIP), input);
    expect(stepSkipGate(once, input)).toBe(once);
    const landed = { ...input, skip: { ...skip, active: false, end: 'landed' as const } };
    const after = stepSkipGate(once, landed);
    expect(stepSkipGate(after, landed)).toBe(after);
  });
});

describe('shared window latch queue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback) => globalThis.setTimeout(() => callback(0), 16),
    });
    resetWindowLatchQueueForTests();
  });
  afterEach(() => {
    resetWindowLatchQueueForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('grants one window per slice, a frame apart, and honours a cancel', () => {
    const granted: string[] = [];
    enqueueWindowLatch(() => granted.push('a'));
    const cancelB = enqueueWindowLatch(() => granted.push('b'));
    enqueueWindowLatch(() => granted.push('c'));
    cancelB();
    expect(queuedWindowLatches()).toBe(2);
    vi.advanceTimersByTime(16);
    expect(granted).toEqual(['a']);
    // The next grant waits for a frame, then its own idle slice.
    vi.advanceTimersByTime(16);
    expect(granted).toEqual(['a']);
    vi.advanceTimersByTime(16);
    expect(granted).toEqual(['a', 'c']);
    expect(queuedWindowLatches()).toBe(0);
  });
});
