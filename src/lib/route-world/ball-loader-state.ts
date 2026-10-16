/**
 * Pokéball loading ceremony — the pure state machine behind `BallLoader`
 * (W7, spec §5.5 invariants, design decisions D1–D3).
 *
 * The ball is a PRESENTATION of the scene readiness handshake, never a gate on
 * it: every failure path (readiness timeout → Lite, context loss, scene error,
 * ladder exhaustion) aborts the ball in the same step it becomes observable,
 * and the abort is a short fade over a page that is already the Lite page — so
 * the ball can never delay or block the fallback.
 *
 * Motion contract:
 * - Wobbles are driven by REAL readiness milestones (canvas chunk, renderer,
 *   assets idle, programs compiled, uploads done, first frame —
 *   `scene-progress.ts`): exactly ONE wobble per
 *   milestone the count rises by (wave 2, 1:1 — a burst of two milestones in
 *   one step is two wobbles). Rocks never overlap: a rise during a rock is
 *   queued behind it and a backlog drains at the faster tempo
 *   (`wobblePlan`). The reveal still preempts the rock in flight and drops
 *   the queue, so milestones can only ever shorten the wait, never extend
 *   it. There is no timer-driven shake anywhere.
 * - Every time-based transition (ceremony beats, abort fade, deadline) is
 *   measured in wall-clock milliseconds passed in as `nowMs`, never frames.
 *
 * Deadline budget (review r2, r3): the whole ball lifetime is bounded by
 * the scene readiness deadline measured from the ATTEMPT START (`begunAtMs`,
 * the visitor anchor — world-readiness), minus a safety margin
 * (`deadlineMarginMs`) so one late timer or frame cannot carry a ball pixel
 * across it. D23: the provider arms the reveal only for a COMPLETE world
 * (`revealGate`), never on a cap, and never at or after `revealArmLastAt`. A
 * reveal armed too late for it still plays the ceremony, time-SCALED into
 * the life that is left (`ceremonyPlan` mode `short`, wave 2 — the r5
 * sakura-1440 arm landed 1.3 s late and lost its beam to the crossfade);
 * only when less than `shortMinMs` of ball life remains (or motion is
 * reduced) does the 200 ms crossfade play (`quick`). Every beat is clamped
 * to the life end.
 *
 * Ceremony order (r3): `loading → opening → releasing → done`, one phase per
 * step, on the machine clock anchored at the gate's arm — a beat whose slot
 * a stall swallowed is compressed, never skipped, and nothing waits on a DOM
 * event. Wave 2 (W7 escalation, change of technique): the VISUALS are one
 * pre-scheduled compositor timeline — every beat (the ≤ 640 px flight to
 * centre, the click, the hinge, the beam, the canvas fade-in, the ball's
 * exit) is a transform/opacity CSS animation with an `animation-delay`
 * offset off the ONE commit that renders the arm, so a main-thread stall
 * (a shader link) cannot stutter it. These phases are logic and trace only:
 * they decide when the ball unmounts, and `done` is never earlier than the
 * CSS timeline's real end once its start is known (`timelineAt`, read from
 * the running animation's `startTime`).
 *
 * Aborts need a REAL failure signal (route tier lost, which covers the
 * readiness timeout, context loss, ladder exhaustion and navigation to a
 * DOM-only world; or `phase === 'failed'`). A transient `idle` (a StrictMode
 * double-mount's layout cleanup, a provider remount) or a generation bump is
 * NOT a failure: the ball holds, or re-baselines on the new attempt, and the
 * deadline stays the backstop (round-1 regression: a treated-as-torn-down
 * `idle` and the ball's own cap aborted healthy attempts that then went live
 * with no ceremony).
 *
 * Pure and framework-free so the whole contract is unit-tested in the node
 * environment; the component only feeds inputs and schedules the next wake.
 */

import type { Locale } from '@/i18n/config';
import { getMessages, interpolate } from '@/i18n/core';
import { worldRouteMessages } from '@/i18n/messages/world-route';

export type BallPhase = 'hidden' | 'loading' | 'opening' | 'releasing' | 'done' | 'aborted';

/** Structural mirror of `ScenePhase` (world-readiness) — lib stays free of component imports. */
export type BallScenePhase = 'idle' | 'loading' | 'presented' | 'failed';

export const BALL_TIMING = {
  /**
   * The ball flies from its chip dock to screen centre BEFORE the click, so
   * the burst always fires centre-screen (D2; wave 2 at ≤ 640 px, every
   * width since wave-2 r3 — the 1440 burst fired from a docked corner over
   * the page). Every other beat is offset by this lead (`--ball-lead` in
   * CSS). `ceremonyPlan` scales it with the rest of the lead-in when the
   * arm lands late. `ceremonyPlan` keeps a `flight` input for the pure
   * contract; the component always passes true.
   */
  flightMs: 260,
  /**
   * Reveal → the lid starts to swing (the CSS `lidOpen` delay in
   * BallLoader.module.css, after the flight lead — keep in step; pinned by
   * the handoff contract test). On wide screens the ball opens IN ITS DOCK
   * (review r3); at ≤ 640 px it first flies to centre (`flightMs`) — the
   * one moment it crosses the page, as D2 allows at the ceremony.
   */
  hingeStartMs: 100,
  /**
   * Reveal → release: the click and the hinge, then the capture-release
   * beam fires and the canvas starts fading in under it. The beam, the
   * canvas fade and the ball's exit are all CSS delays off ONE commit (the
   * ball's `data-revealing` renders from the same `routeSceneLive` that
   * writes `html[data-route-handoff]`), so they stay in step on the
   * compositor even when the main thread stalls. The machine's `opening →
   * releasing` step mirrors this on the wall clock (no latch to wait on).
   */
  handoffMs: 240,
  /**
   * Release → ball gone: the beam's longest beat (shafts and sparks,
   * ≤ 700 ms) and the canvas fade (520 ms) finish inside it, so nothing is
   * unmounted mid-animation.
   */
  releaseMs: 820,
  /** Whole ceremony budget, reveal → ball gone (= handoffMs + releaseMs). */
  openMs: 1060,
  /**
   * A release beat entered late (a main-thread stall swallowed its slot) is
   * COMPRESSED to at least this long, never skipped (review r3): every
   * presented generation passes opening → releasing → done in order.
   */
  minReleaseMs: 200,
  /**
   * Release -> the end of the beam's PEAK (review r4, sakura showed no
   * beam): the shafts hold full intensity until +350 ms after the release
   * (BallLoader.module.css `beamRay`). On the full ceremony the ball is
   * never unmounted before the beam started from the reveal COMMIT
   * (`revealCommitAt`) has passed this peak, however late the machine's own
   * clock (anchored at the arm) says the release was.
   */
  beamPeakMs: 350,
  /**
   * Hard wall-clock bound on `releasing` (review r4: a ball sat in
   * `releasing` for 30 s after `world-route-live`). Whatever the anchors
   * say, `releasing` ends at most this long after it was entered.
   */
  releaseBoundMs: 820 + 500,
  /**
   * Hard wall-clock bound on `opening` past its authored lead-in (wave-2
   * r3): the phase mirrors the CSS timeline's real start, but a start read
   * absurdly late can never hold the ball half open — `opening` ends at most
   * this long after it was entered plus the scaled lead-in.
   */
  openingSlackMs: 500,
  /**
   * A late arm still gets the time-scaled ceremony (flight, click, hinge, a
   * shortened beam) while at least this much ball life remains; below it,
   * the quick crossfade (wave 2). At this floor the scale is ≈ 0.45–0.57,
   * so the beam's shafts still burn ≈ 300–400 ms.
   */
  shortMinMs: 600,
  /** One milestone rock (the `wobble` keyframes; BallLoader.module.css). */
  wobbleMs: 620,
  /** A rock played while a backlog drains (`wobblePlan`, `data-wobble="fast"`). */
  wobbleFastMs: 340,
  /** Reduced motion / no budget left: static ball, one opacity crossfade, no beam. */
  reducedFadeMs: 200,
  /** Any failure path: immediate fade over the (already Lite) page. */
  abortFadeMs: 150,
  /**
   * The ball is GONE this long before the readiness deadline (review r3:
   * the r2 timeout run left the ball 11 ms inside and aborted 6 ms past the
   * deadline). One late timer or frame (≤ 80 ms, property-tested) can no
   * longer carry any ball pixel across it.
   */
  deadlineMarginMs: 100,
  /**
   * The ball's lifetime bound, measured from the ATTEMPT START
   * (`getGenerationBegunAt()` — the visitor anchor, see world-readiness).
   * Equal to the scene readiness deadline (`SCENE_READY_TIMEOUT_MS`,
   * asserted by test): 20 s since D23 (complete at reveal).
   */
  maxLoadingMs: 20_000,
} as const;

