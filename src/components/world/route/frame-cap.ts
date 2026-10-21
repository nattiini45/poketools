/**
 * D38 / D40 post-reveal frame cap (ENGINE-A4; ENGINE-A5: `even40` is the
 * DEFAULT, owner D40 2026-09-29). `?routeFrameCap=off` and `hard40` stay as
 * explicit opt-ins.
 *
 * The product requirement is "a hard cap at 40 fps". On a fixed-refresh display a
 * 40 fps cadence cannot be even: at 60 Hz a frame is held for 1 or 2 vsyncs
 * (17 / 33 ms), which reads as judder. So two modes are built side by side:
 *
 * - `even40`: render every Nth display refresh, N = max(1, round(hz / 40)).
 *   60 Hz -> every 2nd (30 fps), 120 -> every 3rd (40), 144 -> every 4th (36),
 *   240 -> every 6th (40). Even pacing, never above ~40.
 * - `hard40`: at most 40 renders per second, on a 25 ms deadline grid
 *   (the next deadline advances by 25 ms per render). At 60 Hz that is
 *   33 / 17 / 33 / 17 ms: 40 fps with the judder above. Note: "at least 25 ms
 *   since the last render" would snap to every 2nd vsync on 60 Hz (30 fps,
 *   the same as even40), so the grid is what makes it a 40 fps cap.
 * - `off` (opt-in, `?routeFrameCap=off`): the pre-D40 behaviour (the canvas
 *   frameloop is left on `always`).
 *
 * Mechanics: with a mode other than `off` at mount (the default), the canvas runs
 * r3f's `frameloop="never"` and `FrameCapDriver` advances it from its own
 * requestAnimationFrame. A SKIPPED rAF runs only this module's bookkeeping
 * (a timestamp, a comparison): no useFrame callback, no render, no upload.
 * The cap applies after the reveal (ball done, no theme veil); the dev switch
 * `?routeFrameCapCeremony=1` also applies it while the ball is up (the canvas
 * renders only, never the DOM ball, which runs on the compositor).
 *
 * Skipped frames are not slow frames: every rendered frame carries a credit
 * (`frameCapCredit`) equal to the intervals that ended in a deliberately
 * skipped rAF. The QualityGovernor, the frame-stats ring and the load warm's
 * frame interval subtract it, so a capped frame never steps the ladder down.
 */

export type FrameCapMode = 'off' | 'even40' | 'hard40';

export const FRAME_CAP_MODES: readonly FrameCapMode[] = ['off', 'even40', 'hard40'];

/** The cap's target rate. */
export const FRAME_CAP_TARGET_FPS = 40;
/** hard40's deadline grid (ms). */
export const FRAME_CAP_HARD_MS = 1000 / FRAME_CAP_TARGET_FPS;
/** rAF timestamps jitter around the vsync grid; a deadline this close counts as met. */
export const FRAME_CAP_SLACK_MS = 2;
/** Intervals the refresh estimate keeps (~1 s at 60 Hz). */
export const FRAME_CAP_REFRESH_SAMPLES = 60;
/** Common display rates the estimate snaps to. */
const DISPLAY_RATES_HZ = [30, 48, 50, 60, 72, 75, 85, 90, 100, 120, 144, 165, 170, 180, 200, 240, 360] as const;

/** D40: the mode a page runs with no (or an unknown) `?routeFrameCap=` value. */
export const DEFAULT_FRAME_CAP_MODE: FrameCapMode = 'even40';

/**
 * `?routeFrameCap=` → mode (pure). D40: no value, or a value that is not a
 * mode, is the default `even40`; `off` and `hard40` are explicit opt-ins.
 */
export function parseFrameCapMode(raw: string | null | undefined): FrameCapMode {
  return raw === 'off' || raw === 'even40' || raw === 'hard40' ? raw : DEFAULT_FRAME_CAP_MODE;
}

/**
 * The display refresh interval (ms) from recent rAF intervals (pure): a low
 * percentile, because a busy main thread only ever LENGTHENS an interval, then
 * snapped to the nearest common display rate. 60 Hz with no samples.
 */
export function estimateRefreshMs(intervals: readonly number[]): number {
  const valid = intervals.filter((ms) => ms > 2 && ms < 100);
  if (valid.length < 8) return 1000 / 60;
  const sorted = [...valid].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.1)];
  const hz = 1000 / low;
  let best: number = DISPLAY_RATES_HZ[0];
  for (const rate of DISPLAY_RATES_HZ) if (Math.abs(rate - hz) < Math.abs(best - hz)) best = rate;
  return 1000 / best;
}

