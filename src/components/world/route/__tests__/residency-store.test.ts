import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESIDENCY_QUIET_MS } from '@/lib/route-world/residency';
import { pendingFigureLoads, preloadFigure } from '../figures/figure-loader';
import { Object3D } from 'three';
import {
  applyLatchVisibility,
  assertLatchVisible,
  getResidencySnapshot,
  isResidencyComplete,
  latchActorCount,
  latchHideAllowed,
  registerLatchActor,
  registerPopulation,
  resetResidencyForTests,
  subscribeResidency,
} from '../residency-store';
import { markVeiledGeneration, noteRevealArmed, resetSceneProgressForTests } from '../scene-progress';
import { beginSceneGeneration, resetSceneReadiness } from '../world-readiness';

/**
 * The residency-complete signal ENGINE-GATE's reveal waits on (D23,
 * LOOK-PLAN §2 seat R item 5).
 */
describe('residency-store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetResidencyForTests();
  });
  afterEach(() => {
    resetResidencyForTests();
    vi.useRealTimers();
  });

  it('is never complete before a world registers a population', () => {
    vi.advanceTimersByTime(10 * RESIDENCY_QUIET_MS);
    expect(isResidencyComplete()).toBe(false);
  });

  it('completes once every population has committed and the quiet window passed', () => {
    const a = registerPopulation('plaza:a');
    const b = registerPopulation('plaza:b');
    a.commit();
    vi.advanceTimersByTime(10 * RESIDENCY_QUIET_MS);
    expect(isResidencyComplete()).toBe(false);
    expect(getResidencySnapshot().pending).toBe(1);
    b.commit();
    vi.advanceTimersByTime(RESIDENCY_QUIET_MS - 50);
    expect(isResidencyComplete()).toBe(false);
    vi.advanceTimersByTime(100);
    expect(isResidencyComplete()).toBe(true);
    a.release();
    b.release();
  });

  it('a nested population registering inside the quiet window re-opens it', () => {
    const outer = registerPopulation('outer');
    outer.commit();
    vi.advanceTimersByTime(RESIDENCY_QUIET_MS / 2);
    const inner = registerPopulation('inner');
    vi.advanceTimersByTime(RESIDENCY_QUIET_MS * 2);
    expect(isResidencyComplete()).toBe(false);
    inner.commit();
    vi.advanceTimersByTime(RESIDENCY_QUIET_MS + 1);
    expect(isResidencyComplete()).toBe(true);
  });

  it('notifies subscribers on completion', () => {
    const listener = vi.fn();
    const off = subscribeResidency(listener);
    const p = registerPopulation('p');
    p.commit();
    listener.mockClear();
    vi.advanceTimersByTime(RESIDENCY_QUIET_MS + 1);
    expect(listener).toHaveBeenCalled();
    expect(getResidencySnapshot().complete).toBe(true);
    off();
  });

  // Last: leaves one unsettled (never-armed) preload in this file's module state.
  it('holds completion while a queued preload has not settled', () => {
    const p = registerPopulation('p');
    p.commit();
    const before = pendingFigureLoads();
    preloadFigure('/models/world/figures/never-armed.glb');
    preloadFigure('/models/world/figures/never-armed.glb');
    expect(pendingFigureLoads()).toBe(before + 1);
    vi.advanceTimersByTime(10 * RESIDENCY_QUIET_MS);
    expect(isResidencyComplete()).toBe(false);
    expect(getResidencySnapshot().preloadsPending).toBe(before + 1);
  });
});

/**
 * POKEMON-CORE C5 / L7: the push latch. An actor may be hidden only while
 * live; every generation start (the load, a D32 veil swap) shows every
 * registered root synchronously, before that warm's first buffer slice.
 */
