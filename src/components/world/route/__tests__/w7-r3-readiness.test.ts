import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATTEMPT_CHAIN_MS,
  beginSceneGeneration,
  currentSceneGeneration,
  getGenerationBegunAt,
  getPhaseChangedAt,
  markScenePresented,
  resetSceneReadiness,
} from '../world-readiness';
import {
  getRenderedFrames,
  getSceneProgress,
  noteCanvasMounted,
  noteRenderedFrame,
  noteRendererLive,
  recordSceneMilestone,
  resetSceneProgressForTests,
} from '../scene-progress';

/**
 * Review r3 (W7) — the readiness side of the round-3 fixes:
 * - the visitor anchor: a StrictMode / remount re-begin continues the
 *   attempt clock the visitor has been watching, so the product deadline and
 *   the ball's lifetime agree with what was on screen;
 * - M4 (first frame) can never trail `presented`;
 * - the renderer frame counter the two-phase handoff waits on.
 */
describe('world-readiness — visitor anchor (unmount-chained re-begin)', () => {
  let clock = 0;

  beforeEach(() => {
    vi.restoreAllMocks();
    clock = 80_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    resetSceneReadiness();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a StrictMode unmount reset + immediate re-begin keeps the FIRST start', () => {
    beginSceneGeneration('plaza');
    const first = getGenerationBegunAt();
    clock += 19;
    resetSceneReadiness('unmount');
    clock += 1;
    beginSceneGeneration('plaza');
    expect(getGenerationBegunAt()).toBe(first);
  });

  it('chains across repeated unmount/re-begin pairs inside the window', () => {
    beginSceneGeneration('plaza');
    const first = getGenerationBegunAt();
    for (let i = 0; i < 3; i += 1) {
      clock += 30;
      resetSceneReadiness('unmount');
      beginSceneGeneration('plaza');
    }
    expect(getGenerationBegunAt()).toBe(first);
  });

  it('never chains past the window, after a tier/theme reset, or across a finished attempt', () => {
    beginSceneGeneration('plaza');
    clock += 10;
    resetSceneReadiness('unmount');
    clock += ATTEMPT_CHAIN_MS + 1;
    beginSceneGeneration('plaza');
    expect(getGenerationBegunAt()).toBe(clock);

    clock += 10;
    resetSceneReadiness();
    clock += 1;
    beginSceneGeneration('plaza');
    expect(getGenerationBegunAt()).toBe(clock);

    markScenePresented();
    clock += 10;
    resetSceneReadiness('unmount');
    clock += 1;
    beginSceneGeneration('plaza');
    expect(getGenerationBegunAt()).toBe(clock);
  });

  it('a mid-load theme switch still gets its own fresh budget', () => {
    beginSceneGeneration('plaza');
    clock += 500;
    beginSceneGeneration('sakura');
    expect(getGenerationBegunAt()).toBe(clock);
  });
});

describe('scene-progress — M4 never trails presented; renderer frame counter', () => {
  beforeEach(() => {
    resetSceneReadiness();
    resetSceneProgressForTests();
  });

  it('a presented generation reports firstFrame, stamped at the presentation, without the event write', () => {
    const releaseCanvas = noteCanvasMounted();
    const releaseRenderer = noteRendererLive();
    beginSceneGeneration('plaza');
    expect(getSceneProgress().firstFrame).toBe(false);
    expect(getSceneProgress().count).toBe(2);
    markScenePresented();
    const snap = getSceneProgress();
    expect(snap.firstFrame).toBe(true);
    expect(snap.count).toBe(3);
    expect(snap.at.firstFrame).toBe(getPhaseChangedAt());
    // Stable snapshot while nothing changes (useSyncExternalStore).
    expect(getSceneProgress()).toBe(snap);
    releaseRenderer();
    releaseCanvas();
  });

  it('a drawn-frame record landing AFTER presented never moves the M4 stamp later (wave-2 r2)', () => {
    let clock = 50_000;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const releaseCanvas = noteCanvasMounted();
    const releaseRenderer = noteRendererLive();
    beginSceneGeneration('plaza');
    const gen = currentSceneGeneration();
    clock += 3000;
    markScenePresented();
    const presentedAt = getPhaseChangedAt();
    expect(getSceneProgress().at.firstFrame).toBe(presentedAt);
    clock += 744;
    recordSceneMilestone(gen, 'firstFrame');
    expect(getSceneProgress().at.firstFrame).toBe(presentedAt);
    releaseRenderer();
    releaseCanvas();
    spy.mockRestore();
  });

  it('counts renderer frames monotonically', () => {
    const before = getRenderedFrames();
    noteRenderedFrame();
    noteRenderedFrame();
    expect(getRenderedFrames()).toBe(before + 2);
  });
});