/**
 * Reveal gate (D3, rewritten for D23 "complete at reveal"): the current
 * generation is `presented` AND its assets are idle AND every world
 * population is resident AND the load warm (programs incl. shadow and pass
 * variants, texture uploads, pose renders) is complete. There is NO cap and
 * NO partial reveal: the r2 `assetsCapMs` and the `lateArm` shortcut are
 * gone. A world that is not complete by the last arm point
 * (`revealArmLastAt`) is never revealed; the readiness deadline sends the
 * visitor to Lite instead.
 */
/**
 * How the reveal plays (wave 2): `full`, the authored timeline; `short`, the
 * same beats time-scaled by `scale` (< 1) into the ball life that is left;
 * `quick`, reduced motion or less than `shortMinMs` left: the 200 ms
 * crossfade, no beam.
 */
export type CeremonyMode = 'full' | 'short' | 'quick';

export interface CeremonyPlan {
  mode: CeremonyMode;
  /**
   * Time scale of the PRE-release beats — the flight, the click, the hinge
   * (reveal → `handoffMs`, lead included). 1 on full and quick.
   */
  scale: number;
  /**
   * Time scale of the RELEASE beats — the beam, the canvas fade, the pop
   * (`handoffMs` → `openMs`). Wave-2 r2: a short ceremony squeezes the
   * lead-in first, so the red/white release keeps at least `shortMinMs` of
   * its own (`releaseMs × beamScale ≥ shortMinMs`). 1 on full and quick.
   */
  beamScale: number;
  /** Unscaled flight lead (`flightMs` at ≤ 640 px, else 0; 0 on quick). */
  leadMs: number;
  /** Reveal → last beat over, scale applied (the crossfade on quick). */
  totalMs: number;
}

export interface CeremonyPlanInput {
  /** Start of the reveal timeline (the gate's arm). */
  armedAtMs: number;
  begunAtMs: number;
  deadlineMs: number;
  reducedMotion: boolean;
  /** ≤ 640 px: the ball flies from the HUD dock to centre first. */
  flight: boolean;
}

/** Unscaled reveal → ball gone on the full ceremony, flight included when it plays. */
export function fullCeremonyMs(flight: boolean): number {
  return (flight ? BALL_TIMING.flightMs : 0) + BALL_TIMING.openMs;
}

/**
 * The one decision the render (the CSS timeline in the arm commit) and the
 * machine (the unmount) share, so both pick the same timeline. Pure in its
 * inputs; the scale is floored to 1/100 so a scaled ceremony always ends at
 * or before the ball's life end.
 */
export function ceremonyPlan(input: CeremonyPlanInput): CeremonyPlan {
  const quick: CeremonyPlan = {
    mode: 'quick',
    scale: 1,
    beamScale: 1,
    leadMs: 0,
    totalMs: BALL_TIMING.reducedFadeMs,
  };
  if (input.reducedMotion) return quick;
  const leadMs = input.flight ? BALL_TIMING.flightMs : 0;
  const full = leadMs + BALL_TIMING.openMs;
  const remaining = ballLifeEndAt(input.begunAtMs, input.deadlineMs) - input.armedAtMs;
  if (remaining >= full) return { mode: 'full', scale: 1, beamScale: 1, leadMs, totalMs: full };
  if (remaining >= BALL_TIMING.shortMinMs) {
    // Wave-2 r2 (sakura-1440 lost its beam on film): the lead-in (flight,
    // click, hinge) is squeezed FIRST, down to `SHORT_PRE_FLOOR` of its
    // length; the release keeps whatever that leaves, never less than
    // `shortMinMs` and never more than its authored `releaseMs`.
    const pre = leadMs + BALL_TIMING.handoffMs;
    const release = Math.min(
      remaining,
      BALL_TIMING.releaseMs,
      Math.max(BALL_TIMING.shortMinMs, remaining - pre * SHORT_PRE_FLOOR),
    );
    const beamScale = Math.floor((release / BALL_TIMING.releaseMs) * 100) / 100;
    const scale = Math.min(
      1,
      Math.floor((Math.max(0, remaining - BALL_TIMING.releaseMs * beamScale) / pre) * 100) / 100,
    );
    return {
      mode: 'short',
      scale,
      beamScale,
      leadMs,
      totalMs: pre * scale + BALL_TIMING.releaseMs * beamScale,
    };
  }
  return quick;
}

/**
 * The shortest the lead-in of a `short` ceremony is squeezed to (of its
 * authored length) before the release itself gives up time.
 */
export const SHORT_PRE_FLOOR = 0.35;

/**
 * Wave-2 r3 (the 1440 opening beat was compressed with 4 s of budget left):
 * with more than this much ball life left at the arm the plan is always the
 * FULL-length ceremony (`k = 1`, the whole opening hinge). Holds by
 * construction — the longest full ceremony (`fullCeremonyMs(true)`) is
 * shorter — and is pinned by test so a longer ceremony can never break it
 * silently.
 */
export const FULL_LENGTH_REMAINING_MS = 1500;

/**
 * Unscaled beat offset (from the reveal, lead included) → its offset on a
 * two-scale timeline: the pre-release part runs at `scale`, the release part
 * (past `handoffMs`) at `beamScale`. Shared by the machine and the tests; the
 * CSS writes the same sum (`(lead + 240ms) × --k + beat × --kb`).
 */
