'use client';

/**
 * Scene readiness — the handshake between "the device can run the 3D world"
 * and "the 3D world is actually on screen".
 *
 * Capability detection (`detectTier`) answers the first question only. Hiding
 * the semantic page on the capability answer alone leaves a blank interval for
 * as long as the scene chunk, models and environment take to arrive, so the
 * route-tier presentation is committed on THIS signal instead.
 *
 * Module scope for the same reason as the tier/override stores: the consumers
 * (`WorldStateProvider`, the canvas reporter, the recovery control) sit on
 * opposite sides of the R3F reconciler boundary, where React context does not
 * cross, and `useSyncExternalStore` needs a referentially stable snapshot.
 */

/**
 * `idle` — no scene attempt yet (server, first paint, Lite).
 * `loading` — a scene generation is mounting/streaming.
 * `presented` — that generation painted and settled; safe to hand over the page.
 * `failed` — it errored or timed out; the semantic page stays and recovery is offered.
 */
export type ScenePhase = 'idle' | 'loading' | 'presented' | 'failed';

/** Frames the scene must keep painting before it counts as presented. */
export const SCENE_PRESENT_SETTLE_MS = 250;

/**
 * Finite readiness deadline (D1, raised by D23 "complete at reveal"). Past
 * this the world stops holding the page hostage: it degrades to the semantic
 * presentation (Lite) and offers a retry. D23 moved every station's assets,
 * programs and uploads INTO the ceremony, so the product deadline is 20 s
 * (the prod desktop target is <= 12 s); a device that cannot finish in 20 s
 * gets Lite, never a partially loaded world.
 */
export const SCENE_READY_TIMEOUT_MS = 20_000;

/**
 * No-progress stall detector (D23): while a generation is loading (renderer
 * up, reveal not yet armed), if NO sub-progress signal advances for this long
 * the attempt is abandoned to Lite (`readiness-stall`) instead of waiting out
 * the whole deadline. The signals are the loading manager's items and bytes,
 * the renderer's program count and ready count, uploaded textures,
 * residency, the warm ceremony's stage and pose renders, and the milestone
 * count (`scene-progress` `noteLoadSignal`). Slow-but-moving is never a
 * stall: any one signal rising resets the window.
 */
export const READINESS_STALL_MS = 6_000;

/** One stall-detector state: the last signal values seen and when any rose. */
export interface StallState {
  /** Highest value seen per signal name. */
  signals: Readonly<Record<string, number>>;
  /** `performance.now()` of the last rise of any signal (the window start). */
  lastProgressAt: number;
}

export interface StallSample {
  nowMs: number;
  /** Current values; omitted names keep their last value (no progress). */
  signals?: Readonly<Record<string, number>>;
}

export function createStallState(nowMs: number): StallState {
  return { signals: {}, lastProgressAt: nowMs };
}

/**
 * One pure step of the stall detector. A signal counts as progress when its
 * value rises above the highest value seen for it (a first sighting of a
 * signal with a positive value is progress too). Returns the same `state`
 * object when nothing rose, and `stalled` once `READINESS_STALL_MS` has
 * passed since the last rise.
 */
export function stepStallDetector(
  state: StallState,
  sample: StallSample,
  stallMs: number = READINESS_STALL_MS,
): { state: StallState; stalled: boolean } {
  let next = state;
  if (sample.signals) {
    for (const [name, value] of Object.entries(sample.signals)) {
      if (!Number.isFinite(value)) continue;
      const previous = next.signals[name];
      const rose = previous === undefined ? value > 0 : value > previous;
      if (previous === undefined || value > previous) {
        next = {
          signals: { ...next.signals, [name]: previous === undefined ? value : Math.max(previous, value) },
          lastProgressAt: rose ? sample.nowMs : next.lastProgressAt,
        };
      }
    }
  }
  return { state: next, stalled: sample.nowMs - next.lastProgressAt >= stallMs };
}

