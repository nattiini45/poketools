'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import { flushSync } from 'react-dom';
import { useLocale } from '@/i18n/client';
import { useWorldHandoff, useWorldState } from './WorldStateProvider';
import {
  getLoadSignals,
  getSceneProgress,
  getServerSceneProgress,
  noteBallLoaderMounted,
  noteCeremonyTrace,
  noteWobbleTrace,
  publishBallPhase,
  registerBallAborter,
  scheduleAtWallClock,
  subscribeSceneProgress,
  type CeremonyAnimation,
  type SceneMilestone,
} from './scene-progress';
import { getGenerationBegunAt, getReadyDeadlineMs } from './world-readiness';
import {
  BALL_TIMING,
  BEAM_PRERASTER,
  BEAM_RAY_COUNT,
  beamPrerasterStep,
  beamPrerasterSteps,
  ballLifeEndAt,
  ballRevealing,
  ballVisible,
  ballWakeAt,
  ceremonyPlan,
  INITIAL_BALL,
  loaderStageCopy,
  loaderStageLine,
  loaderWarmLine,
  placeLoaderChip,
  stepBall,
  type BallInput,
  type BallPhase,
  type BallState,
  type CeremonyPlan,
  type ChipRect,
} from '@/lib/route-world/ball-loader-state';
import { REDUCED_MOTION_QUERY } from '@/lib/route-world/quality';
import styles from './BallLoader.module.css';

/** ENGINE r5: how often the visible warm sub-step line re-reads the load signals (ms). */
const WARM_LINE_POLL_MS = 250;

/**
 * The Pokéball loading ceremony (W7; design decisions D1–D3, spec §5.5
 * invariants). DOM/CSS-3D only — no second WebGL renderer.
 *
 * LOADING: a compact ball docked bottom-centre above the HUD band (inside the
 * band's right-hand gutter at ≤ 640 px) with a soft scrim behind the ball
 * alone, so the semantic page stays readable and fully usable underneath
 * (the canvas is inert at opacity 0 until the handoff — globals.css, W7
 * block). Each REAL readiness milestone (scene-progress.ts) rocks it once,
 * franchise-style, with the button pulsing red — 1:1: rocks play in order,
 * one per milestone, a backlog draining at the fast tempo (`wobblePlan`).
 *
 * REVEAL — one compositor timeline (wave 2, W7 change of technique): the
 * provider's gate arms and hands over in ONE commit (`routeSceneLive`). That
 * commit renders `data-revealing` here, writes the plan's `--ball-lead` /
 * `--ball-k` on <html> (layout phase, same commit) and writes
 * `html[data-route-handoff]` in `HideHtmlOnRoute`. From there every visual
 * beat is a pre-scheduled transform/opacity CSS animation with an
 * `animation-delay` offset (BallLoader.module.css; the canvas fade in
 * globals.css): the flight from the chip dock to screen centre (every width
 * since wave-2 r3),
 * then the click, the lid hinging open, the capture-release beam (white
 * core, red shafts, rim ring, wavefront) with the canvas fading in under it
 * over the still-painted page, and the ball's exit. A main-thread stall (a
 * shader link) cannot stutter or desync any of it. The machine
 * (ball-loader-state.ts) only mirrors the beats on the wall clock —
 * `opening → releasing → done`, never skipped — to key the unmount, and
 * never unmounts before the CSS timeline's REAL end: the anchor animation's
 * `startTime` is read back and fed in (`timelineAtMs`).
 *
 * `data-revealing` and the plan are derived in RENDER from the arm (not only
 * from the stepped phase, which lands a microtask later), so they are in the
 * very commit that writes the handoff attribute.
 *
 * Deadline: the ball's whole life ends `deadlineMarginMs` before the
 * readiness deadline from the attempt start. A reveal armed too late for the
 * full ceremony plays it time-scaled into the life left (`short`); under
 * 600 ms left it plays the 200 ms crossfade (`quick`, rendered as
 * `data-reduced`). See ball-loader-state.ts `ceremonyPlan`.
 *
 * Aborts need a real failure (tier flips Lite, phase failed) and fade in
 * 150 ms over what is already the Lite page, so the ball never delays or
 * blocks the fallback.
 *
 * Fixed, `pointer-events: none`, visuals `aria-hidden`, no focusable content.
 * Stacks above the canvas (z-0) and the sections, below WorldNav (z-30), the
 * site NavBar (z-40) and the retry control (z-50). One visually hidden polite
 * status line speaks the world's own loader copy.
 *
 * Trace self-check (`?routeTrace=1` / `?routeDebug=1`): while the ball is
 * DOCKED over the page (loading, before the reveal), every phase change,
 * wobble and scroll checks the ball's box against the VISIBLE text of
 * `[data-world-route]` and records any overlap on
 * `window.__ballTextIntersections` (plus one console warning per text) for
 * the harness to assert on. The reveal flight crosses the page by
 * design (D2: the ceremony moment) and is not checked. Trace mode also
 * records every milestone rise and rock start (`wobbleTrace`) and each
 * reveal's timeline with the property list of every ceremony animation
 * (`ceremony`, via `__routeWorldReadiness()`).
 *
 * Reduced motion (reachable only through a forced `?tier=route`, since reduced
 * motion otherwise resolves Lite — D12): a static ball, no wobble or beam,
 * and a 200 ms opacity crossfade.
 */

const RAY_COUNT = BEAM_RAY_COUNT;
const SPARK_COUNT = 10;
const RAYS = Array.from({ length: RAY_COUNT }, (_, index) => index);
const SPARKS = Array.from({ length: SPARK_COUNT }, (_, index) => index);

/**
 * The ball flies from its dock to screen centre before the burst at EVERY
 * width (wave-2 r3: at ≥ 641 px the 1440 burst fired from the docked chip's
 * corner over the page; D2 says the ball "flies to centre-screen at
 * reveal"). The flight's time is already in the gate's budget
 * (`fullCeremonyMs(true)`).
 */
