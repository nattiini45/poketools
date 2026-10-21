import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  beginSceneGeneration,
  currentSceneGeneration,
  markSceneFailed,
  markScenePresented,
  resetSceneReadiness,
} from '../world-readiness';
import {
  abortBallNow,
  ASSET_QUIET_MS,
  CEREMONY_RENDER_HOLD,
  ceremonyRenderHold,
  noteRevealArmed,
  bindProgramsWarmSource,
  getBallPhase,
  getProgramsWarmRelay,
  registerBallAborter,
  subscribeProgramsWarmRelay,
  getSceneProgress,
  hasBallLoader,
  noteBallLoaderMounted,
  noteCanvasMounted,
  noteRendererLive,
  publishBallPhase,
  recordAssetRatio,
  recordSceneMilestone,
  resetSceneProgressForTests,
  scheduleAtWallClock,
  subscribeSceneProgress,
  trackDefaultLoadingManager,
  bindResidencySource,
  getLoadProgressAt,
  getLoadSignals,
  loadStallAt,
  loadStalled,
  noteLoadSignal,
  noteWarmStage,
  getWarmTrace,
  getAttemptLog,
} from '../scene-progress';
import { READINESS_STALL_MS } from '../world-readiness';
import { INITIAL_BALL, stepBall, type BallInput, type BallState } from '@/lib/route-world/ball-loader-state';

/**
 * W7 — the real-progress store the Pokéball wobbles on. Generation-keyed
 * like the readiness store: a late write from an abandoned attempt must never
 * advance the new one, and the snapshot must be `useSyncExternalStore`-stable.
 */
describe('scene-progress — generation-keyed milestones', () => {
  beforeEach(() => {
    resetSceneReadiness();
    resetSceneProgressForTests();
  });

  it('records per-generation events for the live attempt', () => {
    const gen = beginSceneGeneration('plaza')!;
    expect(recordSceneMilestone(gen, 'firstFrame')).toBe(true);
    expect(recordSceneMilestone(gen, 'assets')).toBe(true);
    const snap = getSceneProgress();
    expect(snap.generation).toBe(gen);
    expect(snap.firstFrame).toBe(true);
    expect(snap.assets).toBe(true);
    expect(snap.count).toBe(2);
    expect(snap.at.firstFrame).not.toBeNull();
  });

  it('drops a write carrying a stale generation', () => {
    const stale = beginSceneGeneration('plaza')!;
    beginSceneGeneration('sakura');
    expect(recordSceneMilestone(stale, 'firstFrame')).toBe(false);
    expect(getSceneProgress().firstFrame).toBe(false);
  });

  it('drops writes while no attempt is live (idle or failed)', () => {
    expect(recordSceneMilestone(currentSceneGeneration(), 'assets')).toBe(false);
    const gen = beginSceneGeneration('plaza')!;
    markSceneFailed();
    expect(recordSceneMilestone(gen, 'assets')).toBe(false);
  });

  it('accepts writes after presented (assets can go idle after the first frame settles)', () => {
    const gen = beginSceneGeneration('plaza')!;
    markScenePresented();
    expect(recordSceneMilestone(gen, 'assets')).toBe(true);
  });

  it('a new generation starts from a clean record', () => {
    const gen = beginSceneGeneration('plaza')!;
    recordSceneMilestone(gen, 'firstFrame');
    recordAssetRatio(gen, 3, 4);
    beginSceneGeneration('sakura');
    const snap = getSceneProgress();
    expect(snap.firstFrame).toBe(false);
    expect(snap.assetRatio).toBe(0);
  });

  it('is idempotent per generation', () => {
    const gen = beginSceneGeneration('plaza')!;
    expect(recordSceneMilestone(gen, 'firstFrame')).toBe(true);
    expect(recordSceneMilestone(gen, 'firstFrame')).toBe(false);
  });

  it('keeps the asset ratio monotone as the total grows', () => {
    const gen = beginSceneGeneration('plaza')!;
    recordAssetRatio(gen, 1, 2);
    expect(getSceneProgress().assetRatio).toBe(0.5);
    // A new item joins: 1/3 would regress — ignored.
    expect(recordAssetRatio(gen, 1, 3)).toBe(false);
    expect(getSceneProgress().assetRatio).toBe(0.5);
    recordAssetRatio(gen, 3, 3);
    expect(getSceneProgress().assetRatio).toBe(1);
  });

  it('returns a referentially stable snapshot until something changes', () => {
    beginSceneGeneration('plaza');
    const a = getSceneProgress();
    expect(getSceneProgress()).toBe(a);
    recordSceneMilestone(currentSceneGeneration(), 'firstFrame');
    const b = getSceneProgress();
    expect(b).not.toBe(a);
    expect(getSceneProgress()).toBe(b);
  });

  it('notifies subscribers on writes and on readiness generation changes', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeSceneProgress(onChange);
    const gen = beginSceneGeneration('plaza')!;
    const afterBegin = onChange.mock.calls.length;
    expect(afterBegin).toBeGreaterThan(0);
    recordSceneMilestone(gen, 'firstFrame');
    expect(onChange.mock.calls.length).toBeGreaterThan(afterBegin);
    unsubscribe();
  });
});