/**
 * DEBUG-ONLY capture relaxation (review r2, design decision): `next dev`
 * compile plus capture load on the shared GPU box can push the first
 * presentation past the deadline, which would hold NON-W7 visual evidence hostage to
 * dev compile speed. `?routeDebug=1&readyDeadlineMs=N` widens the deadline to
 * N, clamped to this range, and ONLY outside a production build — in
 * production (`process.env.NODE_ENV === 'production'`, inlined at build time)
 * the resolver returns `SCENE_READY_TIMEOUT_MS` unconditionally, so the real
 * product deadline is untouched (pinned by test). The W7 evidence itself is
 * captured WITHOUT the param.
 */
export const READY_DEADLINE_RELAX_RANGE = { minMs: 20_000, maxMs: 45_000 } as const;

export interface ReadyDeadline {
  /** The readiness deadline in force for the generation, ms. */
  deadlineMs: number;
  /** True only when the debug capture relaxation widened it. */
  relaxed: boolean;
}

const PRODUCT_DEADLINE: ReadyDeadline = { deadlineMs: SCENE_READY_TIMEOUT_MS, relaxed: false };

/**
 * Pure resolver for the deadline in force. `nodeEnv` is passed in (the
 * store passes the build-inlined `process.env.NODE_ENV`) so the production
 * guard is unit-testable; `search` is `location.search`.
 */
export function resolveReadyDeadline(nodeEnv: string | undefined, search: string): ReadyDeadline {
  if (nodeEnv === 'production') return PRODUCT_DEADLINE;
  const params = new URLSearchParams(search);
  if (params.get('routeDebug') !== '1') return PRODUCT_DEADLINE;
  const raw = params.get('readyDeadlineMs');
  if (raw === null || raw.trim() === '') return PRODUCT_DEADLINE;
  const requested = Number(raw);
  if (!Number.isFinite(requested)) return PRODUCT_DEADLINE;
  const deadlineMs = Math.round(
    Math.min(READY_DEADLINE_RELAX_RANGE.maxMs, Math.max(READY_DEADLINE_RELAX_RANGE.minMs, requested)),
  );
  return deadlineMs === SCENE_READY_TIMEOUT_MS ? PRODUCT_DEADLINE : { deadlineMs, relaxed: true };
}

/** Deadline of the current generation (re-resolved at every generation start). */
let readyDeadline: ReadyDeadline = PRODUCT_DEADLINE;
let relaxLogged = false;

function resolveCurrentDeadline(): ReadyDeadline {
  if (process.env.NODE_ENV === 'production') return PRODUCT_DEADLINE;
  if (typeof window === 'undefined') return PRODUCT_DEADLINE;
  const resolved = resolveReadyDeadline(process.env.NODE_ENV, window.location.search);
  if (resolved.relaxed && !relaxLogged) {
    relaxLogged = true;
    console.info(`[route-readiness] deadline relaxed for capture: ${resolved.deadlineMs} ms`);
  }
  return resolved;
}

/**
 * The readiness deadline (ms) in force for the current generation — every
 * consumer (the store's late-present refusal, the provider's Lite deadline,
 * the reveal clamp, the ball's lifetime) reads THIS, never the constant, so
 * a relaxed debug capture stays self-consistent. Production: always
 * `SCENE_READY_TIMEOUT_MS`.
 */
export function getReadyDeadlineMs(): number {
  return readyDeadline.deadlineMs;
}

/** Whether the debug capture relaxation is in force (trace only). */
export function isReadyDeadlineRelaxed(): boolean {
  return readyDeadline.relaxed;
}

let phase: ScenePhase = 'idle';

/**
 * Monotonic scene generation. A theme or route change starts a new one, so a
 * late completion from an abandoned scene can never present itself as ready —
 * the reporter compares the generation it captured at its first painted frame
 * before writing.
 */
let generation = 0;

/**
 * The theme key the current generation was begun for, or null while none is
 * in flight. `beginSceneGeneration` is idempotent while the SAME theme is
 * already loading: the provider's (theme, tier) effect and a retry re-entry
 * ask for a generation inside one round trip, and a double bump would strand
 * the canvas reporter one generation stale — `presented` would never commit
 * and the readiness deadline would kill a healthy scene (PR #63 review).
 */
let loadingThemeKey: string | null = null;

/**
 * Wall-clock (`performance.now()`) stamps for the loader's reveal gate and the
 * debug trace: when the phase last changed, and when the current generation
 * began loading. The reveal gate's hard cap is measured from the first, and
 * clamped to the readiness deadline measured from the second, so no loader
 * dwell can outlive the budget the deadline already grants (W7 / D3).
 */