export function timelineOffsetMs(
  plan: Pick<CeremonyPlan, 'leadMs' | 'scale' | 'beamScale'>,
  beatMs: number,
): number {
  const pre = plan.leadMs + Math.min(beatMs, BALL_TIMING.handoffMs);
  const post = Math.max(0, beatMs - BALL_TIMING.handoffMs);
  return pre * plan.scale + post * plan.beamScale;
}

export interface BallState {
  phase: BallPhase;
  /** Scene generation the ball is presenting; -1 before any capture. */
  generation: number;
  /** `nowMs` at which the current phase was entered. */
  since: number;
  /** Wall-clock start of the presented generation — the deadline anchor. */
  begunAt: number;
  /**
   * The readiness deadline in force for that generation (ms). Always
   * `maxLoadingMs` in production; only the debug-only capture relaxation
   * (`getReadyDeadlineMs()`, never in a production build) widens it.
   */
  deadlineMs: number;
  /**
   * Start of the reveal timeline: the gate's arm time (the commit the CSS
   * beats run from), or the step time when unknown; -1 before the reveal.
   */
  openedAt: number;
  /**
   * When the machine entered `opening` — one microtask after the commit
   * that rendered `data-revealing`, i.e. the CSS beam's own time zero
   * (review r4). -1 before the reveal.
   */
  revealCommitAt: number;
  /**
   * HIGH-WATER milestone count for the captured generation (review r4,
   * phantom wobbles): a dip (a canvas remount releasing M1/M2, a render in
   * which the progress snapshot and the generation disagree) never lowers
   * it, so the climb back cannot replay a wobble. Only a rise above every
   * count this generation has published shakes the ball.
   */
  milestones: number;
  /** Monotone wobble counter — each increment is exactly one wobble. */
  shakes: number;
  /**
   * Every shake at or below this is dropped from the rock queue (wave 2):
   * set to `shakes` whenever the ball leaves `loading` (the reveal or an
   * abort preempts what is still queued), so a later attempt never replays
   * a previous attempt's unplayed rocks.
   */
  rockFloor: number;
  /** Latched when the ceremony starts, so a mid-ceremony toggle cannot re-time it. */
  reducedMotion: boolean;
  /**
   * Latched at the reveal: the crossfade plays instead of the ceremony
   * (reduced motion, or less than `shortMinMs` of ball life left), i.e.
   * `mode === 'quick'`; kept as its own flag for the trace and the harness.
   */
  quick: boolean;
  /** Latched at the reveal (`ceremonyPlan`); `full` before it. */
  mode: CeremonyMode;
  /** Latched pre-release beat time scale (`ceremonyPlan`); 1 before the reveal. */
  scale: number;
  /** Latched release beat time scale (`ceremonyPlan`); 1 before the reveal. */
  beamScale: number;
  /** Latched unscaled flight lead (`ceremonyPlan`); 0 before the reveal. */
  leadMs: number;
  /**
   * The CSS ceremony timeline's REAL start on the document timeline (the
   * anchor animation's `startTime`, same clock as `nowMs`), -1 until the
   * component has read it. A stall between the arm commit and the frame that
   * starts the animations delays the whole CSS timeline; `done` then waits
   * for its real end (still bounded by `releaseBoundMs` and the life end), so
   * the ball is never unmounted mid-beam.
   */
  timelineAt: number;
  /**
   * ENGINE-FIX (D32): the generation was begun AFTER a finished ceremony —
   * a day/night swap of a live world, which the theme veil covers (the only
   * path from `done` back to `loading`). Its reveal plays the SILENT plan:
   * `opening → releasing → done` one committed step each, no crossfade time,
   * so the veil can lift as soon as the new palette is warm. Latched in
   * `loading`; absent / false on every first reveal and retry.
   */
  silent?: boolean;
}

export interface BallInput {
  /** Route tier AND a route theme exists. DOM-only worlds are never active. */
  active: boolean;
  /** The provider's reveal gate armed for the current generation (D3). */
  armed: boolean;
  /** When the gate armed (the provider's latch), null while not armed. */
  armedAtMs: number | null;
  phase: BallScenePhase;
  generation: number;
  /** Wall-clock start of the current generation (`getGenerationBegunAt()`). */
  begunAtMs: number;
  /**
   * The readiness deadline in force (`getReadyDeadlineMs()`); omitted =
   * `BALL_TIMING.maxLoadingMs` (the production value).
   */
  deadlineMs?: number;
  /** Count of real readiness milestones reached by the current generation. */
  milestones: number;
  nowMs: number;
  reducedMotion: boolean;
  /** ≤ 640 px (the flight to centre plays); omitted = false. */
  flight?: boolean;
  /** The CSS timeline's observed start (see `BallState.timelineAt`); omitted / null = not read yet. */
  timelineAtMs?: number | null;
}

export const INITIAL_BALL: BallState = {
  phase: 'hidden',
  generation: -1,
  since: 0,
  begunAt: 0,
  deadlineMs: BALL_TIMING.maxLoadingMs,
  openedAt: -1,
  revealCommitAt: -1,
  milestones: 0,
  shakes: 0,
  rockFloor: 0,
  reducedMotion: false,
  quick: false,
  mode: 'full',
  scale: 1,
  beamScale: 1,
  leadMs: 0,
  timelineAt: -1,
};

/**
 * A REAL failure signal for the presented attempt: the route tier is gone
 * (readiness timeout, context loss, ladder exhaustion and a DOM-only
 * destination all flip it) or the scene reported `failed`. `idle` is
 * deliberately NOT one — see the module comment.
 */
function failing(input: BallInput): boolean {
  return !input.active || input.phase === 'failed';
}

/** A scene attempt is in flight that the ball should present. */
function attemptInFlight(input: BallInput): boolean {
  return input.active && (input.phase === 'loading' || input.phase === 'presented');
}

function deadlineAt(state: Pick<BallState, 'begunAt' | 'deadlineMs'>): number {
  return state.begunAt + state.deadlineMs;
}

/** The ball is gone by this wall-clock point: the deadline minus the safety margin. */
export function ballLifeEndAt(begunAtMs: number, deadlineMs: number): number {
  return begunAtMs + deadlineMs - BALL_TIMING.deadlineMarginMs;
}

function lifeEnd(state: Pick<BallState, 'begunAt' | 'deadlineMs'>): number {
  return ballLifeEndAt(state.begunAt, state.deadlineMs);
}

/**
 * Whether the full ceremony, armed at `armedAtMs`, still ends before the
 * ball's life end (deadline − margin) of the attempt begun at `begunAtMs`.
 * Shared by the reveal gate clamp and the ball's reveal so both pick the
 * same path.
 */
export function ceremonyFits(
  armedAtMs: number,
  begunAtMs: number,
  deadlineMs: number,
  flight = false,
): boolean {
  return armedAtMs + fullCeremonyMs(flight) <= ballLifeEndAt(begunAtMs, deadlineMs);
}

