import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE_PROBE_QUEUE_FALLBACK_MS, waitBehindWorldLoads, type BehindWorldLoadsDeps } from '../core-actor-probe.data';

/**
 * R49 fix round, seat D: the probe's load queue (D-R3), and the source
 * contracts of the two latch fixes (D-R1: no frozen world matrices; D-R2:
 * the latch reads the camera-about-to-move signal).
 */

const FIGURES = join(__dirname, '..');
const source = (file: string) => readFileSync(join(FIGURES, file), 'utf8');

/** A fake figure loader and clock. */
const fakeLoader = (pending0 = 0) => {
  const state = { pending: pending0, listeners: new Set<() => void>(), timers: new Map<number, { run: () => void; ms: number }>(), next: 1 };
  const deps: BehindWorldLoadsDeps = {
    pending: () => state.pending,
    subscribe: (listener) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    setTimer: (run, ms) => {
      const id = state.next++;
      state.timers.set(id, { run, ms });
      return id;
    },
    clearTimer: (handle) => {
      state.timers.delete(handle as number);
    },
  };
  /** A load starts (or settles): the loader notifies its listeners. */
  const notify = (pending: number) => {
    state.pending = pending;
    for (const l of [...state.listeners]) l();
  };
  const elapse = () => {
    for (const [id, t] of [...state.timers]) {
      state.timers.delete(id);
      t.run();
    }
  };
  return { state, deps, notify, elapse };
};