describe('scene-progress — canvas/renderer presence (M1/M2)', () => {
  beforeEach(() => {
    resetSceneReadiness();
    resetSceneProgressForTests();
  });

  it('survives the cached-chunk race: a canvas mounted BEFORE the generation begins still counts', () => {
    // Retry with a cached chunk: the canvas mount effect runs before the
    // provider's passive effect begins the generation.
    const releaseCanvas = noteCanvasMounted();
    beginSceneGeneration('plaza');
    const snap = getSceneProgress();
    expect(snap.chunk).toBe(true);
    expect(snap.count).toBe(1);
    releaseCanvas();
    expect(getSceneProgress().chunk).toBe(false);
  });

  it('counts the renderer while it lives and releases idempotently', () => {
    beginSceneGeneration('plaza');
    const release = noteRendererLive();
    expect(getSceneProgress().renderer).toBe(true);
    release();
    release();
    expect(getSceneProgress().renderer).toBe(false);
  });
});

describe('scene-progress — default loading manager bridge (M3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSceneReadiness();
    resetSceneProgressForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('chains and restores the previous handlers', () => {
    const manager = THREE.DefaultLoadingManager;
    const prevLoad = vi.fn();
    const originalLoad = manager.onLoad;
    manager.onLoad = prevLoad;
    const release = trackDefaultLoadingManager();
    beginSceneGeneration('plaza');
    manager.onLoad();
    expect(prevLoad).toHaveBeenCalledTimes(1);
    expect(getSceneProgress().assets).toBe(true);
    release();
    expect(manager.onLoad).toBe(prevLoad);
    manager.onLoad = originalLoad;
  });

  it('reports assets idle when no load starts within the quiet window', () => {
    const release = trackDefaultLoadingManager();
    beginSceneGeneration('plaza');
    vi.advanceTimersByTime(ASSET_QUIET_MS - 1);
    expect(getSceneProgress().assets).toBe(false);
    vi.advanceTimersByTime(1);
    expect(getSceneProgress().assets).toBe(true);
    release();
  });

  it('does not close the quiet window while loads are active', () => {
    const release = trackDefaultLoadingManager();
    beginSceneGeneration('plaza');
    THREE.DefaultLoadingManager.onStart?.('a.glb', 0, 2);
    vi.advanceTimersByTime(ASSET_QUIET_MS * 3);
    expect(getSceneProgress().assets).toBe(false);
    THREE.DefaultLoadingManager.onProgress?.('a.glb', 1, 2);
    expect(getSceneProgress().assetRatio).toBe(0.5);
    release();
  });

  it('a released bridge writes nothing (its quiet timer is cleared)', () => {
    const release = trackDefaultLoadingManager();
    beginSceneGeneration('plaza');
    release();
    vi.advanceTimersByTime(ASSET_QUIET_MS * 2);
    expect(getSceneProgress().assets).toBe(false);
  });
});

describe('scene-progress — ball presence and trace', () => {
  beforeEach(() => {
    resetSceneProgressForTests();
  });

  it('tracks a mounted loader and resets the trace phase when the last one leaves', () => {
    expect(hasBallLoader()).toBe(false);
    const release = noteBallLoaderMounted();
    publishBallPhase('loading');
    expect(hasBallLoader()).toBe(true);
    expect(getBallPhase()).toBe('loading');
    release();
    expect(hasBallLoader()).toBe(false);
    expect(getBallPhase()).toBe('hidden');
  });
});