function enterLoading(prev: BallState, input: BallInput, silent = false): BallState {
  return {
    phase: 'loading',
    generation: input.generation,
    since: input.nowMs,
    begunAt: input.begunAtMs,
    deadlineMs: input.deadlineMs ?? BALL_TIMING.maxLoadingMs,
    openedAt: -1,
    revealCommitAt: -1,
    // Baseline at the current count: milestones reached before the ball was
    // up (or by an abandoned generation) never replay as wobbles.
    milestones: input.milestones,
    shakes: prev.shakes,
    rockFloor: prev.rockFloor,
    reducedMotion: input.reducedMotion,
    quick: input.reducedMotion,
    mode: input.reducedMotion ? 'quick' : 'full',
    scale: 1,
    beamScale: 1,
    leadMs: 0,
    timelineAt: -1,
    silent,
  };
}

/**
 * The reveal. `openedAt` is the gate's arm time when known: the CSS timeline
 * (flight, hinge, beam, canvas fade) starts on the commit that rendered the arm, so the
 * machine clock is anchored there too — a ball step that lands late after a
 * stall catches up instead of replaying the beats. Never EXITS in the same
 * step: every phase is committed (and published) on its own.
 */
function enterOpening(prev: BallState, input: BallInput, forceQuick = false): BallState {
  const openedAt = input.armedAtMs !== null ? Math.min(input.armedAtMs, input.nowMs) : input.nowMs;
  const plan = ceremonyPlan({
    armedAtMs: openedAt,
    begunAtMs: prev.begunAt,
    deadlineMs: prev.deadlineMs,
    reducedMotion: forceQuick || prev.silent === true || input.reducedMotion,
    flight: input.flight === true,
  });
  return {
    ...prev,
    phase: 'opening',
    since: input.nowMs,
    rockFloor: prev.shakes,
    openedAt,
    revealCommitAt: input.nowMs,
    milestones: Math.max(prev.milestones, input.milestones),
    reducedMotion: input.reducedMotion,
    quick: plan.mode === 'quick',
    mode: plan.mode,
    scale: plan.scale,
    beamScale: plan.beamScale,
    leadMs: plan.leadMs,
    timelineAt: -1,
  };
}

/** Unscaled beat offset → scaled offset from the reveal, flight lead included (two scales). */
function beatAt(state: Pick<BallState, 'leadMs' | 'scale' | 'beamScale'>, beatMs: number): number {
  return timelineOffsetMs(state, beatMs);
}

function enter(prev: BallState, phase: BallPhase, nowMs: number): BallState {
  // Leaving `loading` drops whatever rocks are still queued (`rockFloor`).
  return { ...prev, phase, since: nowMs, rockFloor: prev.shakes };
}

/** Reveal → ball gone for the latched plan (the crossfade on quick). */
export function ceremonyMs(
  state: Pick<BallState, 'reducedMotion' | 'quick'> & Partial<Pick<BallState, 'leadMs' | 'scale' | 'beamScale' | 'silent'>>,
): number {
  if (state.silent === true) return 0;
  if (state.reducedMotion || state.quick) return BALL_TIMING.reducedFadeMs;
  return beatAt(
    { leadMs: state.leadMs ?? 0, scale: state.scale ?? 1, beamScale: state.beamScale ?? state.scale ?? 1 },
    BALL_TIMING.openMs,
  );
}

/** Clamp a beat end into [since, life end]: a beat entered at or past the life end ends at once. */
function clampBeat(state: BallState, end: number): number {
  return Math.max(state.since, Math.min(end, lifeEnd(state)));
}

/**
 * When `opening` hands over to `releasing`: the authored hinge lead-in
 * (`handoffMs`) on the full ceremony, at once on the quick crossfade.
 * Machine clock only — there is no latch to wait on, so a half-open ball
 * can never be held on screen by a missing event (review r3).
 */
function releaseAt(state: BallState): number {
  const quick = state.quick || state.reducedMotion;
  if (quick) return clampBeat(state, state.openedAt);
  const lead = beatAt(state, BALL_TIMING.handoffMs);
  // Wave-2 r3 (the 1440 films had no `opening` sample: a step that landed
  // after a stall entered and left `opening` back to back). The machine now
  // MIRRORS the CSS timeline: the release is the hinge lead-in counted from
  // the timeline's real start once it was read (`timelineAt`), else from the
  // phase entry (≈ the reveal commit) — never from the arm alone, whose slot
  // a stall can have swallowed. Still clamped to the life end.
  const anchor = state.timelineAt >= 0 ? state.timelineAt : state.since;
  const mirrored = Math.max(state.openedAt + lead, anchor + lead);
  return clampBeat(state, Math.min(mirrored, state.since + lead + BALL_TIMING.openingSlackMs));
}

/**
 * When `releasing` ends (`done`): the authored end of the ceremony, but a
 * release entered late is compressed to at least `minReleaseMs` (the
 * crossfade on the quick path) — never skipped. On the full ceremony it
 * also never ends before the beam that started at the reveal COMMIT has
 * passed its peak (`beamPeakMs`, review r4). Every end is bounded by
 * `releaseBoundMs` after entry and clamped to the life end, which always
 * wins (the deadline is a hard rule).
 */
function revealEndAt(state: BallState): number {
  const quick = state.quick || state.reducedMotion;
  const total = ceremonyMs(state);
  const authored = state.openedAt + total;
  // ENGINE-FIX (D32): the silent plan (a veiled swap) has no beat to hold.
  const floor = state.since + (state.silent === true ? 0 : quick ? BALL_TIMING.reducedFadeMs : BALL_TIMING.minReleaseMs * state.beamScale);
  const beamPeak =
    quick || state.revealCommitAt < 0
      ? -Infinity
      : state.revealCommitAt + beatAt(state, BALL_TIMING.handoffMs + BALL_TIMING.beamPeakMs);
  // The CSS timeline's REAL end once its start was read (wave 2): a stall
  // that delayed the animations' start never gets the ball unmounted mid-beam.
  const timelineEnd = state.timelineAt >= 0 ? state.timelineAt + total : -Infinity;
  const end = Math.min(
    Math.max(authored, floor, beamPeak, timelineEnd),
    state.since + BALL_TIMING.releaseBoundMs,
  );
  return clampBeat(state, end);
}

/**
 * Record the CSS timeline's observed start (opening / releasing only). The
 * first read wins: a re-read of the same animation is the same instant.
 */
function withTimeline(prev: BallState, input: BallInput): BallState {
  const at = input.timelineAtMs;
  if (at === undefined || at === null || !Number.isFinite(at) || prev.timelineAt >= 0) return prev;
  return { ...prev, timelineAt: at };
}

/**
 * When a still-loading ball must start leaving so it is GONE by the life
 * end: the abort fade (or the quick crossfade) runs out exactly there.
 */
function loadingExitAt(state: BallState): number {
  return lifeEnd(state) - Math.max(BALL_TIMING.abortFadeMs, BALL_TIMING.reducedFadeMs);
}