const FLIGHT = true;

/** The crossfade plan (reduced motion / no arm time known). */
const QUICK_PLAN: CeremonyPlan = {
  mode: 'quick',
  scale: 1,
  beamScale: 1,
  leadMs: 0,
  totalMs: BALL_TIMING.reducedFadeMs,
};

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getFalse(): boolean {
  return false;
}

function subscribeStatic(): () => void {
  return () => {};
}

function getTraceOn(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('routeTrace') === '1' || params.get('routeDebug') === '1';
}

type Inputs = Omit<BallInput, 'nowMs' | 'begunAtMs' | 'deadlineMs'>;

/** Step with the wall clock and the live deadline anchor read at call time. */
function stepNow(prev: BallState, inputs: Inputs): BallState {
  return stepBall(prev, {
    ...inputs,
    begunAtMs: getGenerationBegunAt(),
    deadlineMs: getReadyDeadlineMs(),
    nowMs: performance.now(),
  });
}

/**
 * One phase per COMMIT (review r5: sakura-1440 published `opening → done`
 * with no `releasing`). The machine advances one phase per step, but two
 * queued updaters (the input step and a wake) can run back to back in one
 * render batch after a stall, so `releasing` was computed and replaced
 * before it ever committed — no beam frame, no published phase. A step
 * whose `prev` already advanced past the committed phase in this batch holds
 * instead; the wake effect re-arms after the commit and takes the next beat.
 * Aborts are never held.
 */
function stepCommitted(prev: BallState, committed: BallState, inputs: Inputs): BallState {
  const next = stepNow(prev, inputs);
  if (next === prev || next.phase === 'aborted') return next;
  if (prev.phase !== committed.phase && next.phase !== prev.phase) return prev;
  return next;
}

/** Id of the compositor life-bound fade (a failure bound, not a ceremony beat). */
const LIFE_BOUND_ID = 'ball-life-bound';

/** A wobble-rock animation name (CSS-module scoped: `…wobble…` / `…wobble_b…`). */
function isRockName(name: string): boolean {
  return /(^|_)wobble($|_)/.test(name) || name === 'wobble';
}

/** Keyframe keys that are timing metadata, not animated properties. */
const KEYFRAME_META = new Set(['offset', 'computedOffset', 'easing', 'composite']);

/** Trace-only: one ceremony animation's name, target and animated properties. */
function describeAnimation(animation: Animation): CeremonyAnimation | null {
  const effect = animation.effect;
  if (!(effect instanceof KeyframeEffect)) return null;
  const properties = new Set<string>();
  for (const frame of effect.getKeyframes()) {
    for (const key of Object.keys(frame)) if (!KEYFRAME_META.has(key)) properties.add(key);
  }
  const timing = effect.getComputedTiming();
  const pseudo = effect.pseudoElement ?? '';
  return {
    name: animation instanceof CSSAnimation ? animation.animationName : animation.id,
    target: `${describeTarget(effect.target)}${pseudo}`,
    properties: [...properties].sort(),
    delayMs: Number(timing.delay ?? 0),
    durationMs: typeof timing.duration === 'number' ? timing.duration : 0,
    css: animation instanceof CSSAnimation,
  };
}

function describeTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) return '';
  const cls = typeof target.className === 'string' ? target.className : '';
  return `${target.tagName.toLowerCase()}.${cls.split(/\s+/).filter(Boolean).join('.')}`.slice(0, 80);
}

/* ── Trace self-check: the ball must never sit over visible page text ───── */

export interface BallTextHit {
  t: number;
  phase: BallPhase;
  /** First 60 characters of the covered text node. */
  text: string;
  /** Ball box and the overlapped text rect, [left, top, width, height] in CSS px. */
  ball: [number, number, number, number];
  rect: [number, number, number, number];
}

type BallCheckHost = Window & { __ballTextIntersections?: BallTextHit[] };

const MAX_HITS = 200;
const warned = new Set<string>();

function box(rect: DOMRect): [number, number, number, number] {
  return [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)];
}

/**
 * Records every VISIBLE text rect of the semantic page the ball's box
 * overlaps. Visible = the topmost element at the overlap's centre is the
 * text's own element (the ball is `pointer-events: none`, so hit-testing
 * looks through it); text passing under the opaque HUD band or already
 * hidden by the handoff does not count.
 */
function checkBallOverText(ball: HTMLElement, phase: BallPhase): void {
  const root = document.querySelector('[data-world-route]');
  if (root === null || document.documentElement.classList.contains('world-route-live')) return;
  const ballRect = ball.getBoundingClientRect();
  if (ballRect.width === 0 || ballRect.height === 0) return;
  const host = window as BallCheckHost;
  const hits = (host.__ballTextIntersections ??= []);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.trim() ?? '';
    const owner = node.parentElement;
    if (text === '' || owner === null) continue;
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      const left = Math.max(rect.left, ballRect.left);
      const right = Math.min(rect.right, ballRect.right);
      const top = Math.max(rect.top, ballRect.top);
      const bottom = Math.min(rect.bottom, ballRect.bottom);
      if (right - left < 1 || bottom - top < 1) continue;
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      if (hit === null || !(hit === owner || owner.contains(hit) || hit.contains(owner))) continue;
      if (hits.length < MAX_HITS) {
        hits.push({
          t: performance.now(),
          phase,
          text: text.slice(0, 60),
          ball: box(ballRect),
          rect: box(rect),
        });
      }
      if (!warned.has(text)) {
        warned.add(text);
        console.warn(`[ball-loader] ball (${phase}) overlaps visible text: "${text.slice(0, 60)}"`);
      }
      break;
    }
  }
  range.detach();
}

/* ── The loader chip: ball + one status line, placed off the data ───────── */