let phaseChangedAt = 0;
let generationBegunAt = 0;

/**
 * Why the current generation is `failed`: `late-present` when the store
 * itself refused a presentation that landed past the readiness deadline
 * (the provider resolves that to Lite `readiness-timeout`); `error` for every
 * caller-reported failure (scene error, context loss, ladder exhaustion),
 * whose caller degrades with its own reason. Null while not failed.
 */
export type SceneFailure = 'late-present' | 'error';
let failure: SceneFailure | null = null;

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Why a scene attempt failed, as the CALLER saw it (review r5, trace only):
 * `failure` above folds every caller-reported failure into `error`, and the
 * phase itself is reset to `idle` as soon as the tier flips Lite — so a
 * context-loss run read `idle` in the trace with no record of why Lite
 * appeared. The last fault is sticky (it survives the reset) and every phase
 * change is logged with its time.
 */
export type SceneFaultReason =
  | 'context-lost'
  | 'scene-error'
  | 'sustained-pressure'
  | 'late-present'
  /** D23: the deadline passed with the world presented but not complete (never a partial reveal). */
  | 'readiness-timeout'
  /** D23: no load signal advanced for `READINESS_STALL_MS`. */
  | 'readiness-stall';

export interface SceneFault {
  reason: SceneFaultReason;
  generation: number;
  at: number;
}

let lastFault: SceneFault | null = null;

export interface ScenePhaseEntry {
  phase: ScenePhase;
  generation: number;
  t: number;
}

const PHASE_TRACE_MAX = 32;
let phaseTrace: ScenePhaseEntry[] = [];

function setPhase(next: ScenePhase): void {
  if (phase === next) return;
  phase = next;
  if (next !== 'failed') failure = null;
  phaseChangedAt = now();
  phaseTrace.push({ phase: next, generation, t: phaseChangedAt });
  if (phaseTrace.length > PHASE_TRACE_MAX) phaseTrace = phaseTrace.slice(-PHASE_TRACE_MAX);
  notify();
}

/** The most recent scene fault (sticky across resets; trace only). */
export function getLastSceneFault(): SceneFault | null {
  return lastFault;
}

/** Time-stamped scene phase changes, oldest first (bounded; trace only). */
/**
 * R6 (trace): every generation bump with who asked — a begin (with its key)
 * or a reset (with its reason) — so a run that presents on generation N can
 * show what bumped 1..N-1 (the phase trace only sees phase CHANGES, and a
 * reset of an idle store changes none). Bounded, oldest first.
 */
export interface GenerationLogEntry {
  t: number;
  generation: number;
  kind: 'begin' | 'reset';
  /** The begun key, or the reset's reason ('tier' when none was given). */
  detail: string;
  /** The phase before the call. */
  from: ScenePhase;
}

const GENERATION_LOG_MAX = 24;
let generationLog: GenerationLogEntry[] = [];

function noteGeneration(kind: GenerationLogEntry['kind'], detail: string, from: ScenePhase): void {
  generationLog = [...generationLog, { t: Math.round(now() * 10) / 10, generation, kind, detail, from }].slice(-GENERATION_LOG_MAX);
}

export function getGenerationLog(): GenerationLogEntry[] {
  return generationLog;
}

export function getScenePhaseTrace(): ScenePhaseEntry[] {
  return phaseTrace.map((entry) => ({ ...entry }));
}