/**
 * The generation moved under a reveal or a load. A new attempt in flight is
 * re-presented from loading (it keeps the visible ball — shakes stay
 * monotone — and takes the new deadline anchor); an `idle` gap is held,
 * bounded by the current deadline, because a reset followed by a new begin
 * is the normal StrictMode / remount path, not a failure.
 */
function followGeneration(prev: BallState, input: BallInput): BallState | null {
  if (input.generation === prev.generation) return null;
  if (attemptInFlight(input)) {
    // A second flip under the veil keeps the swap silent (ENGINE-FIX, D32).
    const rebased = enterLoading(prev, input, prev.silent === true);
    return input.armed && input.phase === 'presented' ? enterOpening(rebased, input) : rebased;
  }
  return prev;
}

/**
 * One step of the machine. Returns `prev` itself when nothing changes, so a
 * React state setter bails out and the scheduling effect cannot loop.
 *
 * Phase order (review r3, property-tested): a presented generation always
 * passes `loading → opening → releasing → done`, one phase per step, however
 * late the steps land; only a failure (`aborted`) or a generation change
 * leaves that order.
 */
export function stepBall(prev: BallState, input: BallInput): BallState {
  switch (prev.phase) {
    case 'hidden': {
      // Only a NEW attempt summons the ball: an aborted (or never-ceremonied)
      // generation that later presents and arms stays hidden — no closed
      // ball drifting over the page for a ceremony that already ended.
      if (!attemptInFlight(input) || input.armed) return prev;
      if (prev.generation !== -1 && input.generation === prev.generation) return prev;
      return enterLoading(prev, input);
    }

    case 'loading': {
      if (failing(input)) return enter(prev, 'aborted', input.nowMs);
      const followed = followGeneration(prev, input);
      if (followed !== null && followed !== prev) return followed;
      const exitAt = loadingExitAt(prev);
      if (input.phase === 'idle') {
        // Transient gap (see followGeneration): hold, bounded by the life end.
        return input.nowMs >= exitAt ? enter(prev, 'aborted', input.nowMs) : prev;
      }
      if (input.armed && input.phase === 'presented') return enterOpening(prev, input);
      if (input.nowMs >= exitAt) {
        // D23: not armed by the life end means the world is not complete —
        // presented or not, this is the Lite path (the provider's deadline
        // fires just after). The ball fades out so it is gone by the life
        // end; it never opens onto an incomplete world (no late partial arm).
        return enter(prev, 'aborted', input.nowMs);
      }
      if (input.milestones > prev.milestones) {
        // 1:1 (wave 2): one wobble per milestone ABOVE the high-water mark —
        // a burst of two in one step is two wobbles, played back to back
        // (`wobblePlan`). Reduced motion records the milestones without
        // moving.
        const rise = input.milestones - prev.milestones;
        return {
          ...prev,
          milestones: input.milestones,
          shakes: input.reducedMotion ? prev.shakes : prev.shakes + rise,
          reducedMotion: input.reducedMotion,
        };
      }
      // A dip never lowers the high-water mark (review r4 phantom wobbles):
      // the climb back to a count already shaken for is not a new milestone.
      if (input.reducedMotion !== prev.reducedMotion) {
        return { ...prev, reducedMotion: input.reducedMotion };
      }
      return prev;
    }

    case 'opening': {
      if (failing(input)) return enter(prev, 'aborted', input.nowMs);
      const followed = followGeneration(prev, input);
      if (followed !== null && followed !== prev) return followed;
      const timed = withTimeline(prev, input);
      return input.nowMs >= releaseAt(timed) ? enter(timed, 'releasing', input.nowMs) : timed;
    }

    case 'releasing': {
      if (failing(input)) return enter(prev, 'aborted', input.nowMs);
      const followed = followGeneration(prev, input);
      if (followed !== null && followed !== prev) return followed;
      const timed = withTimeline(prev, input);
      return input.nowMs >= revealEndAt(timed) ? enter(timed, 'done', input.nowMs) : timed;
    }

    case 'done':
      // A retry or theme switch begins a NEW generation; the finished
      // ceremony for the old one never replays. ENGINE-FIX (D32): a new
      // generation after a FINISHED ceremony is a day/night swap of the live
      // world, covered by the theme veil — its reveal is silent (no beat
      // time; the veil, not the ball, is what the visitor sees).
      return input.generation !== prev.generation && attemptInFlight(input) && !input.armed
        ? enterLoading(prev, input, true)
        : prev;

    case 'aborted':
      // The generation is KEPT through aborted → hidden, so the same attempt
      // can never re-summon the ball (see `hidden`).
      if (input.generation !== prev.generation && attemptInFlight(input) && !input.armed) {
        return enterLoading(prev, input);
      }
      if (input.nowMs - prev.since >= BALL_TIMING.abortFadeMs) return enter(prev, 'hidden', input.nowMs);
      return prev;
  }
}

/**
 * The absolute time (same clock as `nowMs`) at which `state` has a pending
 * time-based transition, or null when only an input change can move it.
 */
export function ballWakeAt(state: BallState): number | null {
  switch (state.phase) {
    case 'loading':
      return loadingExitAt(state);
    case 'opening':
      return releaseAt(state);
    case 'releasing':
      return revealEndAt(state);
    case 'aborted':
      return state.since + BALL_TIMING.abortFadeMs;
    default:
      return null;
  }
}

/** The deadline the ball was captured against (trace / tests). */
export function ballDeadlineAt(state: BallState): number {
  return deadlineAt(state);
}

/** Whether the ball draws anything at all in this state. */
export function ballVisible(state: BallState): boolean {
  return (
    state.phase === 'loading' ||
    state.phase === 'opening' ||
    state.phase === 'releasing' ||
    state.phase === 'aborted'
  );
}

/** The reveal is under way (hinge, beam, exit) — the CSS keys its beats on this. */
export function ballRevealing(state: BallState): boolean {
  return state.phase === 'opening' || state.phase === 'releasing';
}

export interface WobbleInput {
  shakes: number;
  /** The highest shake whose rock ENDED (or was cancelled). */
  settledShake: number;
  /** `BallState.rockFloor`: shakes at or below it were dropped by a reveal / abort. */
  floor?: number;
  phase: BallPhase;
  revealing: boolean;
  reduced: boolean;
}

export interface WobblePlan {
  /** The shake whose rock plays now (`max(settledShake, floor) + 1`). */
  shake: number;
  /** Two or more rocks are owed: this one plays at `wobbleFastMs`. */
  fast: boolean;
}