/** Clear space from the chip to every viewport edge (the judge's ≥ 16 px gutter). */
const CHIP_GUTTER_PX = 16;
/**
 * Padding added around every visible text rect and interactive element
 * before the keep-out test (wave-2 r3: 8 px — at 4 px the 390 chip touched
 * the "Draft Room" button edge).
 */
const CHIP_TEXT_PAD_PX = 8;
/** Interactive elements the chip keeps clear of, text or not (wave-2 r3). */
const CHIP_INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
/** Width of the compact band chip (ball beside the line — `data-chip="band"`). */
const BAND_CHIP_W = 212;

function visibleBox(el: Element): DOMRect | null {
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) <= 0.05) return null;
  return rect;
}

/**
 * The chip's keep-out obstacles, padded: every VISIBLE text run of the
 * semantic page (small labels, section headers and links included — the
 * same text the trace self-check guards), every visible interactive element
 * on the page (buttons, links, inputs — wave-2 r3), the site NavBar, and the
 * route HUD band when it shows.
 */
function collectKeepOut(viewport: DOMRect, loaderRoot: Element | null): ChipRect[] {
  const rects: ChipRect[] = [];
  const pad = CHIP_TEXT_PAD_PX;
  const push = (rect: DOMRect | null) => {
    if (rect === null || rect.width < 1 || rect.height < 1) return;
    if (rect.bottom < 0 || rect.top > viewport.height || rect.right < 0 || rect.left > viewport.width) return;
    rects.push({ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 });
  };
  const root = document.querySelector('[data-world-route]');
  if (root !== null) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if ((node.textContent?.trim() ?? '') === '') continue;
      const owner = node.parentElement;
      if (owner === null || (loaderRoot !== null && loaderRoot.contains(owner))) continue;
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) push(rect);
    }
    range.detach();
  }
  for (const el of Array.from(document.querySelectorAll(CHIP_INTERACTIVE))) {
    if (loaderRoot !== null && loaderRoot.contains(el)) continue;
    push(visibleBox(el));
  }
  for (const nav of Array.from(document.querySelectorAll('body > nav'))) push(visibleBox(nav));
  for (const hud of Array.from(document.querySelectorAll<HTMLElement>('.world-nav-hud'))) push(visibleBox(hud));
  return rects;
}

/** Whether the chip's current box overlaps any keep-out obstacle. */
function chipCovers(chip: HTMLElement, viewport: DOMRect, loaderRoot: Element | null): boolean {
  const box = chip.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return false;
  return collectKeepOut(viewport, loaderRoot).some(
    (o) =>
      Math.min(box.right, o.left + o.width) - Math.max(box.left, o.left) > 0 &&
      Math.min(box.bottom, o.top + o.height) - Math.max(box.top, o.top) > 0,
  );
}

