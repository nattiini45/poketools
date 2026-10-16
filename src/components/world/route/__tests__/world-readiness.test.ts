import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginSceneGeneration,
  currentSceneGeneration,
  getGenerationBegunAt,
  getLastSceneFault,
  getPhaseChangedAt,
  getSceneFailure,
  getScenePhaseTrace,
  getReadyDeadlineMs,
  getScenePhase,
  isReadyDeadlineRelaxed,
  markSceneFailed,
  markScenePresented,
  resetSceneReadiness,
  READY_DEADLINE_RELAX_RANGE,
  resolveReadyDeadline,
  createStallState,
  READINESS_STALL_MS,
  SCENE_READY_TIMEOUT_MS,
  stepStallDetector,
  subscribeScenePhase,
  type ScenePhase,
  type StallState,
} from '../world-readiness';

/**
 * PR #63 review (critical) — the retry/theme-remount race. The provider's
 * (theme, tier) effect and the retry round trip used to bump the generation
 * TWICE for one scene attempt, while the canvas reporter captured its
 * generation number once; the settle callback then refused
 * `markScenePresented()` forever and the 10 s readiness deadline killed a
 * healthy scene with `readiness-timeout`. `beginSceneGeneration(themeKey)` is
 * now idempotent while the same theme is already loading, so one (theme,
 * route-tier) entry is exactly one generation and the reporter's capture
 * stays current.
 */
describe('world-readiness — generation lifecycle', () => {
  beforeEach(() => {
    resetSceneReadiness();
  });

  it('begins a loading generation and reports its number', () => {
    const before = currentSceneGeneration();
    const gen = beginSceneGeneration('plaza');
    expect(gen).toBe(before + 1);
    expect(getScenePhase()).toBe('loading');
  });

  it('skips a redundant begin while the SAME theme is already loading', () => {
    const first = beginSceneGeneration('plaza');
    const second = beginSceneGeneration('plaza');
    expect(second).toBeNull();
    expect(currentSceneGeneration()).toBe(first);
    expect(getScenePhase()).toBe('loading');
  });

  it('bumps for a DIFFERENT theme even mid-load, so an abandoned scene can never present', () => {
    const before = currentSceneGeneration();
    beginSceneGeneration('plaza');
    const sakura = beginSceneGeneration('sakura');
    expect(sakura).toBe(before + 2);
    expect(getScenePhase()).toBe('loading');
    // The plaza generation is gone: the reporter's captured number no longer
    // matches, which is exactly the abandoned-scene guard.
    expect(currentSceneGeneration()).not.toBe(before + 1);
  });

  it('holds ONE generation across the retry round trip (regression: PR #63)', () => {
    // First entry: the provider effect begins the generation.
    beginSceneGeneration('plaza');
    // The scene fails; the degrade flips the tier to Lite and the effect resets.
    markSceneFailed();
    expect(getScenePhase()).toBe('failed');
    resetSceneReadiness();
    expect(getScenePhase()).toBe('idle');

    // Retry: clearing the forced-Lite flag re-enters the route tier and the
    // (theme, tier) effect begins exactly one new generation. The reporter
    // captures the generation at its first painted frame; the OLD retry path's
    // extra synchronous bump used to strand that capture.
    const retried = beginSceneGeneration('plaza');
    expect(retried).not.toBeNull();
    const capturedByReporter = currentSceneGeneration();

    // A second ask inside the same round trip (StrictMode effect replay, a
    // redundant caller) must NOT move the number the reporter holds.
    expect(beginSceneGeneration('plaza')).toBeNull();
    expect(currentSceneGeneration()).toBe(capturedByReporter);

    // The settle window elapses with the capture still current — the healthy
    // scene commits.
    markScenePresented();
    expect(getScenePhase()).toBe('presented');
  });

  it('re-begins after presented and after reset — the dedup only covers the loading window', () => {
    const before = currentSceneGeneration();
    beginSceneGeneration('plaza');
    markScenePresented();

    // Same theme, but nothing is loading: a new entry starts a new generation
    // (soft-navigation re-entry must re-earn `presented`).
    const again = beginSceneGeneration('plaza');
    expect(again).toBe(before + 2);
    expect(getScenePhase()).toBe('loading');

    resetSceneReadiness();
    expect(getScenePhase()).toBe('idle');
    const afterReset = beginSceneGeneration('plaza');
    expect(afterReset).not.toBeNull();
    expect(afterReset).toBe(currentSceneGeneration());
  });

  it('notifies subscribers on phase transitions but not on skipped begins', () => {
    const seen: ScenePhase[] = [];
    const unsubscribe = subscribeScenePhase(() => seen.push(getScenePhase()));
    beginSceneGeneration('plaza');
    beginSceneGeneration('plaza'); // skipped — no transition, no notify
    markScenePresented();
    markScenePresented(); // same phase — no notify
    unsubscribe();
    expect(seen).toEqual(['loading', 'presented']);
  });

  it('notifies on a mid-load DIFFERENT-theme bump — the phase is unchanged but the generation moved', () => {
    // The readiness deadline in WorldStateProvider re-arms on the generation,
    // so this notify is what stops a theme switch from inheriting the
    // abandoned attempt's remaining 10 s budget (PR #63 review). Without it
    // the store stays silent and the old deadline kills the healthy new
    // scene.
    const seen: ScenePhase[] = [];
    const unsubscribe = subscribeScenePhase(() => seen.push(getScenePhase()));
    beginSceneGeneration('plaza');
    beginSceneGeneration('sakura'); // generation bump; phase stays 'loading'
    unsubscribe();
    expect(seen).toEqual(['loading', 'loading']);
  });
});