/**
 * Which rock, if any, the wobble element plays in this render (wave 2: 1:1
 * with milestone rises; review r4: no phantom wobbles). Rocks play IN
 * ORDER, one at a time: the next unplayed shake is `settledShake + 1`, and it
 * is settled only by its own rock's `animationend` / `animationcancel`, so a
 * rise during a rock queues behind it instead of restarting it (r5: a rise
 * 100 ms after another got no rock of its own). With two or more rocks owed
 * the playing one takes the fast tempo, so the queue drains close to its
 * rises. The CSS restarts an animation whenever the selector re-matches, so
 * a rock is rendered ONLY for an unsettled shake and only while the ball is
 * docked and loading, never revealing and never on the crossfade. A remount,
 * an abort after the reveal or a `data-reduced` flip therefore never replays
 * a rock, and the reveal drops whatever is still queued (a wobble never
 * delays the ceremony — disclosed: a milestone landing within one rock of
 * the arm can lose its rock to the reveal).
 */
export function wobblePlan(input: WobbleInput): WobblePlan | null {
  const played = Math.max(input.settledShake, input.floor ?? 0);
  if (
    input.shakes <= 0 ||
    input.shakes <= played ||
    input.phase !== 'loading' ||
    input.revealing ||
    input.reduced
  ) {
    return null;
  }
  return { shake: played + 1, fast: input.shakes - played >= 2 };
}

/** Whether any rock plays in this render (`wobblePlan(input) !== null`). */
export function wobblePlays(input: WobbleInput): boolean {
  return wobblePlan(input) !== null;
}

export interface RevealGateInput {
  nowMs: number;
  /** The current generation reached `presented` (and the provider witnessed it). */
  presented: boolean;
  /** The current generation's assets went idle (scene-progress M3). */
  assetsIdle: boolean;
  /** Every world population committed and every preload settled (residency-store). */
  residencyComplete: boolean;
  /** The load warm settled for the current generation (compiled + uploaded + stable). */
  sceneWarm: boolean;
  /** When the current attempt began loading (the visitor anchor). */
  begunAtMs: number;
  /** The scene readiness deadline in force (`getReadyDeadlineMs()`). */
  deadlineMs: number;
}

/**
 * The wall-clock bound on the reveal's arm: the moment a still-loading ball
 * starts its exit fade (`ballLifeEndAt` minus the longer of the abort fade
 * and the crossfade — the machine's own `loadingExitAt`). A complete world
 * that arms before it still gets a ceremony (scaled, or the crossfade); from
 * it on the ball may already be leaving and the outcome is Lite at the
 * deadline, never a world popping in without its ceremony. The bound itself
 * is excluded (PR #65 review): `stepBall` aborts an unarmed loading ball at
 * `nowMs >= loadingExitAt` — its wake lands at the first observed instant at
 * or past it — so an arm read at that same instant could follow an abort
 * that already ran.
 */
export function revealArmLastAt(begunAtMs: number, deadlineMs: number): number {
  return ballLifeEndAt(begunAtMs, deadlineMs) - Math.max(BALL_TIMING.abortFadeMs, BALL_TIMING.reducedFadeMs);
}

export type RevealGateVerdict = 'arm' | 'wait' | 'expired';

/**
 * The D23 gate (pure): `arm` once the world is complete, `wait` while it is
 * not, `expired` from the arm bound on (`revealArmLastAt`, inclusive: the
 * instant the loading ball may abort; the provider then leaves the deadline
 * to resolve Lite). Complete means ALL of presented, assets idle, residency
 * and warm — there is no timer that arms early.
 */
export function revealGate(input: RevealGateInput): RevealGateVerdict {
  if (input.nowMs >= revealArmLastAt(input.begunAtMs, input.deadlineMs)) return 'expired';
  const complete = input.presented && input.assetsIdle && input.residencyComplete && input.sceneWarm;
  return complete ? 'arm' : 'wait';
}

/* ── Two-phase page handoff (review r3, blank-frame veto) ─────────────── */

/**
 * The handoff is two-phase so that no composited frame can show neither the
 * page nor the world:
 *
 * 1. `html[data-route-handoff]` (on `routeSceneLive`): the canvas is raised
 *    to opacity 1 OVER the still-painted sections (by paint order it already
 *    lies above them) — an opacity fade under the beam on the ceremony path, or a
 *    short fade otherwise. A stalled frame shows the page, the world, or the
 *    page with the world opening over it.
 * 2. `html.world-route-live` (the sections' paint is hidden): only once the
 *    canvas has COMPOSITED fully — computed opacity 1, no transition or
 *    animation (the release fade) still running, held for `settledFrames`
 *    consecutive animation frames, AND the renderer has drawn at least one
 *    frame since (`renderedFrames` moved). A parked renderer (demand
 *    frameloop) cannot hold the page forever: `fallbackFrames` settled
 *    frames stand in for the renderer tick.
 *
 * Pure step so the ordering is unit-tested; `HideHtmlOnRoute` samples the
 * canvas once per animation frame and feeds it.
 */
/**
 * Whether the page handoff (`html[data-route-handoff]`) may be written at all
 * (wave-2 r3, Lite floor): ONLY from the provider's `routeSceneLive` commit
 * and never under the Lite tier — reduced motion resolves Lite (D12), so a
 * reduced-motion visitor on the auto tier never gets the canvas raised over
 * the page. `routeSceneLive` already implies the route tier; the explicit
 * tier term keeps a Lite flip in the same render from ever writing it.
 */
export function routeHandoffAllowed(input: { tier: 'route' | 'lite'; routeSceneLive: boolean }): boolean {
  return input.tier === 'route' && input.routeSceneLive;
}

export const HANDOFF_COMPOSITE = {
  settledFrames: 2,
  fallbackFrames: 4,
} as const;

export interface CompositeSample {
  /** `getComputedStyle([data-route-canvas]).opacity`, parsed. */
  canvasOpacity: number;
  /** A transition or animation on the canvas wrapper is still running. */
  animating: boolean;
  /** Monotone renderer frame counter (`getRenderedFrames()`). */
  renderedFrames: number;
}

export interface CompositeGate {
  /** Consecutive frames on which the canvas read fully composited. */
  settled: number;
  /** `renderedFrames` at the first settled frame, null while unsettled. */
  frameMark: number | null;
}

export const INITIAL_COMPOSITE_GATE: CompositeGate = { settled: 0, frameMark: null };

/** Whether the sections may be hidden (phase 2), plus the next gate state. */
export function stepHandoffComposite(
  gate: CompositeGate,
  sample: CompositeSample,
): { gate: CompositeGate; live: boolean } {
  if (!(sample.canvasOpacity >= 1) || sample.animating) {
    return { gate: INITIAL_COMPOSITE_GATE, live: false };
  }
  const next: CompositeGate = {
    settled: gate.settled + 1,
    frameMark: gate.frameMark ?? sample.renderedFrames,
  };
  const drew = next.frameMark !== null && sample.renderedFrames > next.frameMark;
  const live =
    next.settled >= HANDOFF_COMPOSITE.settledFrames &&
    (drew || next.settled >= HANDOFF_COMPOSITE.fallbackFrames);
  return { gate: next, live };
}

/* ── Loader chip placement (wave-2 r2: the ball read as a stray icon) ───── */