/** even40's divisor N (pure): 60 Hz -> 2, 120 -> 3, 144 -> 4, 240 -> 6. */
export function evenDivisor(refreshMs: number, targetFps = FRAME_CAP_TARGET_FPS): number {
  // Whole hertz first: 1000 / (1000 / 60) is 59.999..., and 60 / 40 = 1.5
  // must round UP (every 2nd refresh, 30 fps), never down to "uncapped".
  const hz = Math.round(1000 / refreshMs);
  return Math.max(1, Math.round(hz / targetFps));
}

export interface FrameCapState {
  /** rAF timestamp of the last rendered frame (null before the first). */
  lastRenderAt: number | null;
  /** rAF timestamp of the previous rAF, rendered or skipped. */
  lastRafAt: number | null;
  /** hard40: the next deadline on the 25 ms grid. */
  nextDueAt: number | null;
  /** Skipped-interval time since the last rendered frame. */
  skippedMs: number;
  /** The credit of the most recent rendered frame (see `frameCapCredit`). */
  creditMs: number;
  /** Recent rAF intervals (the refresh estimate's input). */
  intervals: number[];
  refreshMs: number;
  rendered: number;
  skipped: number;
}

export function createFrameCapState(): FrameCapState {
  return { lastRenderAt: null, lastRafAt: null, nextDueAt: null, skippedMs: 0, creditMs: 0, intervals: [], refreshMs: 1000 / 60, rendered: 0, skipped: 0 };
}

/**
 * One rAF of the cap (pure apart from `state`): whether to render this frame.
 * `capped` false (mode off, or outside the capped window) renders every rAF.
 */
export function stepFrameCap(state: FrameCapState, now: number, mode: FrameCapMode, capped: boolean): boolean {
  if (state.lastRafAt !== null) {
    const interval = now - state.lastRafAt;
    state.intervals.push(interval);
    if (state.intervals.length > FRAME_CAP_REFRESH_SAMPLES) state.intervals.shift();
    if (state.intervals.length % 15 === 0) state.refreshMs = estimateRefreshMs(state.intervals);
  }
  const sinceRaf = state.lastRafAt === null ? 0 : now - state.lastRafAt;
  state.lastRafAt = now;
  let render = true;
  if (capped && mode !== 'off' && state.lastRenderAt !== null) {
    if (mode === 'even40') {
      const period = evenDivisor(state.refreshMs) * state.refreshMs;
      render = now - state.lastRenderAt >= period - state.refreshMs / 2;
    } else {
      const due = state.nextDueAt ?? state.lastRenderAt + FRAME_CAP_HARD_MS;
      render = now >= due - FRAME_CAP_SLACK_MS;
    }
  }
  if (!render) {
    state.skippedMs += sinceRaf;
    state.skipped += 1;
    return false;
  }
  if (mode === 'hard40' && capped) {
    // The grid advances by one period per render; after a stall it resyncs
    // to this frame instead of bursting to catch up.
    const due = state.nextDueAt ?? now;
    const next = due + FRAME_CAP_HARD_MS;
    state.nextDueAt = next <= now ? now + FRAME_CAP_HARD_MS - FRAME_CAP_SLACK_MS : next;
  } else {
    state.nextDueAt = null;
  }
  state.creditMs = state.skippedMs;
  state.skippedMs = 0;
  state.lastRenderAt = now;
  state.rendered += 1;
  return true;
}

// ── Driven clock (the driver's r3f time base) ──────────────────────────────

/**
 * The seconds FrameCapDriver advances r3f to (ENGINE-A4R, verify-a4 item 5).
 *
 * The driver runs r3f's `frameloop="never"` and hands `advance()` a clock in
 * seconds; r3f turns it into the frame delta (`seconds - clock.elapsedTime`)
 * that every clip mixer and time-based shader integrates. The driver stops
 * while the tab is parked (the canvas drops to `demand`, whose own frames
 * move r3f's clock) and restarts on unpark, and r3f zeroes
 * `clock.elapsedTime` on every frameloop change. A run that restarted its
 * clock at 0 handed r3f a large NEGATIVE delta on the first frame after an
 * unpark: every mixer rewound and time-based shaders jumped.
 *
 * So the clock never goes backwards across runs: a run starts from the later
 * of the last driven time and r3f's clock as the run finds it (demand frames
 * may have moved it), and its first frame seats r3f's clock there (`seat`),
 * so that frame's delta is exactly 0; after it the clock follows the rAF
 * timestamps (a delta of one refresh per displayed frame).
 */