describe('R49 K9: the probe queues its loads behind the world figure loads (waitBehindWorldLoads)', () => {
  it('waits (subscribed, a 1.5 s fallback armed) while no world figure load is in flight, and fires once on the first pending load', () => {
    const loader = fakeLoader(0);
    let queued = 0;
    waitBehindWorldLoads(loader.deps, () => (queued += 1));
    expect(queued).toBe(0);
    expect(loader.state.listeners.size).toBe(1);
    expect([...loader.state.timers.values()].map((t) => t.ms)).toEqual([CORE_PROBE_QUEUE_FALLBACK_MS]);
    expect(CORE_PROBE_QUEUE_FALLBACK_MS).toBe(1500);
    // A notification with nothing pending (a settle) does not release it.
    loader.notify(0);
    expect(queued).toBe(0);
    loader.notify(2);
    expect(queued).toBe(1);
    // Released: unsubscribed, the fallback cleared; later loads change nothing.
    expect(loader.state.listeners.size).toBe(0);
    expect(loader.state.timers.size).toBe(0);
    loader.notify(3);
    expect(queued).toBe(1);
  });

  it('fires at once when a world load is already in flight (nothing armed)', () => {
    const loader = fakeLoader(1);
    let queued = 0;
    waitBehindWorldLoads(loader.deps, () => (queued += 1));
    expect(queued).toBe(1);
    expect(loader.state.listeners.size).toBe(0);
    expect(loader.state.timers.size).toBe(0);
  });

  it('the fallback fires once after 1.5 s when no world load ever starts', () => {
    const loader = fakeLoader(0);
    let queued = 0;
    waitBehindWorldLoads(loader.deps, () => (queued += 1));
    loader.elapse();
    expect(queued).toBe(1);
    expect(loader.state.listeners.size).toBe(0);
    loader.notify(1);
    expect(queued).toBe(1);
  });

  it('the cancel (unmount) unsubscribes and clears the fallback; nothing fires after it', () => {
    const loader = fakeLoader(0);
    let queued = 0;
    const cancel = waitBehindWorldLoads(loader.deps, () => (queued += 1));
    cancel();
    expect(loader.state.listeners.size).toBe(0);
    expect(loader.state.timers.size).toBe(0);
    loader.notify(1);
    expect(queued).toBe(0);
  });

  it('CoreActorProbe holds residency, kicks no preload and mounts no actor until queued', () => {
    const probe = source('CoreActorProbe.tsx');
    const hook = probe.slice(probe.indexOf('function useBehindWorldLoads'), probe.indexOf('function ProbeActors'));
    expect(hook).toMatch(/useState\(\(\) => pendingFigureLoads\(\) > 0\)/);
    expect(hook).toMatch(/useResidencyHold\(`\$\{CORE_PROBE_WORLD\}:core-probe:queue`, !queued\)/);
    expect(hook).toMatch(/if \(queued\) return;\s*return waitBehindWorldLoads\(BEHIND_WORLD_LOADS, \(\) => setQueued\(true\)\);/);
    expect(probe).toMatch(/if \(!queued\) return;\s*for \(const entry of cast\.loadEntries\) preloadFigure\(figureUrl\(entry\)\);/);
    expect(probe).toMatch(/if \(!queued\) return null;/);
    // Every preloadFigure call sits behind the queue gate.
    expect(probe.match(/preloadFigure\(/g)).toHaveLength(1);
  });
});

describe('R49 fix D-R1 / D-R2: the actors\' latch contract', () => {
  it('D-R1: neither actor freezes its world matrix (no matrixWorldAutoUpdate assignment)', () => {
    for (const file of ['WaterResident.tsx', 'SkyLaneFlyer.tsx']) {
      expect(source(file)).not.toMatch(/\.matrixWorldAutoUpdate\s*=/);
    }
  });

  it('D-R2: the water resident\'s latch wish reads the camera-about-to-move signal; the surfacer keeps its beat wish', () => {
    const resident = source('WaterResident.tsx');
    expect(resident).toMatch(/if \(mode === 'surfacer'\) return scratch\.wants;/);
    expect(resident).toMatch(/residentLatchWants\(scratch\.wants, progress \? progress\.smooth : null, scratch\.smooth, focusStore\.get\(\)\.subject !== null\)/);
    expect(resident).toMatch(/scratch\.smooth = progressNow \? progressNow\.smooth : Number\.NaN;/);
    // Final review (dormant latch): the wish and its progress are written together, only in noteWish, so a
    // step that returns early (dormant) leaves BOTH stale and the latch keeps the root shown after a move.
    expect(resident.match(/scratch\.smooth =/g)).toHaveLength(1);
    expect(resident.match(/scratch\.wants =/g)).toHaveLength(1);
    const noteWish = resident.slice(resident.indexOf('const noteWish'), resident.indexOf('const step ='));
    expect(noteWish).toMatch(/scratch\.smooth = [^;]+;\s*scratch\.wants = wants;/);
    const step = resident.slice(resident.indexOf('const step ='));
    expect(step.indexOf('noteWish(')).toBeGreaterThan(-1);
    expect(step.indexOf('if (frame.dormant) return;')).toBeLessThan(step.lastIndexOf('noteWish(wants)'));
    // The flip answer goes through the shared helper (the surfacer's R32 answer included).
    expect(resident).toMatch(/residentFlipInFrustum\(mode === 'surfacer' && surfacer !== null \? surfacer\.topY : null, heights\.surfaceY, r, generic, flip\)/);
  });
});

describe('PR #65 review: an actor hands its open hero ticket back to the bus on unmount', () => {
  it('both actors capture the step\'s bus before requesting and release an open ticket in the cleanup, before unregistering', () => {
    // The bus never expires a ticket (ambient-beats.test.ts): a granted one left by an unmount held
    // every later hero beat `busy` for the rest of the generation.
    for (const file of ['WaterResident.tsx', 'SkyLaneFlyer.tsx']) {
      const actor = source(file);
      const step = actor.slice(actor.indexOf('const step ='), actor.indexOf('const pin ='));
      expect(step.indexOf('bus = ctx.bus;'), file).toBeGreaterThan(-1);
      expect(step.indexOf('bus = ctx.bus;'), file).toBeLessThan(step.indexOf('ctx.bus.request('));
      const cleanup = actor.slice(actor.lastIndexOf('return () => {'));
      expect(cleanup, file).toMatch(
        /^return \(\) => \{\s*(\/\/[^\n]*\s*)*if \(ticket !== null && bus !== null\) bus\.release\(ticket\);\s*ticket = null;\s*releaseActor\(\);\s*releaseLatch\(\);/,
      );
    }
  });
});
