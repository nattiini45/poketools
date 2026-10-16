/**
 * Direction latch — pure hysteresis primitives (bar W6, decision D6).
 *
 * Anything that turns a continuous, possibly noisy signal into a discrete
 * decision (which station is nearest, which way the visitor is travelling,
 * which phase a loader or a figure is in) must not flip back and forth when
 * the signal hovers at a boundary. Every such decision in the route world goes
 * through one of these latches instead of a bare `Math.round` / `Math.sign`:
 *
 * - `stepBandLatch` / `stepStationLatch` — a discrete state with separate
 *   enter and exit thresholds (a Schmitt trigger per boundary).
 * - `stepDirectionLatch` — a travel direction with a displacement deadband
 *   and a minimum dwell measured in SECONDS of supplied time (never frames).
 * - `stepDwellLatch` — any discrete value that may only change after it has
 *   been held for a minimum time (W2 behaviour controller).
 * - `stepMonotonePhase` — a ranked phase that only advances until its reset
 *   token changes (W7 loader).
 *
 * Time is always supplied by the caller in seconds, so the same code runs
 * under a real clock, a frame clock or a test clock.
 *
 * Pure data — no client-only imports, so it is unit-testable.
 */

// ── Discrete-state latch ────────────────────────────────────────────────────

/**
 * Hysteresis band beyond the .5 midpoint for the shared nearest-station
 * signal: the latch moves from station n to n+1 only once progress passes
 * n + 0.5 + band, and back only below n + 0.5 − band. 0.15 is the low end of
 * the W6 brief's 0.15–0.2 range: wide enough that wheel noise, rubber-band
 * scrolling and remeasure shifts around a midpoint cannot retrigger, narrow
 * enough that the walker pocket hop still lands inside the crossing, where
 * both pocket floors sit at the frame periphery (AmbientFigures C-047).
 */
export const NEAREST_STATION_BAND = 0.15;

export interface BandLatchOptions {
  /**
   * Ascending boundaries between states. State k covers the interval between
   * `thresholds[k - 1]` and `thresholds[k]`, so there are
   * `thresholds.length + 1` states.
   */
  thresholds: readonly number[];
  /** Extra distance past a boundary before the state may change. */
  band: number;
}

/**
 * The state `value` falls into with no history (plain nearest-bin lookup).
 * Seeds a latch on first measurement, when there is nothing to be sticky to.
 */
export function seedBandLatch(value: number, thresholds: readonly number[]): number {
  if (!Number.isFinite(value)) return 0;
  let state = 0;
  while (state < thresholds.length && value >= thresholds[state]) state += 1;
  return state;
}

/**
 * Advance a discrete-state latch. The state moves up past boundary k only
 * when `value > thresholds[k] + band`, down only when
 * `value < thresholds[k] − band`. A single step may cross several boundaries
 * (a jump), but noise inside ±band of a boundary never changes the state.
 */
export function stepBandLatch(current: number, value: number, options: BandLatchOptions): number {
  const { thresholds, band } = options;
  if (!Number.isFinite(value)) return current;
  let state = Math.min(Math.max(Math.round(current), 0), thresholds.length);
  while (state < thresholds.length && value > thresholds[state] + band) state += 1;
  while (state > 0 && value < thresholds[state - 1] - band) state -= 1;
  return state;
}

/** Nearest station with no history — `round`, clamped to the route. */
export function seedStationLatch(position: number, count: number): number {
  if (!Number.isFinite(position) || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(position)));
}

/**
 * Hysteretic nearest station over `count` stations at integer positions —
 * `stepBandLatch` with boundaries at every n + 0.5, computed without an
 * array so it can run per frame and per scroll sample for free.
 */