export interface DrivenClock {
  /** Seconds the driver last advanced r3f to (never decreases). */
  seconds: number;
  /** rAF timestamp the current run started at (null: the next frame starts a run). */
  originTs: number | null;
  /** Clock seconds at the run's start. */
  originSeconds: number;
  /**
   * ENGINE-A5 fix: while the tab is parked (`demand`), the latest r3f clock a
   * parked frame showed (null outside a park). The unpark resumes from it.
   */
  parkedSeconds: number | null;
  /** Mid-run frames whose r3f clock another writer had moved (re-seated; evidence). */
  reseats: number;
}

export function createDrivenClock(): DrivenClock {
  return { seconds: 0, originTs: null, originSeconds: 0, parkedSeconds: null, reseats: 0 };
}

/** A (re)enable of the driver: its next frame starts a new run. */
export function restartDrivenClock(clock: DrivenClock): void {
  clock.originTs = null;
}

/**
 * Slack (s) over the page's own age that an r3f clock value may show and
 * still be trusted (ENGINE-A5 fix, verify-a5). Every legitimate writer of
 * r3f's clock under the cap — the driver (from 0 at its first run, at most
 * wall time), a parked `demand` frame (wall time from a seat on the driven
 * clock) and the phase pin (restores the driven clock) — stays within the
 * page's age. A MILLISECOND timestamp read as seconds (r3f's own loop running
 * `update(rafMs)` under `never`) is ~1000x the page's age.
 */
export const DRIVEN_CLOCK_PLAUSIBLE_SLACK_S = 1;

/**
 * Mid-run tolerance (s) between r3f's clock and the driven clock. Under
 * `never` the driver is the clock's only writer between its own frames (the
 * pin restores it exactly), so any drift beyond one 60 Hz refresh is another
 * writer; the driver re-seats before it advances.
 */
export const DRIVEN_CLOCK_DRIFT_S = 1 / 60;

/** Whether an r3f clock value can be real time on this page (pure; `pageMs` = a rAF / performance.now() stamp). */
export function plausibleClockSeconds(seconds: number, pageMs: number): boolean {
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= Math.max(0, pageMs) / 1000 + DRIVEN_CLOCK_PLAUSIBLE_SLACK_S;
}

/**
 * One driven frame (pure apart from `clock`): the seconds to `advance()` r3f
 * to and the elapsed time to seat r3f's clock at first (`seat`; null when
 * r3f's clock is already on the driven clock). `rafMs` is the rAF timestamp,
 * `r3fSeconds` r3f's `clock.elapsedTime` right now.
 *
 * - A run's first frame seats at the later of the driven clock and r3f's
 *   clock, but only an r3f clock that is plausible page time
 *   (`plausibleClockSeconds`): verify-a5 caught r3f's own loop writing a
 *   millisecond rAF stamp into it at an unpark, which the pre-fix start
 *   adopted (a ~29,584 s jump for every mixer and clock-driven mover).
 * - Mid-run, an r3f clock off the driven clock by more than
 *   `DRIVEN_CLOCK_DRIFT_S` was moved by another writer: it is re-seated at
 *   the driven clock so this frame's delta is one displayed interval again.
 */
export function driveClock(clock: DrivenClock, rafMs: number, r3fSeconds: number): { seconds: number; seat: number | null } {
  if (clock.originTs === null) {
    const start = Math.max(clock.seconds, plausibleClockSeconds(r3fSeconds, rafMs) ? r3fSeconds : 0);
    clock.originTs = rafMs;
    clock.originSeconds = start;
    clock.seconds = start;
    return { seconds: start, seat: start };
  }
  const previous = clock.seconds;
  const seconds = Math.max(previous, clock.originSeconds + (rafMs - clock.originTs) / 1000);
  clock.seconds = seconds;
  if (!Number.isFinite(r3fSeconds) || Math.abs(r3fSeconds - previous) > DRIVEN_CLOCK_DRIFT_S) {
    clock.reseats += 1;
    return { seconds, seat: previous };
  }
  return { seconds, seat: null };
}

/**
 * The part of r3f 9's root state the driver's frameloop guard touches
 * (`store.getState()`; tests pass a plain object).
 */
export interface R3fLoopState {
  frameloop: 'always' | 'demand' | 'never';
  clock: { elapsedTime: number };
  internal: { frames: number };
}