/**
 * W7 — the loader's reveal gate and trace read these wall-clock stamps. The
 * gate's hard cap is measured from `phaseChangedAt` (presented) and clamped
 * to the readiness deadline measured from `generationBegunAt`.
 */
describe('world-readiness — wall-clock stamps (W7)', () => {
  beforeEach(() => {
    resetSceneReadiness();
  });

  it('stamps the generation start and every phase change', () => {
    const before = performance.now();
    beginSceneGeneration('plaza');
    const begun = getGenerationBegunAt();
    expect(begun).toBeGreaterThanOrEqual(before);
    expect(getPhaseChangedAt()).toBeGreaterThanOrEqual(before);
    markScenePresented();
    expect(getPhaseChangedAt()).toBeGreaterThanOrEqual(begun);
  });

  it('a redundant same-theme begin does not restart the attempt clock', () => {
    beginSceneGeneration('plaza');
    const begun = getGenerationBegunAt();
    beginSceneGeneration('plaza');
    expect(getGenerationBegunAt()).toBe(begun);
  });

  it('the timeout path (tier → Lite → reset) invalidates the attempt without a failed phase', () => {
    // The readiness deadline only forces Lite; the provider's (tier, theme)
    // effect then resets. A late presentation from that attempt can never
    // count: the generation moved and the phase is idle.
    const gen = beginSceneGeneration('plaza')!;
    resetSceneReadiness();
    expect(getScenePhase()).toBe('idle');
    expect(currentSceneGeneration()).toBeGreaterThan(gen);
  });
});

/**
 * Review r2 — the deadline is enforced by WALL CLOCK in the store: a
 * `presented` that lands past `SCENE_READY_TIMEOUT_MS` from the generation's
 * start (e.g. committed inside a long task that pre-empted the provider's
 * timer) is refused and marks the attempt failed (`late-present`), which the
 * provider resolves to Lite `readiness-timeout`.
 */
