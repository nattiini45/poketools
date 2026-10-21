/**
 * Frame-time percentiles for the route world.
 *
 * The debug overlay's EMA fps answers "how smooth does it feel right now".
 * The D1 budgets are written in percentiles — p95 ≤ 20 ms, p99 ≤ 33.3 ms on
 * desktop — because a world that averages 60 fps while stuttering through every
 * camera move still fails the visitor. An average cannot express that, so the
 * distribution is recorded here.
 *
 * Always on, not debug-gated: one ring-buffer write per frame is far cheaper
 * than the render it measures, and a budget that only exists behind a query
 * param never gets measured in the field.
 */

/** ~10 s at 60 fps — long enough to cover a station transition. */
export const WINDOW_FRAMES = 600;

/** A frame above this is a hitch a visitor can feel (D1 long-frame count). */
const LONG_FRAME_MS = 50;

const samples = new Float64Array(WINDOW_FRAMES);
let count = 0;
let cursor = 0;
let longFrames = 0;

export function recordFrame(deltaMs: number): void {
  if (count === WINDOW_FRAMES) {
    // The window is full: the sample being overwritten may have been a long
    // frame, so the running count has to leave with it.
    if (samples[cursor] > LONG_FRAME_MS) longFrames -= 1;
  } else {
    count += 1;
  }
  if (deltaMs > LONG_FRAME_MS) longFrames += 1;
  samples[cursor] = deltaMs;
  cursor = (cursor + 1) % WINDOW_FRAMES;
}

export interface FrameStats {
  /** Frames in the window — below WINDOW_FRAMES means still warming up. */
  frames: number;
  /** Window is full, so the percentiles describe a steady state. */
  settled: boolean;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Frames over 50 ms currently inside the window. */
  longFrames: number;
}

const EMPTY_STATS: FrameStats = {
  frames: 0,
  settled: false,
  p50: 0,
  p95: 0,
  p99: 0,
  max: 0,
  longFrames: 0,
};

/**
 * Percentiles over the live window. Sorted on read, not on write — reads are
 * rare (a harness poll or an overlay refresh), writes happen 60× a second.
 */
export function getFrameStats(): FrameStats {
  if (count === 0) return EMPTY_STATS;

  const sorted = Array.from(samples.subarray(0, count)).sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

  return {
    frames: count,
    settled: count === WINDOW_FRAMES,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1],
    longFrames,
  };
}

/** Drop the window — called when a scene generation ends so runs don't blend. */
export function resetFrameStats(): void {
  count = 0;
  cursor = 0;
  longFrames = 0;
}