export function stepStationLatch(
  current: number,
  position: number,
  count: number,
  band: number = NEAREST_STATION_BAND,
): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(position)) return Math.min(count - 1, Math.max(0, current));
  const last = count - 1;
  let state = Math.min(last, Math.max(0, Math.round(current)));
  if (position > state + 0.5 + band) {
    // Largest n with position > (n − 1) + 0.5 + band.
    state = Math.min(last, Math.ceil(position + 0.5 - band) - 1);
  } else if (position < state - 0.5 - band) {
    // Smallest n with position < n + 0.5 − band.
    state = Math.max(0, Math.floor(position - 0.5 + band) + 1);
  }
  return state;
}

// ── Direction latch ─────────────────────────────────────────────────────────

export type TravelDirection = -1 | 0 | 1;

export interface DirectionLatchState {
  /** Latched travel direction; 0 until the first real movement, or at rest. */
  direction: TravelDirection;
  /**
   * Furthest value reached in the latched direction (or the rest anchor while
   * the direction is 0). Reversal is measured as retreat from this point, so
   * slow drift and fast flicks are judged by the same displacement.
   */
  extreme: number;
  /** Time (s) the current direction was latched. */
  since: number;
  /** Time (s) of the last sample that moved the extreme. */
  lastMove: number;
}

export interface DirectionLatchOptions {
  /** Displacement that must be exceeded to leave rest or to reverse. */
  deadband: number;
  /** Minimum time (s) a latched direction holds before it may reverse. */
  minDwell: number;
  /**
   * Optional time (s) without forward movement after which the latch returns
   * to rest (0). Omit to keep the last direction indefinitely.
   */
  idleAfter?: number;
}

export function createDirectionLatch(value: number, time: number): DirectionLatchState {
  return { direction: 0, extreme: value, since: time, lastMove: time };
}

/**
 * Advance a direction latch with one sample. Returns a new state object only
 * when something changed, so a caller can compare by identity.
 *
 * - At rest, the direction latches once the value leaves the rest anchor by
 *   more than `deadband`.
 * - While latched, moving further in the same direction extends the extreme.
 *   Retreating more than `deadband` from the extreme reverses the direction,
 *   but only once the current direction has been held for `minDwell` seconds.
 *   Noise inside the deadband — or a single overshoot sample — never flips it.
 */
export function stepDirectionLatch(
  state: DirectionLatchState,
  value: number,
  time: number,
  options: DirectionLatchOptions,
): DirectionLatchState {
  if (!Number.isFinite(value)) return state;
  const { deadband, minDwell, idleAfter } = options;

  if (state.direction === 0) {
    const delta = value - state.extreme;
    if (Math.abs(delta) <= deadband) return state;
    return { direction: delta > 0 ? 1 : -1, extreme: value, since: time, lastMove: time };
  }

  const d = state.direction;
  const ahead = (value - state.extreme) * d;
  if (ahead > 0) {
    return { direction: d, extreme: value, since: state.since, lastMove: time };
  }
  if (-ahead > deadband && time - state.since >= minDwell) {
    return { direction: d === 1 ? -1 : 1, extreme: value, since: time, lastMove: time };
  }
  if (idleAfter !== undefined && time - state.lastMove >= idleAfter) {
    return { direction: 0, extreme: value, since: time, lastMove: time };
  }
  return state;
}

// ── Input-intent override ───────────────────────────────────────────────────

/**
 * Held input intent (wave-2 r2, W6): the sign of the visitor's own discrete
 * input (wheel / key steps) and how many consecutive steps carried it.
 *
 * `stepDirectionLatch` only re-evaluates on a scroll sample and holds a fresh
 * direction for `minDwell`, so it went stale in two measured cases: a forward
 * step right after a backward jitter step lagged ~230 ms (dwell), and at the
 * scroll-end clamp the latch stayed reversed until rest decay — `exact` sat
 * on the clamp, no scroll sample arrived, yet the input kept saying forward
 * and `smooth` kept advancing. The override lets the latch follow the input
 * once the sign has PERSISTED (≥ `minRun` steps, so an alternating dither
 * never qualifies) AND `smooth` has actually moved `eps` that way.
 */