describe('world-readiness — late presentation (wall-clock deadline)', () => {
  let clock = 0;

  beforeEach(() => {
    vi.restoreAllMocks();
    clock = 50_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    resetSceneReadiness();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a presentation inside the deadline', () => {
    beginSceneGeneration('plaza');
    clock += SCENE_READY_TIMEOUT_MS;
    expect(markScenePresented()).toBe(true);
    expect(getScenePhase()).toBe('presented');
    expect(getSceneFailure()).toBeNull();
  });

  it('refuses a presentation past the deadline and fails the attempt as late-present', () => {
    beginSceneGeneration('plaza');
    const seen: ScenePhase[] = [];
    const unsubscribe = subscribeScenePhase(() => seen.push(getScenePhase()));
    clock += SCENE_READY_TIMEOUT_MS + 1;
    expect(markScenePresented()).toBe(false);
    unsubscribe();
    expect(getScenePhase()).toBe('failed');
    expect(getSceneFailure()).toBe('late-present');
    expect(seen).toEqual(['failed']);
    expect(getPhaseChangedAt()).toBe(clock);
  });

  it('the budget is per generation: a mid-load theme switch gets its own 10 s', () => {
    beginSceneGeneration('plaza');
    clock += 8000;
    beginSceneGeneration('sakura');
    clock += 8000;
    expect(markScenePresented()).toBe(true);
  });

  it('caller-reported failures are tagged `error`, and a new attempt clears the tag', () => {
    beginSceneGeneration('plaza');
    markSceneFailed();
    expect(getSceneFailure()).toBe('error');
    resetSceneReadiness();
    expect(getSceneFailure()).toBeNull();
    beginSceneGeneration('plaza');
    expect(getSceneFailure()).toBeNull();
  });

  // Review r5: a context-loss run read `idle` in the trace (the Lite flip
  // resets the phase inside one task) with no record of why Lite appeared.
  it('records the caller reason as a sticky fault and logs every phase change', () => {
    const gen = beginSceneGeneration('plaza');
    markSceneFailed('context-lost');
    expect(getSceneFailure()).toBe('error');
    resetSceneReadiness();
    expect(getScenePhase()).toBe('idle');
    expect(getLastSceneFault()).toMatchObject({ reason: 'context-lost', generation: gen });
    const tail = getScenePhaseTrace().slice(-3).map((entry) => entry.phase);
    expect(tail).toEqual(['loading', 'failed', 'idle']);
  });
});

/**
 * Review r2 design decision (a) — the DEBUG-ONLY capture relaxation. Non-W7
 * visual evidence may widen the deadline with `?routeDebug=1&readyDeadlineMs=N`
 * (clamped to [10 s, 45 s]) so it is not hostage to `next dev` compile speed.
 * A production build must be exactly the real 10 s deadline whatever the URL.
 */