describe('residency-store: push latch (C5)', () => {
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

  function actor(id: string, wants: { value: boolean }) {
    const root = new Object3D();
    const release = registerLatchActor({ id, root: () => root, wants: () => wants.value });
    return { root, release };
  }

  it('load path: a hidden-wanting actor stays visible until live, and the first slice finds none hidden', () => {
    const first = beginSceneGeneration('plaza:day')!;
    const wants = { value: false };
    const { root } = actor('sakura-prop-flyer-probe', wants);
    root.visible = false; // a stray write before the warm
    expect(latchHideAllowed()).toBe(false);
    applyLatchVisibility();
    expect(root.visible).toBe(true);
    expect(assertLatchVisible(first)).toBe(0);
    // Live: the actor may hide, and every flip is reported with its frustum test.
    noteRevealArmed(first, 1000);
    const flips: [string, boolean, boolean][] = [];
    applyLatchVisibility(() => false, (id, visible, inFrustum) => flips.push([id, visible, inFrustum]));
    expect(root.visible).toBe(false);
    expect(flips).toEqual([['sakura-prop-flyer-probe', false, false]]);
  });

  it('veil path: the swap generation shows every registered actor before its warm runs', () => {
    const first = beginSceneGeneration('plaza:day')!;
    const wants = { value: false };
    const a = actor('surfacer', wants);
    const b = actor('flyer', wants);
    noteRevealArmed(first, 1000);
    applyLatchVisibility();
    expect([a.root.visible, b.root.visible]).toEqual([false, false]);
    markVeiledGeneration(first + 1);
    const swap = beginSceneGeneration('plaza:night')!;
    expect(swap).toBe(first + 1);
    // Synchronously, before any frame or warm slice of the new generation.
    expect([a.root.visible, b.root.visible]).toEqual([true, true]);
    expect(latchHideAllowed()).toBe(false);
    applyLatchVisibility();
    expect([a.root.visible, b.root.visible]).toEqual([true, true]);
    expect(assertLatchVisible(swap)).toBe(0);
  });

  it('R32: an actor with its own inFrustum hook reports the hook, not the generic test; others keep the generic one', () => {
    const gen = beginSceneGeneration('plaza:day')!;
    const wants = { value: true };
    const hooked = new Object3D();
    const plain = new Object3D();
    const hookCalls: [Object3D, boolean][] = [];
    const generic = (root: Object3D) => root === plain || root === hooked;
    const releaseHooked = registerLatchActor({
      id: 'surfacer',
      root: () => hooked,
      wants: () => wants.value,
      inFrustum: (root, g) => {
        hookCalls.push([root, g(root)]);
        return false;
      },
    });
    const releasePlain = registerLatchActor({ id: 'flyer', root: () => plain, wants: () => wants.value });
    noteRevealArmed(gen, 1000);
    const flips: [string, boolean, boolean][] = [];
    const note = (id: string, visible: boolean, inFrustum: boolean) => flips.push([id, visible, inFrustum]);
    // No flip: the hook is not consulted.
    applyLatchVisibility(generic, note);
    expect(hookCalls).toHaveLength(0);
    wants.value = false;
    applyLatchVisibility(generic, note);
    // The hook got the root and the director's generic test; its answer (false) wins over the generic true.
    expect(hookCalls).toEqual([[hooked, true]]);
    expect(flips).toEqual([
      ['surfacer', false, false],
      ['flyer', false, true],
    ]);
    // Without a director test the hook still answers, and its generic is a constant false.
    wants.value = true;
    applyLatchVisibility(undefined, note);
    expect(hookCalls[1]).toEqual([hooked, false]);
    expect(flips.slice(2)).toEqual([
      ['surfacer', true, false],
      ['flyer', true, false],
    ]);
    // Without a note the hook is never called (it is the flag's source only).
    wants.value = false;
    applyLatchVisibility(generic);
    expect(hookCalls).toHaveLength(2);
    expect([hooked.visible, plain.visible]).toEqual([false, false]);
    releaseHooked();
    releasePlain();
  });

  it('the warm assertion counts, logs and repairs a hidden actor', () => {
    const gen = beginSceneGeneration('plaza:day')!;
    const { root } = actor('rogue', { value: true });
    root.visible = false;
    expect(assertLatchVisible(gen)).toBe(1);
    expect(root.visible).toBe(true);
    expect(latchActorCount()).toBe(1);
  });
});