/** A box in CSS px, viewport coordinates. */
export interface ChipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ChipPlacementInput {
  /** The loader root's box (the fixed, full-viewport layer). */
  viewport: { width: number; height: number };
  /** The chip's own size (ball + status line + padding). */
  chip: { width: number; height: number };
  /** Clear space kept to every viewport edge (≥ 16 px). */
  gutterPx: number;
  /**
   * Space the chip may never enter: the safe-area insets plus reserved bands
   * (the site NavBar at the top).
   */
  insets: { top: number; right: number; bottom: number; left: number };
  /** Visible page text (padded by the caller): the data the chip must not cover. */
  obstacles: readonly ChipRect[];
  /** Candidate grid step (px). */
  stepPx?: number;
  /**
   * Lowest share of the viewport the chip may climb to (0.4 = never above
   * the lower 60 %): the loader stays a footer element, never a banner.
   */
  maxRise?: number;
  /**
   * Wave-2 r3 fallback (the 390 chip sat on "Top of the table"): when no
   * clear slot exists in the lower band, nor anywhere below the top inset,
   * the chip docks as a COMPACT row (ball beside the line, this size) in the
   * reserved bottom HUD band instead of over the page's text. Omitted = the
   * least-overlapping box wins (the r2 behaviour).
   */
  band?: { width: number; height: number };
}

export interface ChipPlacement {
  left: number;
  top: number;
  /** No obstacle overlaps the chosen box. */
  clear: boolean;
  /** Overlapped obstacle area at the chosen box (0 when clear). */
  overlapPx: number;
  /** The compact band fallback was taken (the box is `band`-sized). */
  band?: boolean;
}

function overlapArea(a: ChipRect, b: ChipRect): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Where the loader chip docks (pure; the DOM keep-out law of D2 "the ball
 * never covers data", applied to the semantic page the way `data-surfaces`
 * applies it to the 3D faces): the candidate nearest the bottom centre whose
 * box, kept `gutterPx` inside every edge and the insets, overlaps NO visible
 * text. Rows are tried from the bottom up (to `maxRise`), and within a row
 * the centre first, then outward alternately. With no clear candidate the
 * least-overlapping one wins (bottom-centre on ties), flagged `clear: false`.
 * The box is always entirely inside the viewport.
 */
export function placeLoaderChip(input: ChipPlacementInput): ChipPlacement {
  const lower = searchChip(input, input.maxRise ?? 0.6);
  if (lower.clear) return lower;
  // Wave-2 r3: then anywhere below the top inset (the site header) before
  // giving up on a clear slot.
  const anywhere = searchChip(input, 1);
  if (anywhere.clear) return anywhere;
  if (input.band === undefined) return lower.overlapPx <= anywhere.overlapPx ? lower : anywhere;
  const { width: vw, height: vh } = input.viewport;
  const { width: bw, height: bh } = input.band;
  const edge = Math.min(input.gutterPx, 4);
  const left = Math.min(
    Math.max(input.insets.left + edge, (vw - bw) / 2),
    Math.max(input.insets.left + edge, vw - input.insets.right - edge - bw),
  );
  const top = Math.max(0, vh - input.insets.bottom - edge - bh);
  const box: ChipRect = { left, top, width: bw, height: bh };
  const overlapPx = input.obstacles.reduce((sum, obstacle) => sum + overlapArea(box, obstacle), 0);
  return { left, top, clear: overlapPx === 0, overlapPx, band: true };
}

function searchChip(input: ChipPlacementInput, maxRise: number): ChipPlacement {
  const step = Math.max(4, input.stepPx ?? 12);
  const { width: vw, height: vh } = input.viewport;
  const { width: cw, height: ch } = input.chip;
  const minLeft = input.insets.left + input.gutterPx;
  const maxLeft = Math.max(minLeft, vw - input.insets.right - input.gutterPx - cw);
  const maxTop = Math.max(0, vh - input.insets.bottom - input.gutterPx - ch);
  const riseFloor = vh * (1 - Math.min(1, Math.max(0, maxRise)));
  const minTop = Math.min(maxTop, Math.max(input.insets.top + input.gutterPx, riseFloor));
  const centre = Math.min(maxLeft, Math.max(minLeft, (vw - cw) / 2));
  const xs: number[] = [centre];
  for (let d = step; centre - d >= minLeft || centre + d <= maxLeft; d += step) {
    if (centre - d >= minLeft) xs.push(centre - d);
    if (centre + d <= maxLeft) xs.push(centre + d);
  }
  let best: ChipPlacement | null = null;
  for (let top = maxTop; top >= minTop - 0.5; top -= step) {
    for (const left of xs) {
      const box: ChipRect = { left, top, width: cw, height: ch };
      let area = 0;
      for (const obstacle of input.obstacles) {
        area += overlapArea(box, obstacle);
        if (best !== null && area >= best.overlapPx) break;
      }
      if (area === 0) return { left, top, clear: true, overlapPx: 0 };
      if (best === null || area < best.overlapPx) best = { left, top, clear: false, overlapPx: area };
    }
  }
  return best ?? { left: centre, top: maxTop, clear: input.obstacles.length === 0, overlapPx: 0 };
}

/* ── Loader status line (wave-2 r2) ──────────────────────────────────────── */

/**
 * The status line's copy per viewer locale (wave-2 r2: "Welt wird geladen"
 * under the ball, following the REAL milestone; i18n D11: the words live in
 * `world-route.loader` and follow `useLocale()`, never the theme). The stage
 * is the furthest milestone reached, so an out-of-order rise never walks the
 * line backwards.
 */
function loaderMessages(locale: LoaderLocale) {
  return getMessages(worldRouteMessages, locale).loader;
}

/** Milestones the ball counts (scene-progress M1–M6); the line reads "n/6". */
export const LOADER_MILESTONES = 6;

/** The status line for a progress snapshot (pure; the count reads "n/6"). */
export interface LoaderStageProgress {
  renderer: boolean;
  assets: boolean;
  /** D23: every program (incl. shadow and pass variants) compiled and linked. */
  compiled?: boolean;
  /** D23: every texture uploaded and the station pose renders done. */
  uploaded?: boolean;
  firstFrame: boolean;
  /** Milestones reached, 0..LOADER_MILESTONES. */
  count: number;
}

/** The loader's copy language: the viewer's UI locale. */
export type LoaderLocale = Locale;

/** The stage words, `ready` and the screen-reader `usable` note, in one language. */
export type LoaderStageCopy = ReturnType<typeof loaderMessages>['stage'];

/** The locale's copy (stage words, `ready`, the screen-reader `usable` note). */
export function loaderStageCopy(locale: LoaderLocale): LoaderStageCopy {
  return loaderMessages(locale).stage;
}

export function loaderStageLine(locale: LoaderLocale, progress: LoaderStageProgress): string {
  const copy = loaderMessages(locale).stage;
  // The furthest stage reached, in the D23 warm order: a milestone that rose
  // out of order never walks the line backwards.
  const stage = progress.firstFrame
    ? copy.firstFrame
    : progress.uploaded
      ? copy.uploaded
      : progress.compiled
        ? copy.compiled
        : progress.assets
          ? copy.assets
          : progress.renderer
            ? copy.renderer
            : copy.loading;
  return milestoneLine(locale, stage, progress.count);
}