describe('world-readiness — debug-only deadline relaxation', () => {
  const DEBUG = '?routeDebug=1&readyDeadlineMs=30000';

  it('production ignores the param entirely: always the real 20 s deadline (D23)', () => {
    for (const search of [DEBUG, '?routeDebug=1&readyDeadlineMs=45000', '?readyDeadlineMs=30000', '']) {
      expect(resolveReadyDeadline('production', search)).toEqual({
        deadlineMs: SCENE_READY_TIMEOUT_MS,
        relaxed: false,
      });
    }
    // D23 (complete at reveal): the hard Lite fallback is 20 s.
    expect(SCENE_READY_TIMEOUT_MS).toBe(20_000);
  });

  it('dev honours it only with routeDebug=1', () => {
    expect(resolveReadyDeadline('development', '?readyDeadlineMs=30000').relaxed).toBe(false);
    expect(resolveReadyDeadline('development', '?routeDebug=0&readyDeadlineMs=30000').relaxed).toBe(false);
    expect(resolveReadyDeadline('development', DEBUG)).toEqual({ deadlineMs: 30_000, relaxed: true });
    expect(resolveReadyDeadline(undefined, DEBUG)).toEqual({ deadlineMs: 30_000, relaxed: true });
  });

  it('clamps to [20 s, 45 s] and ignores junk (the relax range never undercuts the product deadline)', () => {
    const at = (value: string) => resolveReadyDeadline('development', `?routeDebug=1&readyDeadlineMs=${value}`);
    expect(at('90000')).toEqual({ deadlineMs: READY_DEADLINE_RELAX_RANGE.maxMs, relaxed: true });
    expect(at('2000')).toEqual({ deadlineMs: SCENE_READY_TIMEOUT_MS, relaxed: false });
    expect(at('10000')).toEqual({ deadlineMs: SCENE_READY_TIMEOUT_MS, relaxed: false });
    expect(at('20000')).toEqual({ deadlineMs: SCENE_READY_TIMEOUT_MS, relaxed: false });
    expect(at('abc')).toEqual({ deadlineMs: SCENE_READY_TIMEOUT_MS, relaxed: false });
    expect(at('')).toEqual({ deadlineMs: SCENE_READY_TIMEOUT_MS, relaxed: false });
    expect(at('Infinity')).toEqual({ deadlineMs: SCENE_READY_TIMEOUT_MS, relaxed: false });
    expect(READY_DEADLINE_RELAX_RANGE).toEqual({ minMs: 20_000, maxMs: 45_000 });
    expect(READY_DEADLINE_RELAX_RANGE.minMs).toBe(SCENE_READY_TIMEOUT_MS);
  });

  describe('store wiring', () => {
    let clock = 0;

    beforeEach(() => {
      clock = 80_000;
      vi.spyOn(performance, 'now').mockImplementation(() => clock);
      vi.stubGlobal('window', { location: { search: DEBUG } });
      resetSceneReadiness();
    });

    afterEach(() => {
      resetSceneReadiness();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    it('a relaxed dev generation accepts a present past 10 s and logs once', () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      beginSceneGeneration('plaza');
      expect(getReadyDeadlineMs()).toBe(30_000);
      expect(isReadyDeadlineRelaxed()).toBe(true);
      clock += 20_000;
      expect(markScenePresented()).toBe(true);
      resetSceneReadiness();
      beginSceneGeneration('plaza');
      const relaxLogs = info.mock.calls.filter(([line]) =>
        String(line).startsWith('[route-readiness] deadline relaxed for capture:'),
      );
      // Once per page life, not once per generation.
      expect(relaxLogs).toEqual([['[route-readiness] deadline relaxed for capture: 30000 ms']]);
      clock += 30_001;
      expect(markScenePresented()).toBe(false);
      expect(getSceneFailure()).toBe('late-present');
    });

    it('production build: the same URL keeps the real 20 s deadline in the store (prod pin)', () => {
      vi.stubEnv('NODE_ENV', 'production');
      beginSceneGeneration('plaza');
      expect(getReadyDeadlineMs()).toBe(SCENE_READY_TIMEOUT_MS);
      expect(isReadyDeadlineRelaxed()).toBe(false);
      clock += SCENE_READY_TIMEOUT_MS + 1;
      expect(markScenePresented()).toBe(false);
      expect(getSceneFailure()).toBe('late-present');
    });
  });
});

/**
 * D23 no-progress stall detector (LOOK-PLAN §2 G1): the pure step. It fires
 * READINESS_STALL_MS (6 s) after the last rise of ANY signal, and never while
 * any signal still moves — slow-but-moving is never a stall.
 */
describe('world-readiness — stall detector (pure step)', () => {
  const step = (state: StallState, nowMs: number, signals?: Record<string, number>) =>
    stepStallDetector(state, { nowMs, signals });

  it('the window is 6 s', () => {
    expect(READINESS_STALL_MS).toBe(6_000);
  });

  it('fires at exactly 6 s with no progress, not a millisecond earlier', () => {
    const start = createStallState(1_000);
    expect(step(start, 1_000 + READINESS_STALL_MS - 1).stalled).toBe(false);
    expect(step(start, 1_000 + READINESS_STALL_MS).stalled).toBe(true);
  });

  it('a signal that does not rise is not progress (a repeat or a dip)', () => {
    let state = step(createStallState(0), 100, { programs: 40 }).state;
    expect(state.lastProgressAt).toBe(100);
    state = step(state, 3_000, { programs: 40 }).state; // repeat
    state = step(state, 4_000, { programs: 12 }).state; // dip (a disposal)
    expect(state.lastProgressAt).toBe(100);
    expect(step(state, 100 + READINESS_STALL_MS).stalled).toBe(true);
  });

  it('never fires while any one signal moves, however slowly (slow-but-moving)', () => {
    let state = createStallState(0);
    // 60 s of load where only the byte counter creeps, every 5.9 s.
    for (let t = 0, bytes = 1; t <= 60_000; t += 5_900, bytes += 1) {
      const result = step(state, t, { bytes, programs: 10, uploads: 3 });
      expect(result.stalled).toBe(false);
      state = result.state;
    }
  });

  it('a new signal seen with a positive value is progress; a zero first sighting is not', () => {
    let state = createStallState(0);
    state = step(state, 2_000, { poses: 0 }).state;
    expect(state.lastProgressAt).toBe(0);
    state = step(state, 2_500, { residency: 1 }).state;
    expect(state.lastProgressAt).toBe(2_500);
  });

  it('returns the same state object when nothing rose (cheap per-frame reads)', () => {
    const state = step(createStallState(0), 10, { items: 3 }).state;
    expect(step(state, 20, { items: 3 }).state).toBe(state);
    expect(step(state, 20).state).toBe(state);
  });

  it('ignores non-finite values', () => {
    const state = createStallState(0);
    expect(step(state, 50, { bytes: Number.NaN }).state).toBe(state);
  });
});