export function subscribeScenePhase(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function getScenePhase(): ScenePhase {
  return phase;
}

/** The server and the first client paint have attempted no scene. */
export function getServerScenePhase(): ScenePhase {
  return 'idle';
}

export function currentSceneGeneration(): number {
  return generation;
}

/** `performance.now()` of the last phase change (0 before any). */
export function getPhaseChangedAt(): number {
  return phaseChangedAt;
}

/** Why the current generation failed (null unless the phase is `failed`). */
export function getSceneFailure(): SceneFailure | null {
  return failure;
}

/**
 * Visitor anchor (review r3): an attempt interrupted by an UNMOUNT reset
 * while loading (StrictMode's simulated unmount, a provider remount) and
 * re-begun within this window is the SAME attempt from the visitor's point of
 * view — the ball and the page have been showing "loading" since the first
 * begin. The re-begun generation keeps the earlier start, so the product
 * deadline, the reveal clamp and the ball's lifetime all measure from what
 * the visitor saw (r2 timeout run: the first loading sample preceded
 * `generationBegunAt` by 19 ms, and the ball's lifetime was 8 ms over the
 * deadline as seen). A tier/theme reset (`reason` omitted) never chains.
 */
export const ATTEMPT_CHAIN_MS = 250;

/** Start of the loading attempt an unmount reset interrupted, null when none. */
let interruptedBegunAt: number | null = null;
let interruptedAt = 0;

/**
 * `performance.now()` at which the current attempt began loading — the
 * visitor anchor (an unmount-chained re-begin keeps the first start). Every
 * deadline consumer reads this: the late-present refusal, the provider's
 * Lite deadline, the reveal clamp and the ball's lifetime.
 */
export function getGenerationBegunAt(): number {
  return generationBegunAt;
}

/**
 * Start a new scene generation — called when the resolved theme changes or the
 * route tier (re)enters, so readiness never leaks across worlds. Idempotent
 * while a generation for the SAME `themeKey` is already loading: returns null
 * (no bump, no phase change) so one (theme, route-tier) entry is exactly one
 * generation no matter how many callers ask inside the same commit.
 */
export function beginSceneGeneration(themeKey: string): number | null {
  if (phase === 'loading' && loadingThemeKey === themeKey) return null;
  generation += 1;
  noteGeneration('begin', themeKey, phase);
  loadingThemeKey = themeKey;
  const at = now();
  // Visitor anchor: continue an attempt an unmount reset just interrupted.
  const chained =
    phase === 'idle' &&
    interruptedBegunAt !== null &&
    at - interruptedAt >= 0 &&
    at - interruptedAt <= ATTEMPT_CHAIN_MS;
  generationBegunAt = chained && interruptedBegunAt !== null ? Math.min(interruptedBegunAt, at) : at;
  interruptedBegunAt = null;
  readyDeadline = resolveCurrentDeadline();
  // Notify even when the phase is unchanged: the generation moved, and the
  // provider's readiness deadline re-arms on it — a mid-load theme switch
  // must not inherit the abandoned attempt's remaining budget (PR #63
  // review).
  if (phase === 'loading') notify();
  else setPhase('loading');
  return generation;
}

/**
 * Reset to the no-attempt state (leaving route tier, unmounting the world).
 * `reason: 'unmount'` marks the provider's unmount cleanup, whose immediate
 * re-begin continues the visitor's attempt (see `ATTEMPT_CHAIN_MS`).
 */
export function resetSceneReadiness(reason?: 'unmount'): void {
  if (reason === 'unmount' && phase === 'loading') {
    interruptedBegunAt = Math.min(generationBegunAt, interruptedBegunAt ?? generationBegunAt);
    interruptedAt = now();
  } else {
    interruptedBegunAt = null;
  }
  generation += 1;
  noteGeneration('reset', reason ?? 'tier', phase);
  loadingThemeKey = null;
  setPhase('idle');
}

/**
 * The current generation painted and settled. Enforced by WALL CLOCK
 * (review r2): a presentation that lands more than the readiness deadline (`getReadyDeadlineMs()`)
 * after the generation began is refused and marks the attempt failed
 * (`late-present`) instead — so a long task that pre-empts the provider's
 * deadline timer can no longer let a late `presented` win over the timeout
 * and skip the Lite floor. Returns whether the presentation was accepted.
 */
export function markScenePresented(): boolean {
  if (phase === 'loading' && now() - generationBegunAt > readyDeadline.deadlineMs) {
    failure = 'late-present';
    lastFault = { reason: 'late-present', generation, at: now() };
    setPhase('failed');
    return false;
  }
  setPhase('presented');
  return true;
}

/**
 * A caller-reported failure. `reason` is recorded for the trace
 * (`getLastSceneFault()`); the store's own `failure` stays `error`.
 */
export function markSceneFailed(reason: SceneFaultReason = 'scene-error'): void {
  if (phase !== 'failed') failure = 'error';
  lastFault = { reason, generation, at: now() };
  setPhase('failed');
}