/**
 * ENGINE-A5 fix (verify-a5, D40): r3f's own rAF loop must never advance the
 * root while it runs `frameloop="never"`.
 *
 * r3f 9.7's `loop()` updates a root when `frameloop === 'always' ||
 * internal.frames > 0`. `invalidate()` under the parked `demand` loop leaves
 * `internal.frames` at 1-2 and the loop scheduled; when the canvas switches
 * back to `never`, the next `loop(rafMs)` still runs `update(rafMs)`, and
 * under `never` update takes the delta as `timestamp - clock.elapsedTime` —
 * a millisecond stamp read as seconds. Under `never` nothing legitimate needs
 * those frames (`invalidate()` is a no-op there; the driver draws), so they
 * are cleared: by the store listener at the switch itself (synchronously, before
 * any rAF can run), when the driver enables, and at the top of every driver
 * rAF. Returns whether leftover frames were cleared.
 */
export function clearLeftoverFrames(state: R3fLoopState): boolean {
  if (state.frameloop !== 'never' || state.internal.frames <= 0) return false;
  state.internal.frames = 0;
  framesCleared += 1;
  return true;
}

/**
 * The driver's store listener for a frameloop change (ENGINE-A5 fix; pure
 * apart from `clock` and `state`). r3f's `setFrameloop` zeroes
 * `clock.elapsedTime` on every change; the listener runs synchronously inside
 * it and keeps the clock continuous:
 *
 * - `never` -> `demand` (park): r3f's restarted clock is seated at the driven
 *   clock, so parked `demand` frames continue it (wall time).
 * - -> `never` (unpark): leftover `demand` frames are cleared
 *   (`clearLeftoverFrames`) and r3f's clock resumes at the later of the driven
 *   clock and the last parked frame (plausible values only), so no sample
 *   ever sees the zero and the driver's first frame has delta 0.
 */
export function onDrivenFrameloopChange(clock: DrivenClock, state: R3fLoopState, previous: R3fLoopState['frameloop'], pageMs: number): void {
  if (state.frameloop === previous) return;
  if (state.frameloop === 'never') {
    clearLeftoverFrames(state);
    const parked = clock.parkedSeconds;
    const resume = Math.max(clock.seconds, parked !== null && plausibleClockSeconds(parked, pageMs) ? parked : 0);
    clock.seconds = resume;
    clock.parkedSeconds = null;
    state.clock.elapsedTime = resume;
    return;
  }
  if (state.frameloop === 'demand' && previous === 'never') {
    clock.parkedSeconds = clock.seconds;
    state.clock.elapsedTime = clock.seconds;
  }
}

/** A frame r3f ran while parked (`demand`): the clock the unpark resumes from (pure apart from `clock`). */
export function noteParkedFrame(clock: DrivenClock, r3fSeconds: number, pageMs: number): void {
  if (clock.parkedSeconds === null || !plausibleClockSeconds(r3fSeconds, pageMs)) return;
  clock.parkedSeconds = Math.max(clock.parkedSeconds, r3fSeconds);
}

/**
 * The capture phase pin's forced r3f advance (ENGINE-A5, D40: stills now run
 * under the cap, so under `frameloop="never"`).
 *
 * The pin stamps r3f's `clock.elapsedTime` to the canonical phase, then runs
 * ONE synchronous `advance()` so every frame subscriber (breathing statues,
 * holo bob) recomputes from that phase, and every clip mixer gets delta ~0.
 * Outside `never` r3f ignores the timestamp and takes the delta from its own
 * stopped-and-restamped THREE.Clock (the pre-D40 path, unchanged). Under
 * `never` r3f's delta is `timestamp - clock.elapsedTime`, in SECONDS: the old
 * `advance(performance.now())` handed it thousands of seconds (every mixer
 * jumped), and the next driven frame then ran from the canonical phase back
 * up to the driven clock (a second jump, or a rewind).
 *
 * So under `never` (pure): the advance goes TO the pinned phase (delta exactly
 * 0: no time passes for a mixer), and afterwards r3f's clock is re-seated at
 * the continuous driven clock (`restoreSeconds`: the later of r3f's clock as
 * the pin found it and the driver's own seconds), so the next driven frame's
 * delta is one displayed interval — never a jump, never negative.
 */
export function pinPhaseAdvance(input: {
  frameloop: 'always' | 'demand' | 'never';
  /** r3f's `clock.elapsedTime` BEFORE the pin stamped it. */
  clockSeconds: number;
  /** The driver's continuous clock (seconds), null without a driver. */
  drivenSeconds: number | null;
  /** The canonical phase the pin stamps (seconds). */
  pinnedElapsed: number;
  /** `performance.now()` (the pre-D40 timestamp; ignored by r3f outside `never`). */
  nowMs: number;
}): { advanceTo: number; restoreSeconds: number | null } {
  if (input.frameloop !== 'never') return { advanceTo: input.nowMs, restoreSeconds: null };
  const before = Number.isFinite(input.clockSeconds) ? input.clockSeconds : 0;
  const driven = input.drivenSeconds !== null && Number.isFinite(input.drivenSeconds) ? input.drivenSeconds : 0;
  return { advanceTo: input.pinnedElapsed, restoreSeconds: Math.max(before, driven) };
}