export interface InputIntentState {
  /** Sign of the current run of input steps; 0 before any input. */
  sign: TravelDirection;
  /** Consecutive input steps carrying `sign`. */
  run: number;
  /** Time (s) of the latest input step. */
  at: number;
  /**
   * Least-advanced `smooth` (in `sign`) since the run began: movement is
   * measured from here, so a follower still coasting the old way when the
   * run starts does not have to recover its overshoot first.
   */
  anchor: number;
}

export interface InputIntentOptions {
  /** Consecutive same-sign input steps required before the override may act. */
  minRun: number;
  /** Displacement of `smooth` in the input's sign required (station units). */
  eps: number;
  /** Input older than this (s) no longer counts as held. */
  staleAfter: number;
}

export function createInputIntent(): InputIntentState {
  return { sign: 0, run: 0, at: Number.NEGATIVE_INFINITY, anchor: 0 };
}

/** Record one discrete input step of `sign` at `time`, with the current `smooth`. */
export function stepInputIntent(state: InputIntentState, sign: -1 | 1, smooth: number, time: number): InputIntentState {
  if (!Number.isFinite(smooth)) return state;
  if (sign === state.sign) {
    const anchor = sign > 0 ? Math.min(state.anchor, smooth) : Math.max(state.anchor, smooth);
    return { sign, run: state.run + 1, at: time, anchor };
  }
  return { sign, run: 1, at: time, anchor: smooth };
}

export interface InputIntentResolution {
  /** The intent with its anchor advanced (same object when unchanged). */
  state: InputIntentState;
  /** Direction the latch must take now, or null to leave it alone. */
  flip: -1 | 1 | null;
}

/**
 * Per-frame check: flip a latched direction that points AGAINST the held
 * input once the input has persisted and `smooth` has moved `eps` with it.
 * Never acts on a direction of 0 (rest decay stays the latch's own business)
 * and never on stale input.
 */
export function resolveInputIntent(
  state: InputIntentState,
  direction: TravelDirection,
  smooth: number,
  time: number,
  options: InputIntentOptions,
): InputIntentResolution {
  if (state.sign === 0 || !Number.isFinite(smooth)) return { state, flip: null };
  const sign = state.sign;
  const anchor = sign > 0 ? Math.min(state.anchor, smooth) : Math.max(state.anchor, smooth);
  const next = anchor === state.anchor ? state : { ...state, anchor };
  if (
    direction === -sign &&
    next.run >= options.minRun &&
    time - next.at <= options.staleAfter &&
    (smooth - next.anchor) * sign >= options.eps
  ) {
    return { state: next, flip: sign };
  }
  return { state: next, flip: null };
}

// ── Dwell latch ─────────────────────────────────────────────────────────────

export interface DwellLatchState<T> {
  value: T;
  /** Time (s) the current value was latched. */
  since: number;
}

/**
 * Accept `proposed` only once the current value has been held for `minDwell`
 * seconds; until then the current value stands. For behaviour state
 * machines (walk / idle / turn) that must not stutter between states.
 */
export function stepDwellLatch<T>(
  state: DwellLatchState<T>,
  proposed: T,
  time: number,
  minDwell: number,
): DwellLatchState<T> {
  if (Object.is(state.value, proposed)) return state;
  if (time - state.since < minDwell) return state;
  return { value: proposed, since: time };
}

// ── Monotone phase latch ────────────────────────────────────────────────────

/**
 * A ranked phase that only ever advances (e.g. loading → opening → beam →
 * presented) until `token` differs from `previousToken` (a new scene
 * generation), which resets it to `proposed` unconditionally. Unknown
 * phases are ignored.
 */
export function stepMonotonePhase<P extends string>(
  order: readonly P[],
  current: P,
  proposed: P,
  token: number,
  previousToken: number,
): P {
  if (token !== previousToken) return order.includes(proposed) ? proposed : current;
  const from = order.indexOf(current);
  const to = order.indexOf(proposed);
  if (to < 0) return current;
  return to > from ? proposed : current;
}
