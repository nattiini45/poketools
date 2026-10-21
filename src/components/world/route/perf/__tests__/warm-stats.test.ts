import { afterEach, describe, expect, it } from 'vitest';
import {
  beginStatsFrame,
  noteFrameRender,
  noteWarmStat,
  resetWarmStatsForTests,
  warmStatsFramesForTests,
  warmStatsOn,
  warmStatsWindow,
} from '../warm-stats';

/**
 * ENGINE-A4R: the routeDebug-only per-frame work ledger (warm-stats.ts) that
 * names what a long route frame did.
 */

afterEach(() => resetWarmStatsForTests());

describe('route work ledger (warm-stats)', () => {
  it('is off outside a debug session: nothing is recorded', () => {
    resetWarmStatsForTests(false);
    expect(warmStatsOn()).toBe(false);
    beginStatsFrame(0);
    noteFrameRender('world', 'screen', 5, 100);
    noteWarmStat('scans');
    beginStatsFrame(16);
    expect(warmStatsFramesForTests()).toHaveLength(0);
  });

  it('closes each frame with its renders, draw calls and warm work, and times the frame', () => {
    resetWarmStatsForTests(true);
    beginStatsFrame(1000);
    noteFrameRender('world', '1440x900', 12, 400);
    noteFrameRender('world', '1440x900', 3, 20);
    noteFrameRender('Scene', 'screen', 1, 1);
    noteWarmStat('guardWalks', 1, 4);
    noteWarmStat('sceneCompiles', 1, 60);
    noteWarmStat('scanNodes', 2500);
    beginStatsFrame(1100);
    noteFrameRender('world', '1440x900', 10, 380);
    beginStatsFrame(1117);
    const frames = warmStatsFramesForTests();
    expect(frames).toHaveLength(2);
    const [slow, next] = frames;
    expect(slow.renders).toBe(3);
    expect(slow.calls).toBe(421);
    expect(slow.renderMs).toBe(16);
    expect(slow.list.map((r) => `${r.scene}@${r.target}`)).toEqual(['world@1440x900', 'world@1440x900', 'Scene@screen']);
    expect(slow.counts).toEqual({ guardWalks: 1, sceneCompiles: 1, scanNodes: 2500 });
    expect(slow.ms).toEqual({ guardWalks: 4, sceneCompiles: 60 });
    expect(next.interval).toBe(100);
    expect(next.renders).toBe(1);
  });

  it('a window sums its frames and lists the slow ones (interval or busy time at the bar)', () => {
    const frame = (t: number, interval: number, busyMs: number, calls = 100) => ({
      t,
      interval,
      busyMs,
      renders: 2,
      calls,
      renderMs: busyMs / 2,
      list: [],
      counts: { scans: 1 },
      ms: { warmTicks: 1.5 },
    });
    const frames = [frame(0, 17, 10), frame(17, 17, 12), frame(34, 110, 20), frame(144, 17, 70), frame(161, 17, 10), frame(9000, 17, 10)];
    const w = warmStatsWindow(frames, 0, 200, 50);
    expect(w.frames).toBe(5);
    expect(w.renders).toBe(10);
    expect(w.calls).toBe(500);
    expect(w.counts).toEqual({ scans: 5 });
    expect(w.ms).toEqual({ warmTicks: 7.5 });
    expect(w.slow.map((f) => f.t)).toEqual([34, 144]);
    expect(w.busyMax).toBe(70);
    expect(w.busyP50).toBe(12);
  });
});