// ── Module state (one route canvas per page) ───────────────────────────────

let requested: FrameCapMode | null = null;
let ceremonyRequested: boolean | null = null;
let mode: FrameCapMode = DEFAULT_FRAME_CAP_MODE;
let active = false;
let creditMs = 0;
let stats: FrameCapState | null = null;
let drivenClock: DrivenClock | null = null;
/** Leftover r3f loop frames cleared under `never` (evidence; `clearLeftoverFrames`). */
let framesCleared = 0;

function readParams(): void {
  if (requested !== null) return;
  requested = DEFAULT_FRAME_CAP_MODE;
  mode = requested;
  ceremonyRequested = false;
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    requested = parseFrameCapMode(params.get('routeFrameCap'));
    ceremonyRequested = params.get('routeDebug') === '1' && params.get('routeFrameCapCeremony') === '1';
  } catch {
    // No URL: the default.
  }
  mode = requested;
}

/** The mode the page asked for at load (`?routeFrameCap=`, D40 default `even40`); decides whether the driver runs. */
export function requestedFrameCapMode(): FrameCapMode {
  readParams();
  return requested ?? DEFAULT_FRAME_CAP_MODE;
}

/** The live mode (the dev global may switch it while the driver runs). */
export function frameCapMode(): FrameCapMode {
  readParams();
  return mode;
}

export function setFrameCapMode(next: FrameCapMode): void {
  readParams();
  mode = next;
}

/** Whether the cap also holds while the ball is up (dev experiment). */
export function frameCapDuringCeremony(): boolean {
  readParams();
  return ceremonyRequested === true;
}

/** Set by the driver: whether it is advancing the canvas (frameloop "never"). */
export function noteFrameCapDriver(on: boolean, state: FrameCapState | null, clock: DrivenClock | null = null): void {
  active = on;
  stats = state;
  if (clock !== null) drivenClock = clock;
  if (!on) creditMs = 0;
}

/** The driver's continuous clock (seconds; kept across park / unpark), null before a driver ran. */
export function drivenClockSeconds(): number | null {
  return drivenClock === null ? null : drivenClock.seconds;
}

/** Set by the driver right before it advances a rendered frame. */
export function noteFrameCapCredit(ms: number): void {
  creditMs = ms;
}

/**
 * Deliberately skipped time folded into the CURRENT rendered frame's delta
 * (ms; 0 without a cap). Frame-time consumers subtract it (see the note above).
 */
export function frameCapCredit(): number {
  return active ? creditMs : 0;
}

/** A frame interval with the cap's deliberate skips removed (never below 0). */
export function uncappedFrameMs(frameMs: number): number {
  return Math.max(0, frameMs - frameCapCredit());
}

/** Dev / evidence readout. */
export function frameCapReadout(): {
  requested: FrameCapMode;
  mode: FrameCapMode;
  active: boolean;
  ceremony: boolean;
  refreshMs: number | null;
  divisor: number | null;
  rendered: number;
  skipped: number;
  /** ENGINE-A5 fix: leftover r3f loop frames cleared under `never`. */
  framesCleared: number;
  /** ENGINE-A5 fix: mid-run frames whose r3f clock another writer had moved. */
  clockReseats: number;
  /** The driven clock (s). */
  clockSeconds: number | null;
} {
  readParams();
  return {
    requested: requested ?? DEFAULT_FRAME_CAP_MODE,
    mode,
    active,
    ceremony: ceremonyRequested === true,
    refreshMs: stats ? Math.round(stats.refreshMs * 100) / 100 : null,
    divisor: stats ? evenDivisor(stats.refreshMs) : null,
    rendered: stats?.rendered ?? 0,
    skipped: stats?.skipped ?? 0,
    framesCleared,
    clockReseats: drivenClock?.reseats ?? 0,
    clockSeconds: drivenClock === null ? null : Math.round(drivenClock.seconds * 1000) / 1000,
  };
}

/** Tests only. */
export function resetFrameCapForTests(): void {
  requested = null;
  ceremonyRequested = null;
  mode = DEFAULT_FRAME_CAP_MODE;
  active = false;
  creditMs = 0;
  stats = null;
  drivenClock = null;
  framesCleared = 0;
}