export default function BallLoader() {
  const { tier, theme, scenePhase, sceneGeneration } = useWorldState();
  // ENGINE r3: the arm flags come from the handoff context (their own, so the
  // arm commit does not re-render every world-state consumer).
  const { routeRevealArmed, routeRevealArmedAt } = useWorldHandoff();
  // ENGINE r2: the milestones come straight from the progress store (they are
  // no longer on the world-state context, which re-rendered the whole scene
  // on every loaded item).
  const sceneProgress = useSyncExternalStore(subscribeSceneProgress, getSceneProgress, getServerSceneProgress);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, getFalse);
  const flight = FLIGHT;
  const traceOn = useSyncExternalStore(subscribeStatic, getTraceOn, getFalse);
  const [ball, setBall] = useState<BallState>(INITIAL_BALL);
  // Bumped by every wake so the wake effect re-arms even when the step it
  // ran changed nothing (belt and braces with `scheduleAtWallClock`, which
  // never runs early since review r4 — a lost wake held a ball in
  // `releasing` for 30 s after the world went live).
  const [wakeTick, setWakeTick] = useState(0);
  // The CSS ceremony timeline's real start (the anchor animation's
  // `startTime`), keyed to the reveal it belongs to.
  const [timeline, setTimeline] = useState<{ key: string; at: number } | null>(null);
  const ballRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<HTMLDivElement>(null);
  const wobbleRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const safeRef = useRef<HTMLDivElement>(null);
  // The last COMMITTED machine state (see `stepCommitted`).
  const committed = useRef<BallState>(INITIAL_BALL);
  useLayoutEffect(() => {
    committed.current = ball;
  }, [ball]);

  // Never an infinite spinner: DOM-only worlds report the route tier with no
  // theme and an idle phase — they are simply never active.
  const active = tier === 'route' && theme !== null;
  const milestones = sceneProgress.generation === sceneGeneration ? sceneProgress.count : 0;

  // The reveal starts in the commit that renders the arm (see the header):
  // the machine's `opening` lands a microtask later, but the CSS must not.
  const revealPending =
    ball.phase === 'loading' &&
    active &&
    routeRevealArmed &&
    scenePhase === 'presented' &&
    ball.generation === sceneGeneration;
  // The plan the CSS timeline runs: derived from the arm in render while the
  // step is pending, then the machine's latched copy (the same inputs, so the
  // same plan — `ceremonyPlan` is the one shared decision).
  const pendingPlan: CeremonyPlan | null = !revealPending
    ? null
    : routeRevealArmedAt === null
      ? QUICK_PLAN
      : ceremonyPlan({
          armedAtMs: routeRevealArmedAt,
          begunAtMs: getGenerationBegunAt(),
          deadlineMs: getReadyDeadlineMs(),
          reducedMotion,
          flight,
        });
  const machineRevealing = ballRevealing(ball);
  const plan: CeremonyPlan | null = machineRevealing
    ? { mode: ball.mode, scale: ball.scale, beamScale: ball.beamScale, leadMs: ball.leadMs, totalMs: 0 }
    : pendingPlan;
  const revealing = machineRevealing || revealPending;
  const released = ball.phase === 'releasing';
  const reduced = ball.reducedMotion || ball.quick || reducedMotion || pendingPlan?.mode === 'quick';
  const visible = ballVisible(ball);
  const revealKey = revealing ? `${ball.generation}:${routeRevealArmedAt ?? ball.openedAt}` : null;
  const timelineAtMs = timeline !== null && timeline.key === revealKey ? timeline.at : null;

  const inputs = useRef<Inputs>({
    active,
    armed: routeRevealArmed,
    armedAtMs: routeRevealArmedAt,
    phase: scenePhase,
    generation: sceneGeneration,
    milestones,
    reducedMotion,
    flight,
    timelineAtMs,
  });

  useEffect(() => noteBallLoaderMounted(), []);

  // Step on every input change — including every milestone notification, so
  // a late wake timer is re-checked against the wall clock on each one.
  // Deferred to a microtask: the state setter is never called synchronously
  // in the effect body, and `stepBall` returns the previous object when
  // nothing changed, so the setter bails out.
  useLayoutEffect(() => {
    inputs.current = {
      active,
      armed: routeRevealArmed,
      armedAtMs: routeRevealArmedAt,
      phase: scenePhase,
      generation: sceneGeneration,
      milestones,
      reducedMotion,
      flight,
      timelineAtMs,
    };
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setBall((prev) => stepCommitted(prev, committed.current, inputs.current));
    });
    return () => {
      cancelled = true;
    };
  }, [
    active,
    routeRevealArmed,
    routeRevealArmedAt,
    scenePhase,
    sceneGeneration,
    milestones,
    sceneProgress,
    reducedMotion,
    flight,
    timelineAtMs,
  ]);

  // Wake for the next time-based transition (release, ceremony end, abort
  // fade, life end) — wall-clock scheduled from the layout phase, never
  // frame-counted.
  useLayoutEffect(() => {
    const wakeAt = ballWakeAt(ball);
    if (wakeAt === null) return;
    return scheduleAtWallClock(wakeAt, () => {
      setBall((prev) => stepCommitted(prev, committed.current, inputs.current));
      setWakeTick((tick) => tick + 1);
    });
  }, [ball, wakeTick]);

  // Review r5 (context loss): a native failure handler aborts the ball
  // synchronously (`abortBallNow`), committed and published before the Lite
  // flip's commit unmounts the canvas tree. Never called during a render.
  useEffect(
    () =>
      registerBallAborter(() => {
        flushSync(() => {
          setBall((prev) => stepNow(prev, { ...inputs.current, active: false }));
        });
        publishBallPhase(committed.current.phase);
      }),
    [],
  );

  // Published at COMMIT (layout phase, review r5): from a passive effect
  // the stamp trailed the DOM by up to 6 s under a stall.
  useLayoutEffect(() => {
    publishBallPhase(ball.phase);
  }, [ball.phase]);

  // The ceremony plan, written on <html> in the SAME commit that renders
  // `data-revealing` (layout phase, before the browser styles the frame), so
  // the ball's beats and the canvas fade (globals.css) read one lead and one
  // pair of scales (`--ball-k` the lead-in, `--ball-kb` the release). Removed
  // when the ceremony ends; the quick crossfade uses none of them.
  const cssLead = revealing && plan !== null && plan.mode !== 'quick' ? plan.leadMs : null;
  const cssScale = revealing && plan !== null && plan.mode !== 'quick' ? plan.scale : null;
  const cssBeamScale = revealing && plan !== null && plan.mode !== 'quick' ? plan.beamScale : null;
  useLayoutEffect(() => {
    if (cssLead === null || cssScale === null || cssBeamScale === null) return;
    const style = document.documentElement.style;
    style.setProperty('--ball-lead', `${cssLead}ms`);
    style.setProperty('--ball-k', String(cssScale));
    style.setProperty('--ball-kb', String(cssBeamScale));
    return () => {
      style.removeProperty('--ball-lead');
      style.removeProperty('--ball-k');
      style.removeProperty('--ball-kb');
    };
  }, [cssLead, cssScale, cssBeamScale]);

  const rootRef = useRef<HTMLDivElement>(null);
  const traceRef = useRef(false);
  useLayoutEffect(() => {
    traceRef.current = traceOn;
  }, [traceOn]);

  /*
   * ROCKS (wave-2 r2: wobbles were not 1:1 with milestone rises — a rock
   * committed through React state landed 300–1300 ms after its rise under
   * load, and a stale restart rocked 500 ms BEFORE any rise). Each rock is
   * now driven straight from the progress store's notification, in the same
   * synchronous callback as the milestone write:
   *
   * - exactly ONE rock per milestone rise (a burst of two milestones in one
   *   write is two rocks back to back), and a rise during a rock restarts it
   *   — never queued behind it, so every rock starts at its own rise;
   * - never a rock without a rise: only a count ABOVE the generation's
   *   high-water mark rocks (a dip and the climb back do not), a new
   *   generation re-baselines at its current count, and a render never
   *   touches the rock attribute (React does not own `data-rock`);
   * - the restart alternates two identical keyframe sets (`data-rock` a / b:
   *   an `animation-name` swap restarts a CSS animation with no reflow), and
   *   the rock's `startTime` is PINNED to the rise's own stamp on the document
   *   timeline — a main-thread stall between the write and the next frame
   *   cannot move when the rock started, only how much of it is left;
   * - every rise and every rock writes its own `rise` / `rockStart` entry
   *   (the evidence kinds are never evicted — scene-progress).
   * Rocks play only while the ball is docked and loading; a rise outside
   * that window is logged and raises the mark, but never rocks later.
   */
  const rockEnabled = useRef(false);
  const rockEnabledNow = visible && ball.phase === 'loading' && !revealing && !reduced;
  useLayoutEffect(() => {
    rockEnabled.current = rockEnabledNow;
    const el = wobbleRef.current;
    if (!rockEnabledNow && el !== null) {
      el.removeAttribute('data-rock');
    }
  }, [rockEnabledNow]);
  useEffect(() => {
    const state: { generation: number; high: number; shake: number; parity: boolean; seen: Set<SceneMilestone> } = {
      generation: -1,
      high: 0,
      shake: 0,
      parity: false,
      seen: new Set(),
    };
    const baseline = (snap: ReturnType<typeof getSceneProgress>) => {
      state.generation = snap.generation;
      state.high = snap.count;
      state.seen = new Set(
        (Object.keys(snap.at) as SceneMilestone[]).filter((name) => snap.at[name] !== null),
      );
    };
    const startRock = (shake: number, at: number, milestone: SceneMilestone) => {
      const el = wobbleRef.current;
      if (el === null || !rockEnabled.current) return;
      state.parity = !state.parity;
      el.dataset.shake = String(shake);
      el.dataset.rock = state.parity ? 'a' : 'b';
      const rock = el
        .getAnimations()
        .find((animation) => animation instanceof CSSAnimation && isRockName(animation.animationName));
      if (rock === undefined) return;
      // Pinned to the rise (same clock as performance.now()).
      rock.startTime = at;
      // The `rockStart` evidence is written from the rock's own
      // `animationstart` (wave-2 r3: stamped here it read lag 0 by
      // construction) — see the listener below.
      el.dataset.milestone = milestone;
      el.dataset.generation = String(state.generation);
    };
    const onProgress = () => {
      const snap = getSceneProgress();
      if (snap.generation !== state.generation) {
        baseline(snap);
        return;
      }
      if (snap.count <= state.high) {
        // A dip (a canvas remount releasing its presence milestones): the
        // mark stays, the names re-arm so the climb back is recognised but
        // never rocks (it does not pass the mark).
        for (const name of [...state.seen]) if (snap.at[name] === null) state.seen.delete(name);
        return;
      }
      const risen = (Object.keys(snap.at) as SceneMilestone[])
        .filter((name) => snap.at[name] !== null && !state.seen.has(name))
        .sort((a, b) => (snap.at[a] ?? 0) - (snap.at[b] ?? 0));
      const owed = snap.count - state.high;
      state.high = snap.count;
      for (const name of risen) state.seen.add(name);
      // One rock per milestone above the mark (the newest names, in stamp order).
      for (const name of risen.slice(-owed)) {
        state.shake += 1;
        const at = snap.at[name] ?? performance.now();
        noteWobbleTrace(
          { kind: 'rise', shake: state.shake, settledShake: state.shake - 1, wobbling: rockEnabled.current, milestones: snap.count, milestone: name, generation: snap.generation },
          at,
        );
        startRock(state.shake, at, name);
      }
    };
    baseline(getSceneProgress());
    return subscribeSceneProgress(onProgress);
  }, []);

  /*
   * BEAM PRE-RASTER, STAGGERED (R6: the 317 ms post-ball stall was every beam
   * layer rastered in the first docked frame — `ball-loader-state`
   * BEAM_PRERASTER). While the ball is docked and loading, the beam parts
   * are marked `data-warm` one step at a time (their `data-beam-step`), so
   * each step's layers raster as their own small GPU task; only a marked
   * part sits at the pre-raster opacity (BallLoader.module.css). React never
   * renders `data-warm`, so a re-render keeps the marks; a remounted beam (a
   * new ball) starts unmarked and the effect runs again with it.
   */
  const prerasterOn = visible && ball.phase === 'loading' && !revealing && !reduced;
  useEffect(() => {
    if (!prerasterOn) return;
    const root = rootRef.current;
    if (root === null) return;
    const steps = beamPrerasterSteps(RAY_COUNT);
    let step = 0;
    let timer = 0;
    let frame = 0;
    const warmStep = () => {
      frame = 0;
      for (const part of Array.from(root.querySelectorAll<HTMLElement>(`[data-beam-step="${step}"]`))) {
        part.dataset.warm = '';
      }
      step += 1;
      if (step < steps) timer = window.setTimeout(queue, BEAM_PRERASTER.stepMs);
    };
    // On a frame boundary: the style change lands in that frame's commit.
    function queue(): void {
      timer = 0;
      frame = window.requestAnimationFrame(warmStep);
    }
    // Resume where a previous run left off (marks survive on the elements).
    while (step < steps && root.querySelector(`[data-beam-step="${step}"]:not([data-warm])`) === null) step += 1;
    if (step < steps) timer = window.setTimeout(queue, BEAM_PRERASTER.startDelayMs);
    return () => {
      if (timer !== 0) window.clearTimeout(timer);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [prerasterOn]);

  // A rock that ENDED or was CANCELLED drops its attribute, so no later
  // restyle (a reveal's `animation: none` lifting on an abort, a
  // `data-reduced` flip) can replay it. Native listeners — React has no
  // `animationcancel` prop. Trace mode also records the events.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const trace = (event: AnimationEvent) => {
      if (!traceRef.current) return;
      const target = event.target;
      const shakeAttr = target instanceof HTMLElement ? target.dataset.shake : undefined;
      noteWobbleTrace({
        kind: event.type as 'animationstart' | 'animationend' | 'animationcancel',
        shake: shakeAttr === undefined ? -1 : Number(shakeAttr),
        settledShake: -1,
        wobbling: target instanceof HTMLElement && target.hasAttribute('data-rock'),
        animationName: event.animationName,
        target: describeTarget(target),
      });
    };
    // Rock evidence (wave-2 r3): one `rockStart` per rock, stamped with the
    // `animationstart` event's own time (`event.timeStamp`, same clock as
    // `performance.now()`), plus the rock's pinned `startTime`.
    const onStart = (event: AnimationEvent) => {
      trace(event);
      const target = event.target;
      if (!(target instanceof HTMLElement) || target !== wobbleRef.current) return;
      if (event.pseudoElement !== '' || !isRockName(event.animationName)) return;
      const rock = target
        .getAnimations()
        .find((animation) => animation instanceof CSSAnimation && animation.animationName === event.animationName);
      const startTime = rock?.startTime;
      const milestone = target.dataset.milestone as SceneMilestone | undefined;
      noteWobbleTrace(
        {
          kind: 'rockStart',
          shake: Number(target.dataset.shake ?? -1),
          settledShake: Number(target.dataset.shake ?? 0) - 1,
          wobbling: true,
          startTime: typeof startTime === 'number' ? startTime : undefined,
          milestone,
          generation: target.dataset.generation === undefined ? undefined : Number(target.dataset.generation),
          animationName: event.animationName,
        },
        event.timeStamp,
      );
    };
    const onSettled = (event: AnimationEvent) => {
      trace(event);
      const target = event.target;
      if (!(target instanceof HTMLElement) || target !== wobbleRef.current) return;
      if (event.pseudoElement !== '' || !isRockName(event.animationName)) return;
      // Only the CURRENT rock settles (a restart cancels the previous one,
      // whose cancel event lands after the new rock's attribute is set).
      const current = target.getAnimations().some(
        (animation) => animation instanceof CSSAnimation && isRockName(animation.animationName) && animation.playState === 'running',
      );
      if (!current) target.removeAttribute('data-rock');
    };
    root.addEventListener('animationstart', onStart);
    root.addEventListener('animationend', onSettled);
    root.addEventListener('animationcancel', onSettled);
    return () => {
      root.removeEventListener('animationstart', onStart);
      root.removeEventListener('animationend', onSettled);
      root.removeEventListener('animationcancel', onSettled);
    };
  }, []);

  // Compositor-side life bound (review r5). The machine enforces the life
  // end only when the main thread runs; a Web Animation pinned to the
  // TIMELINE (`startTime` = life end − fade) fades the whole loader to 0 by
  // the life end on the compositor however stalled the page is. It is a
  // failure bound, not a ceremony beat: it carries the id `ball-life-bound`
  // and the ceremony trace leaves it out.
  const lifeBegunAt = ball.begunAt;
  const lifeDeadlineMs = ball.deadlineMs;
  const lifeGeneration = ball.generation;
  useEffect(() => {
    const root = rootRef.current;
    if (!visible || root === null || typeof root.animate !== 'function') return;
    const fadeMs = BALL_TIMING.abortFadeMs;
    const bound = root.animate([{ opacity: 0 }], { duration: fadeMs, fill: 'forwards', id: LIFE_BOUND_ID });
    bound.startTime = ballLifeEndAt(lifeBegunAt, lifeDeadlineMs) - fadeMs;
    return () => bound.cancel();
  }, [visible, lifeBegunAt, lifeDeadlineMs, lifeGeneration]);

  // The ceremony timeline's REAL start (wave 2): read the anchor (the flight
  // carrier's own animation, present on every path) once it has a start time
  // and feed it to the machine, which then never unmounts the ball before
  // that timeline's end. Trace mode also records the whole ceremony's
  // animations with the properties they animate.
  const traceInfo = useRef({
    mode: plan?.mode ?? 'full',
    scale: 1,
    beamScale: 1,
    remainingMs: -1,
    leadMs: 0,
    commitAt: -1,
    generation: -1,
  });
  useLayoutEffect(() => {
    const anchor = ball.openedAt >= 0 ? ball.openedAt : routeRevealArmedAt;
    traceInfo.current = {
      mode: plan?.mode ?? 'full',
      scale: plan?.scale ?? 1,
      beamScale: plan?.beamScale ?? 1,
      remainingMs: anchor === null ? -1 : Math.round(ballLifeEndAt(ball.begunAt, ball.deadlineMs) - anchor),
      leadMs: plan?.leadMs ?? 0,
      commitAt: ball.revealCommitAt,
      generation: ball.generation,
    };
  });
  useEffect(() => {
    if (revealKey === null) return;
    let frame = 0;
    let tries = 0;
    const read = () => {
      frame = 0;
      const anchor = flightRef.current
        ?.getAnimations()
        .find(
          (animation) =>
            animation instanceof CSSAnimation &&
            /(^|_)(ballFly|ballPop|fadeOut)($|_)/.test(animation.animationName) &&
            typeof animation.startTime === 'number',
        );
      const start = anchor?.startTime;
      if (typeof start === 'number') {
        setTimeline({ key: revealKey, at: start });
        if (traceRef.current) {
          const canvas = document.querySelector<HTMLElement>('[data-route-canvas]');
          const running = [
            ...(rootRef.current?.getAnimations({ subtree: true }) ?? []),
            ...(canvas?.getAnimations() ?? []),
          ].filter((animation) => animation.id !== LIFE_BOUND_ID);
          const info = traceInfo.current;
          noteCeremonyTrace({
            generation: info.generation,
            mode: info.mode,
            scale: info.scale,
            beamScale: info.beamScale,
            remainingMs: info.remainingMs,
            leadMs: info.leadMs,
            commitAt: info.commitAt,
            timelineStart: start,
            animations: running
              .map(describeAnimation)
              .filter((entry): entry is CeremonyAnimation => entry !== null),
          });
        }
        return;
      }
      if ((tries += 1) < 240) frame = window.requestAnimationFrame(read);
    };
    frame = window.requestAnimationFrame(read);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [revealKey]);

  const overPage = ball.phase === 'loading' && !revealing;

  /*
   * CHIP PLACEMENT (wave-2 r2: at 390 the docked ball was clipped by the
   * right edge and sat on a table row; at 1440 it read as a stray icon over
   * a heading). The ball and its status line form one chip, placed by the
   * pure keep-out law `placeLoaderChip`: entirely inside the viewport with a
   * ≥ 16 px gutter and the safe-area insets, at the spot nearest the bottom
   * centre that covers NO visible page text, interactive element, site
   * NavBar or route HUD (wave-2 r3: 8 px padding, controls included). With
   * no clear slot in the lower band it searches the whole viewport, and
   * failing that docks as a compact row in the bottom HUD band
   * (`data-chip="band"`) instead of over the page. The dock is written as
   * `--dock-x` / `--dock-y` on the loader root (inline, over the CSS
   * defaults); the reveal flight starts there at every width.
   *
   * LATCHED (wave-2 r3: the 390 chip took four positions in one load): the
   * chip is placed ONCE when the ball docks (after the fonts settle, hidden
   * until then — `data-placed`) and re-placed only on a resize / orientation
   * change, or when a scroll left it covering text or a control. It never
   * moves on a timer.
   */
  useEffect(() => {
    if (!overPage || !visible) return;
    const root = rootRef.current;
    const chip = chipRef.current;
    const ballEl = ballRef.current;
    const safe = safeRef.current;
    if (root === null || chip === null || ballEl === null) return;
    let frame = 0;
    let idle = 0;
    let unstyled = 0;
    let unstyledTries = 0;
    let cancelled = false;
    let placedOnce = false;
    const viewportNow = () => new DOMRect(0, 0, document.documentElement.clientWidth, window.innerHeight);
    const place = () => {
      frame = 0;
      // The layout viewport, not the root's box: before the loader's CSS
      // module has applied (dev, a late stylesheet) the root is not yet
      // fixed and its box is the whole page (a probe docked it 4.8k px down).
      const viewport = viewportNow();
      if (viewport.width === 0 || viewport.height === 0) return;
      if (getComputedStyle(root).position !== 'fixed') {
        // Every frame for 240 tries (the flight-timeline read's bound), then
        // at the resize cadence: a stylesheet that never applies costs no
        // per-frame style read, and a late one still gets the chip placed
        // (unplaced, it stays hidden — `data-placed`).
        if ((unstyledTries += 1) < 240) {
          request();
        } else {
          window.clearTimeout(unstyled);
          unstyled = window.setTimeout(request, 150);
        }
        return;
      }
      // Measure the full chip (a re-place may start from the band row).
      delete root.dataset.chip;
      const rootStyle = getComputedStyle(root);
      const dockScale = Number.parseFloat(rootStyle.getPropertyValue('--dock-scale')) || 1;
      const chipPad = Number.parseFloat(rootStyle.getPropertyValue('--chip-pad')) || 8;
      const dockSize = ballEl.offsetWidth * dockScale;
      const insets = safe !== null ? getComputedStyle(safe) : null;
      const chipW = chip.offsetWidth;
      const placed = placeLoaderChip({
        viewport: { width: viewport.width, height: viewport.height },
        chip: { width: chipW, height: chip.offsetHeight },
        gutterPx: CHIP_GUTTER_PX,
        insets: {
          top: insets ? Number.parseFloat(insets.paddingTop) || 0 : 0,
          right: insets ? Number.parseFloat(insets.paddingRight) || 0 : 0,
          bottom: insets ? Number.parseFloat(insets.paddingBottom) || 0 : 0,
          left: insets ? Number.parseFloat(insets.paddingLeft) || 0 : 0,
        },
        obstacles: collectKeepOut(viewport, root),
        band: { width: Math.min(BAND_CHIP_W, viewport.width - 8), height: Math.round(dockSize + chipPad * 2) },
      });
      // The chip is laid out around the dock: centred on it horizontally,
      // its top `chipPad` above the docked ball; in the band row the ball
      // sits at the row's left, the line beside it.
      const dockX = placed.band
        ? placed.left + chipPad + dockSize / 2 - viewport.width / 2
        : placed.left + chipW / 2 - viewport.width / 2;
      const dockY = placed.top + chipPad + dockSize / 2 - viewport.height / 2;
      root.style.setProperty('--dock-x', `${Math.round(dockX)}px`);
      root.style.setProperty('--dock-y', `${Math.round(dockY)}px`);
      root.dataset.chip = placed.band ? 'band' : placed.clear ? 'clear' : 'overlap';
      root.dataset.placed = '';
      placedOnce = true;
      if (traceRef.current) {
        const host = window as Window & { __ballChipPlacements?: Array<{ t: number; x: number; y: number; mode: string }> };
        (host.__ballChipPlacements ??= []).push({
          t: performance.now(),
          x: Math.round(dockX),
          y: Math.round(dockY),
          mode: root.dataset.chip,
        });
      }
    };
    const request = () => {
      if (!cancelled && frame === 0) frame = window.requestAnimationFrame(place);
    };
    const onResize = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(request, 150);
    };
    // A scroll re-places only when it left the chip covering the page.
    const onScroll = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        if (root.dataset.placed !== undefined && chipCovers(chip, viewportNow(), root)) request();
      }, 150);
    };
    // Once, after the web fonts settle (text boxes move when they swap in);
    // bounded so a hung font load never hides the ball.
    const first = () => {
      if (!placedOnce) request();
    };
    const fonts = document.fonts?.ready ?? Promise.resolve();
    const bound = window.setTimeout(first, 600);
    void fonts.then(first, first);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      cancelled = true;
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.clearTimeout(idle);
      window.clearTimeout(unstyled);
      window.clearTimeout(bound);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [overPage, visible]);

  // Trace self-check (never in production traffic: trace/debug params only).
  useEffect(() => {
    if (!traceOn || !overPage) return;
    let frame = 0;
    let last = 0;
    const run = () => {
      frame = 0;
      last = performance.now();
      const target = chipRef.current ?? ballRef.current;
      if (target !== null) checkBallOverText(target, ball.phase);
    };
    const onScroll = () => {
      if (frame !== 0 || performance.now() - last < 250) return;
      frame = window.requestAnimationFrame(run);
    };
    // After the first placement pass (the chip docks, then is checked).
    const first = window.setTimeout(() => {
      frame = window.requestAnimationFrame(run);
    }, 500);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(first);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [traceOn, overPage, ball.phase, ball.shakes]);

  // Progress truth (wave-2 r3: the ball opened while the chip still read
  // "Welt wird aufgebaut · 3/4"). Since D23 the gate arms only on the
  // complete world (six real milestones, "n/6"). The arm commit switches the line to the world's `ready`
  // copy ("Welt bereit" / "World ready", no stage count), and the line stays
  // shown while it fades out WITH the chip (BallLoader.module.css), so the
  // last words on screen before the ball opens are always true. i18n D11:
  // the words follow the viewer's language, never the theme's.
  const locale = useLocale();
  const stageCopy = loaderStageCopy(locale);
  // ENGINE r5 (CAR r4: plaza sat on "Building the world · 4/6" for 7.6-9.3 s):
  // while the load warm runs, the VISIBLE line names its current step and a
  // real count (`loaderWarmLine`, read from the stall detector's signals at
  // 4 Hz). The live region keeps the milestone line, so a screen reader is
  // not told every count.
  const warmLineOn = active && visible && overPage && !revealPending;
  const [warmLine, setWarmLine] = useState<string | null>(null);
  const milestoneCount = sceneProgress.generation === sceneGeneration ? sceneProgress.count : 0;
  useEffect(() => {
    if (!warmLineOn) {
      setWarmLine(null);
      return;
    }
    const read = () => {
      const next = loaderWarmLine(locale, getLoadSignals(), milestoneCount);
      setWarmLine((current) => (current === next ? current : next));
    };
    read();
    const timer = window.setInterval(read, WARM_LINE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [warmLineOn, locale, milestoneCount]);
  const statusLine =
    !active || !visible || ball.phase === 'aborted'
      ? ''
      : overPage && !revealPending
        ? loaderStageLine(locale, sceneProgress.generation === sceneGeneration ? sceneProgress : { renderer: false, assets: false, firstFrame: false, count: 0 })
        : stageCopy.ready;

  return (
    <div
      ref={rootRef}
      data-ball-loader=""
      data-ball-phase={ball.phase}
      data-ceremony={revealing && plan !== null ? plan.mode : undefined}
      data-reduced={reduced ? '' : undefined}
      data-revealing={revealing ? '' : undefined}
      data-released={released ? '' : undefined}
      className={styles.root}
    >
      <div ref={safeRef} aria-hidden="true" className={styles.safeProbe} />
      {visible ? (
        <div aria-hidden="true">
          {/* The chip replaces the r2–r5 radial scrim: a surface, not a halo. */}
          <div ref={chipRef} className={styles.chip} />
          <div className={styles.beam}>
            <div className={styles.glow} data-beam-step={beamPrerasterStep('glow', 0, RAY_COUNT)} />
            <div className={styles.sweep} data-beam-step={beamPrerasterStep('sweep', 0, RAY_COUNT)} />
            {RAYS.map((index) => (
              <span
                key={index}
                className={styles.ray}
                data-beam-step={beamPrerasterStep('ray', index, RAY_COUNT)}
                style={
                  {
                    '--ray-angle': `${(index * 360) / RAY_COUNT + 15}deg`,
                    '--ray-delay': `${(index % 2) * 30}ms`,
                  } as CSSProperties
                }
              />
            ))}
            <div className={styles.ring} data-beam-step={beamPrerasterStep('ring', 0, RAY_COUNT)} />
            <div className={styles.core} data-beam-step={beamPrerasterStep('core', 0, RAY_COUNT)} />
            {SPARKS.map((index) => (
              <span
                key={index}
                className={styles.spark}
                data-beam-step={beamPrerasterStep('spark', index, RAY_COUNT)}
                style={
                  {
                    '--spark-angle': `${(index * 360) / SPARK_COUNT + 9}deg`,
                    '--spark-delay': `${(index % 3) * 40}ms`,
                    '--spark-reach': `${34 + (index % 4) * 8}vmin`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          {/* R6 E8: the route HUD's glass effects, shown for a moment at the
              pre-raster opacity (one BEAM_PRERASTER step), so their programs
              link while docked — not in the arm frame that pre-rasters the HUD. */}
          <div className={styles.hudPrimer} data-beam-step={beamPrerasterStep('hud', 0, RAY_COUNT)}>
            A
          </div>
          <div ref={flightRef} className={styles.flight}>
            {/* One stable element: rocks are started imperatively from the
                progress store (`data-rock` a / b, never set by React), one
                per milestone rise. */}
            <div ref={wobbleRef} className={styles.wobble}>
              <div ref={ballRef} className={styles.ball}>
                <div className={styles.mouth} />
                <div className={styles.lower} />
                <div className={styles.lid}>
                  <div className={styles.upper} />
                  <div className={styles.lidInner} />
                </div>
                <div className={styles.band} />
                <div className={styles.button}>
                  <span className={styles.buttonCore} />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {/* The chip's status line: the ONE polite live region of the loader,
          always mounted (a region inserted with its text is often not
          announced), shown on the chip only while the ball is docked. */}
      <p
        role="status"
        aria-live="polite"
        className={styles.status}
        data-shown={visible && ball.phase !== 'aborted' && (overPage || revealing) ? '' : undefined}
      >
        {warmLineOn && warmLine !== null && statusLine !== '' ? (
          <>
            <span aria-hidden="true">{warmLine}</span>
            <span className="sr-only">{statusLine}</span>
          </>
        ) : (
          statusLine
        )}
        {statusLine !== '' && overPage ? <span className="sr-only"> {stageCopy.usable}</span> : null}
      </p>
    </div>
  );
}
