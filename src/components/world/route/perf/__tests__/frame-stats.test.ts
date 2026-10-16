import { beforeEach, describe, expect, it } from 'vitest';
import { getFrameStats, recordFrame, resetFrameStats, WINDOW_FRAMES } from '../frame-stats';

/**
 * D1 — the frame budgets are written in percentiles, so the recorder has to be
 * correct about the distribution and about what leaves the window. A hitch
 * count that never decays would report a stutter from ten seconds ago as a
 * current one.
 */

function recordTimes(ms: number, count: number): void {
  for (let i = 0; i < count; i += 1) recordFrame(ms);
}

describe('frame-stats', () => {
  beforeEach(() => {
    resetFrameStats();
  });

  it('reports an empty window without inventing numbers', () => {
    const stats = getFrameStats();
    expect(stats).toEqual({
      frames: 0,
      settled: false,
      p50: 0,
      p95: 0,
      p99: 0,
      max: 0,
      longFrames: 0,
    });
  });

  it('reports uniform frame times identically at every percentile', () => {
    recordTimes(10, 100);
    const stats = getFrameStats();
    expect(stats.frames).toBe(100);
    expect(stats.p50).toBe(10);
    expect(stats.p95).toBe(10);
    expect(stats.p99).toBe(10);
    expect(stats.max).toBe(10);
    expect(stats.longFrames).toBe(0);
  });

  it('is not settled until the window is full', () => {
    recordTimes(10, WINDOW_FRAMES - 1);
    expect(getFrameStats().settled).toBe(false);
    recordTimes(10, 1);
    expect(getFrameStats().settled).toBe(true);
    expect(getFrameStats().frames).toBe(WINDOW_FRAMES);
  });

  it('separates a single hitch from the median', () => {
    // 99 fast frames plus one 120 ms stall: an average would read ~11 ms and
    // hide the stutter, p99 must not.
    recordTimes(10, 99);
    recordFrame(120);
    const stats = getFrameStats();
    expect(stats.p50).toBe(10);
    expect(stats.p99).toBe(120);
    expect(stats.max).toBe(120);
    expect(stats.longFrames).toBe(1);
  });

  it('counts only frames over the 50 ms hitch threshold', () => {
    recordFrame(49);
    recordFrame(50);
    recordFrame(51);
    expect(getFrameStats().longFrames).toBe(1);
  });

  it('drops a hitch from the count once it leaves the window', () => {
    recordFrame(60);
    recordTimes(10, WINDOW_FRAMES - 1);
    expect(getFrameStats().longFrames).toBe(1);

    // The window is full and the cursor is back at the 60 ms sample, so the
    // next write evicts it and the count must fall with it.
    recordFrame(10);
    expect(getFrameStats().longFrames).toBe(0);
    expect(getFrameStats().frames).toBe(WINDOW_FRAMES);
  });

  it('clears on reset so scene generations do not blend', () => {
    recordTimes(10, 50);
    resetFrameStats();
    expect(getFrameStats().frames).toBe(0);
    expect(getFrameStats().settled).toBe(false);
  });
});