/** `"<stage> · n/6"` — the milestone count clamped to 0..LOADER_MILESTONES. */
function milestoneLine(locale: LoaderLocale, stage: string, count: number): string {
  return interpolate(
    loaderMessages(locale).line,
    { stage, count: Math.min(LOADER_MILESTONES, Math.max(0, count)), total: LOADER_MILESTONES },
    locale,
  );
}

/* ── Warm sub-step (ENGINE r5, CAR r4: 7.6–9.3 s on one line) ──────────── */

/*
 * The load warm's sub-step words per locale (`world-route.loader.warm`). The
 * milestone line (above) can hold one stage for most of the load —
 * `firstFrame` rises at presentation, long before the warm compiles and
 * uploads — so while the warm runs the VISIBLE line names its current step
 * and a real count instead. Short words: the chip holds about 26 characters
 * at 13 px (the German words were authored to the same budget).
 */

/** Residency's completion flag rides on its count (scene-progress `onResidencyChange`). */
const RESIDENCY_COMPLETE_FLAG = 1_000_000;

/**
 * The visible sub-step for the load warm's signals (scene-progress
 * `getLoadSignals`: high-water marks, so the line never walks backwards), or
 * null when the warm has not started. `warmStage` is the stage index + 1 in
 * `LOAD_WARM_STAGES` order (compile, shadows, verify, textures, buffers,
 * passes, poses, frame, settle, done). Every count is a real signal — work
 * finished, never a timer. The milestone count ("n/6") stays on the line.
 */
export function loaderWarmLine(locale: LoaderLocale, signals: Readonly<Record<string, number>>, count: number): string | null {
  const stage = signals.warmStage ?? 0;
  if (!(stage >= 1)) return null;
  const copy = loaderMessages(locale);
  const words = copy.warm;
  const n = (name: string): number => {
    const value = signals[name];
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  };
  // Counts are raw work tallies, painted as plain digits (no grouping).
  const tally = (word: string, value: number): string => interpolate(copy.warmStep, { step: word, n: String(value) }, locale);
  let step: string;
  switch (Math.floor(stage)) {
    case 1:
    case 3:
      step = n('programsReady') > 0 ? tally(words.shaders, n('programsReady')) : tally(words.placing, n('residency') % RESIDENCY_COMPLETE_FLAG);
      break;
    case 2:
      step = tally(words.shadows, n('casters'));
      break;
    case 4:
      step = tally(words.textures, n('uploads'));
      break;
    case 5:
      step = tally(words.geometry, n('buffers'));
      break;
    case 6:
      step = tally(words.effects, n('passes'));
      break;
    case 7:
      step = tally(words.stations, n('poses'));
      break;
    default:
      step = words.final;
  }
  return milestoneLine(locale, step, count);
}

// ── Beam pre-raster, staggered (R6, CAR r5 "post-ball main-thread stall") ──
//
// The R6 GPU trace attributed the 317 ms stall right after the ball appears
// (every world, 1440 and 390, dev and prod alike): it is not script and not
// the scene chunk (the long-animation frame carries 9 ms of script) but the
// capture-release beam's layers being RASTERED all at once. ENGINE r3/r5
// park them at their peak scale at opacity 0.002 while the ball is docked, so
// the reveal reuses their tiles — right, but every layer (the 810 px glow,
// the 310 vmax sweep, 12 masked rays, the ring, the core, 10 sparks) went
// into the first docked frame: four 40-60 ms GPU raster tasks back to back on
// the GPU main thread (Skia's gradient and mask programs linking inside
// them), so the compositor could not draw the ball's own entrance (a 259-270
// ms screencast gap) and rAF stalled ~330 ms.
//
// The pre-raster now runs as a STAGGER: a beam part is only pre-rastered
// once the loader marks it (`data-warm`, set imperatively), and the loader
// marks one step's parts at a time, BEAM_PRERASTER.stepMs apart, after the
// ball's entrance and the renderer's start-up have settled. Each step is one
// small raster task; the whole beam is warm about 2.4 s after the ball
// appears, in a load that takes 6.5+ s. A part a very short load did not
// reach is rastered by the reveal as before r3 (never missing).

export const BEAM_PRERASTER = {
  /**
   * After the ball's entrance (280 ms), its own first raster and the
   * renderer's start-up (canvas mount, context, first frame — R6 i3: a step
   * at +450 ms stacked on them for a 100-117 ms rAF gap). Still ends long
   * before the fastest reveal (~6.5 s from the ball).
   */
  startDelayMs: 1200,
  /**
   * Between steps: each step's raster lands as its own GPU task. (ENGINE-A4
   * tried 170 ms: the longer stagger ran into the clouds compile stage, whose
   * compile opens ~1.8 s after the ball, for no plaza gain.)
   */
  stepMs: 110,
} as const;

/** The loader's ray count (BallLoader renders this many masked rays). */
export const BEAM_RAY_COUNT = 12;

/** When the staggered beam pre-raster has marked its last step, ms after the ball starts loading (pure). */
export function beamPrerasterEndMs(rayCount: number = BEAM_RAY_COUNT): number {
  return BEAM_PRERASTER.startDelayMs + beamPrerasterSteps(rayCount) * BEAM_PRERASTER.stepMs;
}

/**
 * A beam part the loader renders (BallLoader `.beam`), plus `hud`: the
 * loader's route-HUD primer (R6 E8 — the HUD's glass paint effects shown for
 * a moment at the pre-raster opacity, so their programs link while docked).
 */
export type BeamPart = 'core' | 'ring' | 'spark' | 'glow' | 'ray' | 'hud' | 'sweep';

/**
 * The pre-raster step a beam part is warmed in (pure). Heaviest first, while
 * the GPU is quiet (the stagger starts before the compile gate opens): the
 * 310 vmax sweep alone (the largest raster — r6 i5 sakura: landing last, it
 * stacked on compile-open work for a 199 ms gap), then the core and the ring
 * each alone (parked at their 4x / 6x peak scale, their blurred box-shadows
 * are the costliest small rasters), the glow, the route-HUD primer, the rays
 * two per step (each carries its own mask layer), and the sparks last.
 */
export function beamPrerasterStep(part: BeamPart, index: number, rayCount: number): number {
  const rays = Math.max(0, Math.ceil(rayCount / 2));
  switch (part) {
    case 'sweep':
      return 0;
    case 'core':
      return 1;
    case 'ring':
      return 2;
    case 'glow':
      return 3;
    case 'hud':
      return 4;
    case 'ray':
      return 5 + Math.floor(Math.max(0, index) / 2);
    case 'spark':
      return 5 + rays;
  }
}

/** How many pre-raster steps a beam with `rayCount` rays takes (pure). */
export function beamPrerasterSteps(rayCount: number): number {
  return beamPrerasterStep('spark', 0, rayCount) + 1;
}
