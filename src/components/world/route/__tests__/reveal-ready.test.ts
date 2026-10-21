import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESIDENCY_QUIET_MS } from '@/lib/route-world/residency';
import { onRevealReady, registerPopulation, resetResidencyForTests } from '../residency-store';
import { noteRevealArmed, resetSceneProgressForTests } from '../scene-progress';
import { beginSceneGeneration, resetSceneReadiness } from '../world-readiness';

/**
 * D42 commit G: `onRevealReady(cb)` — the single subscription N3 (ENGINE-P)
 * applies its layer tags at. It fires once residency is complete AND the
 * reveal has armed for the current scene generation, at most once per
 * generation; immediately (a microtask) when that already holds.
 */
describe('residency-store: onRevealReady', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetResidencyForTests();
    resetSceneReadiness();
    resetSceneProgressForTests();
  });
  afterEach(() => {
    resetResidencyForTests();
    resetSceneReadiness();
    resetSceneProgressForTests();
    vi.useRealTimers();
  });

  function settleResidency(): void {
    const population = registerPopulation('gallery:figure');
    population.commit();
    vi.advanceTimersByTime(RESIDENCY_QUIET_MS + 1);
  }

  it('waits for residency AND the arm of the current generation, then fires once', () => {
    const generation = beginSceneGeneration('gallery:day')!;
    const cb = vi.fn();
    const off = onRevealReady(cb);
    settleResidency();
    expect(cb).not.toHaveBeenCalled(); // residency alone is not the reveal
    noteRevealArmed(generation, 1234);
    expect(cb).toHaveBeenCalledTimes(1);
    // Later residency churn in the same generation does not fire it again.
    const late = registerPopulation('late');
    late.commit();
    vi.advanceTimersByTime(RESIDENCY_QUIET_MS + 1);
    noteRevealArmed(generation, 1300);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('an arm alone (residency still pending) does not fire', () => {
    const generation = beginSceneGeneration('gallery:day')!;
    const cb = vi.fn();
    const off = onRevealReady(cb);
    registerPopulation('pending');
    noteRevealArmed(generation, 10);
    vi.advanceTimersByTime(10 * RESIDENCY_QUIET_MS);
    expect(cb).not.toHaveBeenCalled();
    off();
  });

  it('already ready: fires in a microtask, not synchronously', async () => {
    const generation = beginSceneGeneration('gallery:day')!;
    settleResidency();
    noteRevealArmed(generation, 5);
    const cb = vi.fn();
    const off = onRevealReady(cb);
    expect(cb).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('unsubscribe cancels a pending microtask call and every later one', async () => {
    const generation = beginSceneGeneration('gallery:day')!;
    settleResidency();
    noteRevealArmed(generation, 5);
    const cb = vi.fn();
    const off = onRevealReady(cb);
    off();
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
  });

  it('a new generation (a theme swap) fires again once it is ready; a stale arm never counts', () => {
    const first = beginSceneGeneration('gallery:day')!;
    const cb = vi.fn();
    const off = onRevealReady(cb);
    settleResidency();
    noteRevealArmed(first, 1);
    expect(cb).toHaveBeenCalledTimes(1);
    const second = beginSceneGeneration('gallery:night')!;
    expect(second).not.toBe(first);
    vi.advanceTimersByTime(RESIDENCY_QUIET_MS + 1);
    // Residency re-settles for the new generation, but its reveal has not armed: the old arm is stale.
    expect(cb).toHaveBeenCalledTimes(1);
    noteRevealArmed(second, 2);
    expect(cb).toHaveBeenCalledTimes(2);
    off();
  });
});
