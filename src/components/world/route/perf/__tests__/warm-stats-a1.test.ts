import { afterEach, describe, expect, it } from 'vitest';
import {
  beginStatsFrame,
  noteAppearance,
  noteDirectorMs,
  noteFrameRender,
  noteLatchWarmError,
  noteLateRegistration,
  noteStatsSettle,
  noteWaterline,
  resetWarmStatsForTests,
  warmStatsFramesForTests,
  warmStatsWindow,
} from '../warm-stats';

/**
 * POKEMON-CORE A1 (R3, R4, R5, R12): the ledger's director time, settle
 * sub-window, D23 tripwires and actor logs.
 */

afterEach(() => resetWarmStatsForTests());

function frames(n: number, t0: number, busy: (i: number) => number, director: (i: number) => number) {
  for (let i = 0; i < n; i += 1) {
    beginStatsFrame(t0 + i * 33);
    noteFrameRender('world', 'screen', busy(i), 100);
    noteDirectorMs(director(i));
  }
  beginStatsFrame(t0 + n * 33);
}

describe('warm-stats: POKEMON-CORE A1 fields', () => {
  it('records directorMs per frame and its window percentiles', () => {
    resetWarmStatsForTests(true);
    frames(20, 0, () => 1, (i) => (i < 10 ? 0.1 : 0.3));
    const f = warmStatsFramesForTests();
    expect(f).toHaveLength(20);
    expect(f[0].directorMs).toBe(0.1);
    const w = warmStatsWindow(f, 0, 10_000);
    expect(w.directorP50).toBe(0.3);
    expect(w.directorP95).toBe(0.3);
  });

  it('the settled sub-window starts at the latest settle mark at or before the window end', () => {
    resetWarmStatsForTests(true);
    noteStatsSettle(100);
    noteStatsSettle(33 * 10);
    noteStatsSettle(99_999); // after the window: ignored
    frames(20, 0, (i) => (i < 10 ? 20 : 5), () => 0.2);
    const w = warmStatsWindow(warmStatsFramesForTests(), 0, 33 * 20);
    expect(w.settled).not.toBeNull();
    expect(w.settled!.from).toBe(330);
    expect(w.settled!.frames).toBe(10);
    expect(w.settled!.directorP95).toBe(0.2);
  });

  it('no settle mark: settled is null', () => {
    resetWarmStatsForTests(true);
    frames(5, 0, () => 1, () => 0);
    expect(warmStatsWindow(warmStatsFramesForTests(), 0, 1000).settled).toBeNull();
  });

  it('carries the D23 tripwires cumulatively and the actor logs by window', () => {
    resetWarmStatsForTests(true);
    noteLateRegistration('figure-late');
    noteLatchWarmError(2);
    noteLatchWarmError(0);
    noteAppearance('flyer', true, false);
    noteWaterline('wader', true);
    const now = performance.now();
    const w = warmStatsWindow([], now - 60_000, now + 60_000);
    expect(w.lateRegistrations).toEqual(['figure-late']);
    expect(w.latchWarmErrors).toBe(2);
    expect(w.appearances.map((a) => [a.id, a.visible, a.inFrustum])).toEqual([['flyer', true, false]]);
    expect(w.waterline.map((a) => [a.id, a.submerged])).toEqual([['wader', true]]);
    expect(warmStatsWindow([], 0, 1).appearances).toEqual([]);
  });

  it('is inert outside a debug session', () => {
    resetWarmStatsForTests(false);
    noteLateRegistration('x');
    noteLatchWarmError(3);
    noteStatsSettle(1);
    const w = warmStatsWindow([], 0, 10);
    expect(w.lateRegistrations).toEqual([]);
    expect(w.latchWarmErrors).toBe(0);
    expect(w.settled).toBeNull();
  });
});