describe('scene-progress — scheduleAtWallClock (review r4: 30 s releasing ball)', () => {
  let clock = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;

  beforeEach(() => {
    clock = 1000;
    timers = [];
    nextId = 1;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    // A browser-like timer that fires up to 1 ms EARLY against performance.now()
    // (fractional delays are truncated) and no rAF at all (a stalled frame
    // clock) — the worst case the ball's wake has to survive.
    vi.stubGlobal('window', {
      setTimeout: (fn: () => void, delay: number) => {
        const id = nextId++;
        timers.push({ at: clock + Math.max(0, Math.trunc(delay)), fn, id });
        return id;
      },
      clearTimeout: (id: number) => {
        timers = timers.filter((timer) => timer.id !== id);
      },
      requestAnimationFrame: () => 0,
      cancelAnimationFrame: () => {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function runTimers(until: number): void {
    for (let guard = 0; guard < 100; guard += 1) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (next === undefined || next.at > until) return;
      timers.shift();
      clock = next.at;
      next.fn();
    }
  }

  it('never runs fn before the target, and still runs it when the timer lands early', () => {
    const seen: number[] = [];
    scheduleAtWallClock(1819.6, () => seen.push(clock));
    runTimers(5000);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThanOrEqual(1819.6);
    expect(seen[0]).toBeLessThanOrEqual(1819.6 + 3);
  });

  it('cancel stops a re-armed wake', () => {
    const seen: number[] = [];
    const cancel = scheduleAtWallClock(1500, () => seen.push(clock));
    runTimers(1499);
    cancel();
    runTimers(5000);
    expect(seen).toHaveLength(0);
  });
});

describe('scene-progress — review r5 relays', () => {
  it('relays the canvas programs-warm source to the provider and forgets it on unbind', () => {
    let warm = false;
    const sourceListeners = new Set<() => void>();
    const seen: boolean[] = [];
    const off = subscribeProgramsWarmRelay(() => seen.push(getProgramsWarmRelay()));
    expect(getProgramsWarmRelay()).toBe(false);
    const unbind = bindProgramsWarmSource({
      get: () => warm,
      subscribe: (listener) => {
        sourceListeners.add(listener);
        return () => sourceListeners.delete(listener);
      },
    });
    warm = true;
    for (const listener of sourceListeners) listener();
    expect(getProgramsWarmRelay()).toBe(true);
    unbind();
    expect(getProgramsWarmRelay()).toBe(false);
    expect(sourceListeners.size).toBe(0);
    expect(seen).toEqual([false, true, false]);
    off();
  });

  it('abortBallNow runs the registered loader aborter, and is a no-op once released', () => {
    let calls = 0;
    const release = registerBallAborter(() => {
      calls += 1;
    });
    abortBallNow();
    expect(calls).toBe(1);
    release();
    abortBallNow();
    expect(calls).toBe(1);
  });
});

describe('scene-progress — ceremony render hold (wave-2 r2)', () => {
  let clock = 0;
  beforeEach(() => {
    clock = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    resetSceneReadiness();
    resetSceneProgressForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('holds from the arm through the ceremony and releases shortly after done', () => {
    const release = noteBallLoaderMounted();
    beginSceneGeneration('plaza');
    publishBallPhase('loading');
    expect(ceremonyRenderHold(clock)).toBe(false);
    noteRevealArmed(currentSceneGeneration(), clock);
    expect(ceremonyRenderHold(clock)).toBe(true);
    clock += 100;
    publishBallPhase('opening');
    expect(ceremonyRenderHold(clock)).toBe(true);
    clock += 240;
    publishBallPhase('releasing');
    expect(ceremonyRenderHold(clock)).toBe(true);
    clock += 820;
    publishBallPhase('done');
    expect(ceremonyRenderHold(clock + CEREMONY_RENDER_HOLD.releaseAfterDoneMs - 1)).toBe(true);
    expect(ceremonyRenderHold(clock + CEREMONY_RENDER_HOLD.releaseAfterDoneMs)).toBe(false);
    release();
  });

  it('never holds past the hard bound, for a stale generation, on abort or without a loader', () => {
    beginSceneGeneration('plaza');
    noteRevealArmed(currentSceneGeneration(), clock);
    expect(ceremonyRenderHold(clock)).toBe(false); // no loader mounted
    const release = noteBallLoaderMounted();
    publishBallPhase('releasing');
    expect(ceremonyRenderHold(clock + CEREMONY_RENDER_HOLD.maxMs + 1)).toBe(false);
    publishBallPhase('aborted');
    expect(ceremonyRenderHold(clock)).toBe(false);
    publishBallPhase('opening');
    beginSceneGeneration('sakura');
    expect(ceremonyRenderHold(clock)).toBe(false);
    release();
  });
});

/**
 * D23 (LOOK-PLAN §2 G6, honest ceremony): two REAL milestones join the four
 * — `compiled` (every program incl. shadow and pass variants linked) and
 * `uploaded` (textures + pose renders) — each stamped, each exactly one
 * wobble; no timer ever shakes the ball.
 */
describe('scene-progress — D23 milestones (compiled, uploaded) and wobble parity', () => {
  let clock = 0;

  beforeEach(() => {
    clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    resetSceneReadiness();
    resetSceneProgressForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records compiled and uploaded per generation, stamped, counted (0..6)', () => {
    const gen = beginSceneGeneration('plaza')!;
    const releaseCanvas = noteCanvasMounted();
    const releaseRenderer = noteRendererLive();
    clock = 1500;
    recordSceneMilestone(gen, 'assets');
    clock = 4200;
    expect(recordSceneMilestone(gen, 'compiled')).toBe(true);
    clock = 6100;
    expect(recordSceneMilestone(gen, 'uploaded')).toBe(true);
    clock = 6300;
    recordSceneMilestone(gen, 'firstFrame');
    const snap = getSceneProgress();
    expect(snap.compiled).toBe(true);
    expect(snap.uploaded).toBe(true);
    expect(snap.count).toBe(6);
    // The stamps are the trace: a long gap (assets → compiled) is visible.
    expect(snap.at.compiled).toBe(4200);
    expect(snap.at.uploaded).toBe(6100);
    expect((snap.at.compiled ?? 0) - (snap.at.assets ?? 0)).toBe(2700);
    // Idempotent and generation-keyed like the others.
    expect(recordSceneMilestone(gen, 'compiled')).toBe(false);
    beginSceneGeneration('sakura');
    expect(recordSceneMilestone(gen, 'uploaded')).toBe(false);
    expect(getSceneProgress().compiled).toBe(false);
    releaseCanvas();
    releaseRenderer();
  });

  it('wobble parity: the ball shakes exactly once per milestone rise, in any order and in bursts', () => {
    const gen = beginSceneGeneration('plaza')!;
    const base: Omit<BallInput, 'nowMs' | 'milestones'> = {
      active: true,
      armed: false,
      armedAtMs: null,
      phase: 'loading',
      generation: gen,
      begunAtMs: 1000,
      reducedMotion: false,
    };
    let ball: BallState = stepBall(INITIAL_BALL, { ...base, nowMs: 1000, milestones: getSceneProgress().count });
    let rises = 0;
    let last = getSceneProgress().count;
    const step = () => {
      clock += 50;
      const count = getSceneProgress().count;
      if (count > last) rises += count - last;
      last = count;
      ball = stepBall(ball, { ...base, nowMs: clock, milestones: count });
    };
    const releaseCanvas = noteCanvasMounted();
    step();
    const releaseRenderer = noteRendererLive();
    step();
    recordSceneMilestone(gen, 'assets');
    step();
    // A burst: compiled and uploaded land in the same step — two rises, two wobbles.
    recordSceneMilestone(gen, 'compiled');
    recordSceneMilestone(gen, 'uploaded');
    step();
    recordSceneMilestone(gen, 'firstFrame');
    step();
    // Nothing rose: no wobble (no timer shakes).
    step();
    step();
    expect(rises).toBe(6);
    expect(ball.shakes).toBe(rises);
    releaseCanvas();
    releaseRenderer();
  });
});

describe('scene-progress — residency relay and stall signals (D23)', () => {
  let clock = 0;

  beforeEach(() => {
    clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    resetSceneReadiness();
    resetSceneProgressForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('relays the canvas-bound residency source into the snapshot (unbound = not resident)', () => {
    const gen = beginSceneGeneration('plaza')!;
    expect(getSceneProgress().resident).toBe(false);
    let complete = false;
    const listeners = new Set<() => void>();
    const unbind = bindResidencySource({
      complete: (generation) => complete && generation === gen,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    expect(getSceneProgress().resident).toBe(false);
    complete = true;
    for (const listener of listeners) listener();
    expect(getSceneProgress().resident).toBe(true);
    unbind();
    expect(listeners.size).toBe(0);
    expect(getSceneProgress().resident).toBe(false);
  });

  it('the stall window opens no earlier than the renderer and moves with any rising signal', () => {
    const gen = beginSceneGeneration('plaza')!;
    noteLoadSignal(gen, 'bytes', 100);
    expect(loadStallAt()).toBeNull(); // no renderer yet: only the deadline applies
    clock = 2000;
    const releaseRenderer = noteRendererLive();
    expect(getLoadProgressAt()).toBe(2000);
    expect(loadStallAt()).toBe(2000 + READINESS_STALL_MS);
    clock = 5000;
    noteLoadSignal(gen, 'programs', 12);
    expect(loadStallAt()).toBe(5000 + READINESS_STALL_MS);
    clock = 7000;
    noteLoadSignal(gen, 'programs', 12); // no rise: not progress
    expect(loadStallAt()).toBe(5000 + READINESS_STALL_MS);
    expect(loadStalled(5000 + READINESS_STALL_MS - 1)).toBe(false);
    expect(loadStalled(5000 + READINESS_STALL_MS)).toBe(true);
    expect(getLoadSignals()).toMatchObject({ bytes: 100, programs: 12 });
    // A stale generation's signal never moves the live window.
    beginSceneGeneration('sakura');
    clock = 9000;
    noteLoadSignal(gen, 'programs', 99);
    expect(getLoadSignals().programs).toBeUndefined();
    releaseRenderer();
  });

  it('milestone rises are progress for the stall detector', () => {
    const gen = beginSceneGeneration('plaza')!;
    const releaseRenderer = noteRendererLive();
    clock = 4000;
    recordSceneMilestone(gen, 'compiled');
    expect(getLoadProgressAt()).toBe(4000);
    releaseRenderer();
  });

  it('ENGINE r2: only work-completion signals are progress (sakura r1: rising `variants` hid a 12 s stall)', () => {
    const gen = beginSceneGeneration('sakura')!;
    const releaseRenderer = noteRendererLive();
    clock = 2000;
    noteLoadSignal(gen, 'bytes', 100);
    // Assets done, residency stuck, the warm keeps minting compile requests
    // and re-announcing presence: none of it is progress.
    for (let t = 2100; t <= 2000 + READINESS_STALL_MS; t += 100) {
      clock = t;
      noteLoadSignal(gen, 'variants', t);
      noteLoadSignal(gen, 'canvas', 1);
      noteLoadSignal(gen, 'renderer', 1);
      noteLoadSignal(gen, 'bytes', 100);
    }
    expect(loadStallAt()).toBe(2000 + READINESS_STALL_MS);
    expect(loadStalled(clock)).toBe(true);
    expect(getLoadSignals().variants).toBeUndefined();
    releaseRenderer();
  });

  it('ENGINE r2: a failed attempt keeps its final milestones, signals and warm stages in the attempt log', () => {
    const gen = beginSceneGeneration('mountain')!;
    const releaseRenderer = noteRendererLive();
    clock = 2500;
    recordSceneMilestone(gen, 'assets');
    noteLoadSignal(gen, 'items', 40);
    noteWarmStage(gen, 'compile', 3);
    clock = 9000;
    markSceneFailed('readiness-stall');
    resetSceneReadiness(); // the Lite flip: a fresh generation
    const log = getAttemptLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ generation: gen, end: 'failed', at: 9000 });
    expect(log[0].milestones.assets).toBe(2500);
    expect(log[0].signals).toMatchObject({ items: 40 });
    expect(log[0].stallAt).toBe(2500 + READINESS_STALL_MS);
    expect(log[0].warmStages.map((w) => w.stage)).toEqual(['compile']);
    releaseRenderer();
  });

  it('ENGINE r2: the residency relay notifies only when completion flips', () => {
    const gen = beginSceneGeneration('plaza')!;
    let complete = false;
    const listeners = new Set<() => void>();
    bindResidencySource({
      complete: (generation) => complete && generation === gen,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    let notified = 0;
    const unsubscribe = subscribeSceneProgress(() => {
      notified += 1;
    });
    for (let i = 0; i < 5; i += 1) for (const listener of listeners) listener();
    expect(notified).toBe(0);
    complete = true;
    clock = 4200;
    for (const listener of listeners) listener();
    for (const listener of listeners) listener();
    expect(notified).toBe(1);
    expect(getSceneProgress().residentAt).toBe(4200);
    unsubscribe();
  });

  it('keeps a bounded, stamped warm-stage trace', () => {
    const gen = beginSceneGeneration('plaza')!;
    clock = 3000;
    noteWarmStage(gen, 'compile', 10);
    clock = 5500;
    noteWarmStage(gen, 'shadows', 80);
    const trace = getWarmTrace();
    expect(trace.map((entry) => [entry.stage, entry.t, entry.programs])).toEqual([
      ['compile', 3000, 10],
      ['shadows', 5500, 80],
    ]);
  });
});
