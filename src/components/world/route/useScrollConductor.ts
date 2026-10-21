'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { WORLD_MOTION } from '@/lib/motion/tokens';
import {
  createDirectionLatch,
  createInputIntent,
  resolveInputIntent,
  seedStationLatch,
  stepDirectionLatch,
  stepInputIntent,
  stepStationLatch,
  type DirectionLatchOptions,
  type DirectionLatchState,
  type InputIntentOptions,
  type InputIntentState,
} from '@/lib/route-world/direction-latch';
import {
  EMPTY_SCROLL_MAP,
  handoffProgress,
  measureScrollMap,
  plateauAt,
  progressFromScroll,
  scrollFromProgress,
  stationScrollTarget,
  type ScrollMap,
  type SectionLayout,
  type StationGeometry,
} from '@/lib/route-world/scroll-map';
import { isSkipJump } from '@/lib/route-world/camera-path';

/**
 * The single source of route progress.
 *
 * Everything downstream — camera, world-state channels, nav highlight,
 * interaction gating, asset prefetch — reads this. Nothing computes its own
 * chapter rules, which is what keeps the DOM and the 3D from ever telling
 * different stories.
 *
 * Progress is expressed in **station units**: 0 at the first station, 1 at
 * the second, and so on, with fractional values in between. It is derived
 * from the measured geometry of the real `<section>` elements, so a station's
 * dwell follows the length of its content and a copy edit can never desync
 * the world.
 *
 * There is no animation loop here. `exact` is pure arithmetic over cached
 * anchors, computed in a passive scroll listener, so an idle page costs
 * nothing. `smooth` is advanced by whoever is already running a frame loop —
 * in practice the canvas — via `advanceSmooth`.
 *
 * W6: the map is continuous and monotone (`scroll-map.ts`). Hold stations
 * own a plateau where `exact` sits exactly on the integer while the section
 * is start-aligned — no longer a pin that overwrote `exact` and `smooth`,
 * which snapped the camera backward when scrolling down through the band
 * and made two of five nav chips teleport. `smooth` stays a first-order
 * follower (no overshoot); every nav chip now flies the same way.
 */

/**
 * Travel-direction latch (bar W6): leaving rest or reversing needs 0.02
 * station units of displacement from the furthest point reached, and a
 * latched direction holds at least 0.2 s — so momentum tails, rubber-band
 * overscroll and single noisy samples cannot flip it mid-gesture.
 */
const DIRECTION_LATCH: DirectionLatchOptions = { deadband: 0.02, minDwell: 0.2, idleAfter: 0.6 };

/** Stillness after which the frame loop drops `direction` to 0 (see advanceSmooth). */
export const DIRECTION_REST_S = DIRECTION_LATCH.idleAfter ?? 0.6;

/**
 * Input-intent override (wave-2 r2, W6 gap "stale latch"). The latch above
 * steps only on scroll samples and holds a fresh direction for `minDwell`, so
 * it stayed -1 for 450+ ms at the scroll-end clamp while every wheel step
 * said forward and `smooth` advanced (no scroll sample arrives once `exact`
 * is clamped), and lagged ~230 ms on the first forward steps after a
 * backward jitter step. The frame loop now flips a direction that points
 * against the held input once 2 consecutive discrete input steps (wheel /
 * key) carried the same sign AND `smooth` moved `deadband` that way since the
 * run began. An alternating dither never builds a run of 2, so the deadband +
 * dwell hysteresis still owns the x.5 noise case.
 */
const INPUT_INTENT: InputIntentOptions = {
  minRun: 2,
  eps: DIRECTION_LATCH.deadband,
  staleAfter: DIRECTION_LATCH.idleAfter ?? 0.6,
};

/**
 * Scroll samples count as intent steps only when no discrete input (wheel /
 * key) arrived within this window (s) — touch, scrollbar drags, programmatic
 * scrolls. Inside it the wheel owns the count: one smooth-scrolled wheel notch
 * fans out into several scroll events and must stay ONE step.
 */
const DISCRETE_INPUT_WINDOW_S = 0.3;

/** Keys that page the route, by the direction they travel. */
const KEY_INTENT: Readonly<Record<string, -1 | 1>> = {
  ArrowDown: 1,
  PageDown: 1,
  End: 1,
  ArrowUp: -1,
  PageUp: -1,
  Home: -1,
};

/**
 * The class `HideHtmlOnRoute` writes on `<html>` at the route handoff. Under
 * it every `[data-world-route] section` outside a dialog is one viewport
 * tall (globals.css);
 * without it the sections carry their full semantic tables.
 */
const ROUTE_LIVE_CLASS = 'world-route-live';

/**
 * After a layout-flip restore, scroll events landing within this many px of
 * the restored offset (and inside RESTORE_WINDOW_MS) are the restore's own
 * echo — sampled as a re-measure, never as travel, direction or a jump.
 */
const RESTORE_TOLERANCE_PX = 2;
const RESTORE_WINDOW_MS = 250;

/**
 * How long a deep link on load (`#schedule`) keeps retrying to land while
 * the streamed sections grow — the scene's own 10 s readiness deadline.
 */
const HASH_LAND_WINDOW_MS = 10_000;

function readSectionLayout(): SectionLayout {
  return document.documentElement.classList.contains(ROUTE_LIVE_CLASS) ? 'route' : 'semantic';
}

export interface RouteProgress {
  /** Untweened progress in station units. Drives nav, anchors, gating. */
  exact: number;
  /** Damped progress in station units. Drives camera and visuals only. */
  smooth: number;
  /** The station currently occupied — `floor(exact)`, clamped. */
  index: number;
  /** Progress within the current station, 0..1. */
  localT: number;
  /**
   * Latched travel direction: -1 scrolling up, +1 scrolling down, 0 at rest
   * (`direction-latch.ts` — deadband + minimum dwell, never a raw sign).
   */
  direction: -1 | 0 | 1;
  /** Signed rate of change in station units per second. */
  velocity: number;
  /**
   * Hold station whose plateau the scroll offset sits on, or null. Hold ids
   * come from the route theme (`RouteThemeDefinition.holdIds`). A readout
   * only: on a plateau `exact` already IS the integer (`scroll-map.ts`), so
   * nothing is overridden and `smooth` simply damps onto it.
   */
  pin: number | null;
  /**
   * THE nearest-station signal: hysteretic (±NEAREST_STATION_BAND past each
   * midpoint), stepped from `exact` on every sample — in the route layout
   * (`html.world-route-live`). In the semantic layout (Lite, and the route
   * tier while the scene loads) it is `index`, the section the reader is in,
   * so the chip seen during the load is the station the reveal restores
   * (the layout-flip fix below). Every "which station am
   * I at" consumer reads this (or `useNearestStation`), never its own round.
   */
  nearest: number;
  /**
   * Last programmatic multi-station jump (nav chip, hash, Home/End):
   * `token` increments per jump; `from` is `smooth` and `to` is `exact` at
   * the moment it was detected. The rig skips through on it (camera-path).
   */
  jump: { token: number; from: number; to: number };
  /**
   * Debug readouts (W6 round 2, surfaced through `__routeWorldProbe`): what
   * the last sample was — `travel` (visitor or programmatic scroll),
   * `echo` (a layout-flip / deep-link restore's own scroll event),
   * `remeasure` (geometry re-read, no input), or `sync` (a scroll offset that
   * moved before its scroll event was dispatched, picked up by
   * `RouteConductor.sync`) — and the version of the scroll map it was read
   * against (bumped on every geometry read).
   */
  lastSampleKind: SampleKind;
  mapVersion: number;
  /** scrollY the last sample read. */
  sampleScrollY: number;
  /**
   * Increments whenever the conductor deliberately SETTLES `smooth` onto
   * `exact` (first measurement, a deep-link landing while hidden, a layout
   * flip — each happens with the canvas invisible). Rate-limited followers
   * (the rig's turn limiter) snap on it instead of turning into place.
   */
  settleToken: number;
}

export type SampleKind = 'travel' | 'echo' | 'remeasure' | 'sync';

export interface RouteConductor {
  /** Mutable per-frame state. Reading it never triggers a React render. */
  progress: React.RefObject<RouteProgress>;
  /** Station index mirrored into React state, for DOM consumers. */
  activeIndex: number;
  /** True once the first measurement has landed. */
  measured: boolean;
  /**
   * The station ids the conductor measures, in route order — the index space
   * of `activeIndex` / `progress.index`. Nav consumers whose own section list
   * may be a subset (or a different list entirely) must map through these ids
   * rather than using the raw index (PR #63 review).
   */
  stationIds: readonly string[];
  /** Force a re-measure — call after content changes section heights. */
  remeasure: () => void;
  /**
   * Change channel: the listener runs synchronously after every sample —
   * scroll AND re-measure — so DOM consumers commit before the next frame
   * and never miss a position change that arrived without a scroll event.
   */
  subscribe: (listener: () => void) => () => void;
  /**
   * Re-sample now if `window.scrollY` moved since the last sample (W6 round
   * 2). Scroll events are dispatched in the rendering step, so under a long
   * frame (a mid-crossing mount, a shader compile) a programmatic
   * `scrollTo` can sit un-sampled for seconds and every read of `progress`
   * returns the pre-seek value — the harness saw `exact=3.048` for two
   * different seek targets. The canvas calls this each frame and the probe
   * before each read. Cheap: one `scrollY` read when nothing moved.
   */
  sync: () => void;
  /**
   * Land exactly on a station (W6 round 3): scroll to the offset where the
   * conductor reads that station's integer (`stationScrollTarget`), not the
   * browser's fragment offset, which sits 0.2 station past a plain station.
   * Instant, like the fragment jump it replaces (the rig skips through it).
   * Returns false when `id` is not a station or nothing is measured yet — the
   * caller then lets the browser's own fragment navigation run.
   */
  goToStation: (id: string) => boolean;
}

function createProgress(): RouteProgress {
  return {
    exact: 0,
    smooth: 0,
    index: 0,
    localT: 0,
    direction: 0,
    velocity: 0,
    pin: null,
    nearest: 0,
    jump: { token: 0, from: 0, to: 0 },
    lastSampleKind: 'remeasure',
    mapVersion: 0,
    sampleScrollY: 0,
    settleToken: 0,
  };
}

function scrollMarginTopPx(element: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(element).scrollMarginTop);
  return Number.isFinite(value) ? value : 0;
}

/** Read the live section geometry the pure scroll map is built from. */
function readScrollMap(ids: readonly string[], holdIds: readonly string[]): ScrollMap {
  const stations: StationGeometry[] = ids.map((id) => {
    const element = document.getElementById(id);
    return {
      top: element ? element.getBoundingClientRect().top + window.scrollY : null,
      scrollMarginTop: element ? scrollMarginTopPx(element) : 0,
      hold: holdIds.includes(id),
    };
  });
  return measureScrollMap({
    stations,
    viewport: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
  });
}

/**
 * Idle settle snap (W6 round 2: plaza `#rules` failed its settle on
 * smooth=3.9789 vs exact=4). The exponential follower only approaches
 * `exact` asymptotically, and with the delta clamp at a slow headless frame
 * rate the tail takes seconds of wall time. Once `exact` has been still for
 * SMOOTH_SNAP_STILL_S and sits within SMOOTH_SNAP_STATION_EPS of a station
 * integer, a residual under SMOOTH_SNAP_EPS snaps: at a station the crossing
 * ease has ~zero slope, so the pose moves by well under a degree (and the
 * rig's turn-rate limiter absorbs even that). Mid-crossing rests (a
 * start-aligned roster at 0.22) never snap — there the ease is steep.
 */
export const SMOOTH_SNAP_EPS = 0.02;
export const SMOOTH_SNAP_STATION_EPS = 0.03;
export const SMOOTH_SNAP_STILL_S = 0.25;

/**
 * Station landing snap (review r5, W6): at 390 the anchor offsets round to
 * whole pixels, so a chip landing reads `exact = 1.000474` (roster, scrollY
 * 676) and `2.000527` (teams) and never the integer — the next corridor stays
 * live at weight 0.0005 and the station is never "arrived". Once the input
 * has been idle for SMOOTH_SNAP_STILL_S and `exact` sits within this of a
 * station integer, `exact` itself snaps to the integer (and `smooth` follows
 * through the ordinary snap). The next real sample re-reads the offset.
 */
export const EXACT_STATION_SNAP_EPS = 0.002;

// ── Skip-through lifecycle for the station windows (wave 2, W6 residual 1) ──
//
// The r5 judge measured the plaza pulse → schedule chip jump freezing
// 250–267 ms MID-skip: `goToStation` lands `exact` (and so the nearest latch)
// on the target in ONE sample, so every residency window whose bounds contain
// the target latched in that same commit — including the populations of the
// stations the camera only skims past (roster, teams) — and their GLB parse,
// commit and first uploads landed inside the flight. The rig's pose blend
// (`CameraRig`) is a visual concern with its own damped release; THIS record
// is what the window hooks gate on (`useSkipGate` in `useStationWarmup`):
// which jump is in flight, whether `smooth` has covered SKIP_APPROACH of it,
// and how it ended. It lives beside the progress object (a WeakMap, like the
// snap channel) rather than on `RouteProgress`, so progress literals built by
// tests and fixtures stay valid.

/** How a skip-through ended (null while it is in flight). */
export type SkipEnd = 'landed' | 'input' | 'timeout' | 'layout';

export interface SkipThrough {
  /** The `jump.token` that started it; 0 = no skip yet this session. */
  token: number;
  active: boolean;
  /** `smooth` at the jump (fractional when a second chip re-aims mid-skip). */
  from: number;
  /** The target station (integer). */
  to: number;
  /** `smooth` has covered SKIP_APPROACH of the span: target windows may latch. */
  approaching: boolean;
  /** Wall seconds in flight (the SKIP_MAX_S cap). Mutated in place. */
  elapsed: number;
  end: SkipEnd | null;
}

/** Fraction of the jump `smooth` must cover before the target's windows latch. */
export const SKIP_APPROACH = 0.5;
/** `smooth` within this of the target lands the skip (the idle snap closes the rest). */
export const SKIP_LAND_EPS = 0.02;
/** `exact` this far off the target on a travel sample is visitor input (the rig's own eps). */
export const SKIP_INPUT_EPS = 0.02;
/**
 * Wall-clock cap. At cameraDamping 5.2 a four-station jump reaches the land
 * band in ≈ 1.2 s; the cap only matters when frames stall (the follower's dt
 * clamp slows it) — the windows then stop waiting and latch staggered.
 */
export const SKIP_MAX_S = 3;

export const NO_SKIP: Readonly<SkipThrough> = Object.freeze({
  token: 0,
  active: false,
  from: 0,
  to: 0,
  approaching: false,
  elapsed: 0,
  end: null,
});

const skipThroughs = new WeakMap<RouteProgress, SkipThrough>();

/** The skip-through record of a progress object (NO_SKIP before the first jump). */
export function skipThroughOf(progress: RouteProgress | null | undefined): Readonly<SkipThrough> {
  return (progress ? skipThroughs.get(progress) : undefined) ?? NO_SKIP;
}

/** Start (or re-aim) a skip-through. Always a new record, so snapshots see it. */
export function beginSkipThrough(progress: RouteProgress, token: number, from: number, to: number): SkipThrough {
  const next: SkipThrough = { token, active: true, from, to, approaching: false, elapsed: 0, end: null };
  skipThroughs.set(progress, next);
  return next;
}

/** End the skip in flight; false (and nothing changes) when none is. */
export function endSkipThrough(progress: RouteProgress, end: SkipEnd): boolean {
  const skip = skipThroughOf(progress);
  if (!skip.active) return false;
  skipThroughs.set(progress, { ...skip, active: false, approaching: false, end });
  return true;
}

/**
 * Pure frame step of a skip in flight: the SAME record when only the clock
 * moved (so snapshot consumers do not re-render per frame), a new one on
 * approach, landing or timeout.
 */
export function stepSkipThrough(skip: SkipThrough, smooth: number, delta: number): SkipThrough {
  if (!skip.active) return skip;
  skip.elapsed += Math.max(0, delta);
  if (Math.abs(smooth - skip.to) <= SKIP_LAND_EPS) {
    return { ...skip, active: false, approaching: false, end: 'landed' };
  }
  if (skip.elapsed >= SKIP_MAX_S) return { ...skip, active: false, approaching: false, end: 'timeout' };
  if (!skip.approaching) {
    const span = skip.to - skip.from;
    const covered = Math.abs(span) < 1e-9 ? 1 : (smooth - skip.from) / span;
    if (covered >= SKIP_APPROACH) return { ...skip, approaching: true };
  }
  return skip;
}

const smoothTrack = new WeakMap<RouteProgress, { exact: number; still: number }>();

/**
 * Change channel the owning conductor registers for its progress object, so a
 * station snap applied in the frame loop (no scroll event) still reaches the
 * DOM consumers (`activeIndex`, `subscribe` listeners).
 */
const snapListeners = new WeakMap<RouteProgress, () => void>();

/** Station count the owning conductor measures (for the index clamp). */
const snapStationCount = new WeakMap<RouteProgress, number>();

/**
 * Rest decay of the travel direction (review r5). The direction latch only
 * steps on a scroll sample, so after the last event of a gesture (or a chip
 * jump) `direction` stayed ±1 for as long as the visitor rested — and the
 * idle station lead, which waits for `direction === 0`, re-armed forever: the
 * plaza aces never pre-mounted while the camera sat still on rules, and the
 * upward sweep paid their mount at its first sample. Once `exact` has been
 * still for the latch's own `idleAfter`, the frame loop drops the direction
 * to 0 and the owning conductor re-seeds its latch at the rest position.
 */
const directionRestListeners = new WeakMap<RouteProgress, () => void>();

/** Held input intent per progress object (see INPUT_INTENT). */
const inputIntents = new WeakMap<RouteProgress, InputIntentState>();

/** The owning conductor re-seats its latch when the frame loop applies an intent flip. */
const directionIntentListeners = new WeakMap<RouteProgress, (direction: -1 | 1) => void>();

/**
 * Advance the damped channel. Frame-rate independent exponential smoothing;
 * the delta is clamped so a stalled tab does not snap the camera on resume.
 */
export function advanceSmooth(progress: RouteProgress, delta: number): void {
  const dt = Math.min(delta, WORLD_MOTION.maxDelta);
  const alpha = 1 - Math.exp(-WORLD_MOTION.cameraDamping * dt);
  progress.smooth += (progress.exact - progress.smooth) * alpha;

  let track = smoothTrack.get(progress);
  if (!track) {
    track = { exact: progress.exact, still: 0 };
    smoothTrack.set(progress, track);
  }
  if (track.exact === progress.exact) {
    // Wall time, unclamped: stillness is about the visitor, not the frame.
    track.still += Math.max(0, delta);
  } else {
    track.exact = progress.exact;
    track.still = 0;
  }
  if (progress.direction !== 0 && track.still >= DIRECTION_REST_S) {
    progress.direction = 0;
    progress.velocity = 0;
    directionRestListeners.get(progress)?.();
  }
  const intent = inputIntents.get(progress);
  if (intent) {
    const resolved = resolveInputIntent(intent, progress.direction, progress.smooth, performance.now() / 1000, INPUT_INTENT);
    if (resolved.state !== intent) inputIntents.set(progress, resolved.state);
    if (resolved.flip !== null) {
      progress.direction = resolved.flip;
      directionIntentListeners.get(progress)?.(resolved.flip);
    }
  }
  const station = Math.round(progress.exact);
  const residual = Math.abs(progress.exact - station);
  if (residual > 0 && residual < EXACT_STATION_SNAP_EPS && track.still >= SMOOTH_SNAP_STILL_S) {
    const count = snapStationCount.get(progress);
    const index = count === undefined ? station : Math.min(count - 1, Math.max(0, station));
    progress.exact = station;
    progress.index = index;
    progress.localT = station - index;
    // Keep the stillness clock: the snap is not the visitor moving.
    track.exact = station;
    snapListeners.get(progress)?.();
  }
  // Skip-through phase (approach / landing / cap) → the window hooks, on the
  // same change channel as the station snap.
  const skip = skipThroughs.get(progress);
  if (skip?.active) {
    const next = stepSkipThrough(skip, progress.smooth, delta);
    if (next !== skip) {
      skipThroughs.set(progress, next);
      snapListeners.get(progress)?.();
    }
  }
  const gap = Math.abs(progress.exact - progress.smooth);
  if (
    gap > 0 &&
    gap < SMOOTH_SNAP_EPS &&
    track.still >= SMOOTH_SNAP_STILL_S &&
    Math.abs(progress.exact - Math.round(progress.exact)) < SMOOTH_SNAP_STATION_EPS
  ) {
    progress.smooth = progress.exact;
  }
}

/**
 * Whether a deep-link target is a station section or sits inside one (the
 * conductor lands those; any other anchor stays the browser's).
 */
export function isStationAnchor(
  element: Pick<Element, 'id' | 'parentElement'>,
  stationIds: readonly string[],
): boolean {
  for (let node: Pick<Element, 'id' | 'parentElement'> | null = element; node; node = node.parentElement) {
    if (node.id && stationIds.includes(node.id)) return true;
  }
  return false;
}

export function useScrollConductor(
  stationIds: readonly string[],
  holdIds: readonly string[] = [],
): RouteConductor {
  const progress = useRef<RouteProgress>(createProgress());
  const scrollMap = useRef<ScrollMap>(EMPTY_SCROLL_MAP);
  const lastSample = useRef({ exact: 0, time: 0 });
  /** Geometry the current map was read against (document height, viewport). */
  const mapBasis = useRef({ documentHeight: -1, viewport: -1 });
  /** Set by the subscribe effect: re-sample if scrollY moved un-dispatched. */
  const syncRef = useRef<() => void>(() => {});
  /** Set by the subscribe effect: land exactly on a station (nav chips). */
  const goToRef = useRef<(id: string) => boolean>(() => false);
  const directionLatch = useRef<DirectionLatchState>(createDirectionLatch(0, 0));
  const listeners = useRef(new Set<() => void>());
  const [activeIndex, setActiveIndex] = useState(0);
  const [measured, setMeasured] = useState(false);
  const [measureToken, setMeasureToken] = useState(0);

  // `stationIds` / `holdIds` are usually fresh arrays each render; key the
  // effects on identity of the contents instead so they do not re-run every
  // render.
  const idKey = stationIds.join('|');
  const holdKey = holdIds.join('|');
  const ids = useMemo(() => (idKey.length > 0 ? idKey.split('|') : []), [idKey]);

  const conductor = useMemo<RouteConductor>(
    () => ({
      progress,
      activeIndex,
      measured,
      stationIds: ids,
      remeasure: () => setMeasureToken((token) => token + 1),
      sync: () => syncRef.current(),
      goToStation: (id) => goToRef.current(id),
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    }),
    [activeIndex, measured, ids],
  );

  useEffect(() => {
    const holds = holdKey.length > 0 ? holdKey.split('|') : [];
    if (ids.length === 0) return;

    const state = progress.current;
    let frame = 0;
    // Settle guard owned by THIS effect instance. The `measured` state value
    // captured at subscribe time never updates inside the closure, so
    // guarding on it directly re-ran the first-measurement settle on every
    // remeasure (resize, ResizeObserver, font swap) — snapping the damped
    // camera channel to `exact` mid-scroll (PR #63 review).
    let settledOnce = measured;
    let layout = readSectionLayout();

    /**
     * `input` is true for a real scroll event. A re-measure moves `exact`
     * with no input (layout shift, font swap, resize): it must not register
     * as travel direction, velocity, or a jump — `smooth` simply damps to the
     * re-mapped position.
     */
    /** Re-read the map (and bump its version) against the live geometry. */
    const readMap = () => {
      scrollMap.current = readScrollMap(ids, holds);
      mapBasis.current = {
        documentHeight: document.documentElement.scrollHeight,
        viewport: window.innerHeight,
      };
      state.mapVersion += 1;
    };

    const sample = (
      input: boolean,
      seatStation: number | null = null,
      kind: SampleKind = input ? 'travel' : 'remeasure',
    ) => {
      // A document-height or viewport change that no ResizeObserver entry
      // has delivered yet (content outside the observed sections, a pending
      // rAF remeasure) would read this offset against the OLD anchors —
      // re-read the map first. `scrollHeight` is a layout read, but a
      // scroll handler normally runs against clean layout, so it is cheap.
      if (
        document.documentElement.scrollHeight !== mapBasis.current.documentHeight ||
        window.innerHeight !== mapBasis.current.viewport
      ) {
        readMap();
      }
      const scrollY = window.scrollY;
      const exact = progressFromScroll(scrollMap.current, scrollY);
      state.lastSampleKind = kind;
      state.sampleScrollY = scrollY;
      const now = performance.now();
      const previous = lastSample.current;

      state.pin = plateauAt(scrollMap.current, scrollY);
      state.exact = exact;
      state.index = Math.min(ids.length - 1, Math.max(0, Math.floor(exact)));
      state.localT = exact - state.index;
      // Semantic layout (Lite, and the route tier while the scene loads): the
      // station a reader is in is the section across the activation line —
      // `floor(exact)`, the same rule the Lite nav and the flip's `perceived`
      // use. Without this the route HUD pill (visible through the load)
      // highlighted the ROUNDED station ("Spielplan") over the lower half of
      // the Teams table, then jumped back to "Teams" at the reveal, and the
      // station windows pre-warmed a station the reveal never shows.
      state.nearest =
        layout === 'semantic'
          ? state.index
          : seatStation !== null
            ? seatStation
            : settledOnce
              ? stepStationLatch(state.nearest, exact, ids.length)
              : seedStationLatch(exact, ids.length);

      if (input) {
        const elapsed = (now - previous.time) / 1000;
        state.velocity = elapsed > 0 ? (exact - previous.exact) / elapsed : 0;
        directionLatch.current = stepDirectionLatch(directionLatch.current, exact, now / 1000, DIRECTION_LATCH);
        state.direction = directionLatch.current.direction;
        // Touch / scrollbar / programmatic travel carries no discrete event:
        // its scroll samples are the intent steps (see DISCRETE_INPUT_WINDOW_S).
        const moved = exact - previous.exact;
        if (Math.abs(moved) > 1e-4 && now / 1000 - lastDiscreteInput > DISCRETE_INPUT_WINDOW_S) {
          recordIntent(moved > 0 ? 1 : -1, now / 1000);
        }
        if (settledOnce && isSkipJump(previous.exact, exact, state.smooth)) {
          state.jump = { token: state.jump.token + 1, from: state.smooth, to: exact };
          // Marked BEFORE the listeners below run, so the window hooks see the
          // skip in the same commit as the jumped nearest station.
          const target = Math.min(ids.length - 1, Math.max(0, Math.round(exact)));
          beginSkipThrough(state, state.jump.token, state.smooth, target);
          skipStartedAt = now;
        } else if (Math.abs(exact - skipThroughOf(state).to) > SKIP_INPUT_EPS) {
          // The visitor scrolled off the target mid-skip: normal latching resumes.
          endSkipThrough(state, 'input');
        }
      } else {
        // Rebase the latch's extreme onto the re-mapped position (direction
        // and dwell kept) so the shift reads as neither travel nor reversal.
        directionLatch.current = { ...directionLatch.current, extreme: exact, lastMove: now / 1000 };
      }

      lastSample.current = { exact, time: now };
      setActiveIndex((current) => (current === state.index ? current : state.index));
      listeners.current.forEach((listener) => listener());
    };

    /** Time (s) of the last discrete input step (wheel notch / paging key). */
    let lastDiscreteInput = Number.NEGATIVE_INFINITY;
    inputIntents.set(state, createInputIntent());
    const recordIntent = (sign: -1 | 1, time: number) => {
      inputIntents.set(state, stepInputIntent(inputIntents.get(state) ?? createInputIntent(), sign, state.smooth, time));
    };
    const onIntentWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      lastDiscreteInput = performance.now() / 1000;
      recordIntent(event.deltaY > 0 ? 1 : -1, lastDiscreteInput);
    };
    const onIntentKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const sign = event.key === ' ' ? (event.shiftKey ? -1 : 1) : KEY_INTENT[event.key];
      if (sign === undefined) return;
      lastDiscreteInput = performance.now() / 1000;
      recordIntent(sign, lastDiscreteInput);
    };

    /** performance.now() at the last skip start (the gesture release compares to it). */
    let skipStartedAt = 0;

    /** Pending echo of a layout-flip restore (see RESTORE_TOLERANCE_PX). */
    let restore: { y: number; until: number } | null = null;

    const onScroll = () => {
      if (restore !== null) {
        const echo = performance.now() <= restore.until && Math.abs(window.scrollY - restore.y) <= RESTORE_TOLERANCE_PX;
        if (echo) {
          sample(false, null, 'echo');
          return;
        }
        // The visitor moved (or the window lapsed): ordinary input from here.
        restore = null;
      }
      sample(true);
    };

    /**
     * Deep link on load (`/…#schedule`): the browser's own fragment scroll
     * runs while the streamed sections are not in the document yet (measured
     * at 390: first frame 844 px tall, no #schedule), so it silently fails
     * and the visitor starts on Puls. The conductor lands it instead, on
     * every re-measure (the sections grow as they stream and hydrate) until
     * the target sits start-aligned, the visitor makes a gesture of their
     * own, the layout flips, or HASH_LAND_WINDOW_MS lapses. Only when the
     * page opened at the top and the fragment is a station or an anchor
     * inside one (`#league-hub` in Puls: the rules link's Lite exit is a full
     * load) — other anchors stay the browser's. An anchor may stream in
     * after the first measure, so that test runs when its element appears.
     */
    let pendingFragment: string | null = null;
    const fragmentDeadline = performance.now() + HASH_LAND_WINDOW_MS;
    if (!settledOnce && window.scrollY === 0 && window.location.hash.length > 1) {
      try {
        pendingFragment = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        pendingFragment = null;
      }
    }
    const dropFragment = () => {
      pendingFragment = null;
    };

    /** One landing attempt; true when it moved the page. */
    const landFragment = (): boolean => {
      if (pendingFragment === null) return false;
      if (performance.now() > fragmentDeadline) {
        pendingFragment = null;
        return false;
      }
      const element = document.getElementById(pendingFragment);
      if (!element) return false;
      if (!isStationAnchor(element, ids)) {
        pendingFragment = null;
        return false;
      }
      const before = window.scrollY;
      element.scrollIntoView({ block: 'start', behavior: 'instant' });
      const offset = element.getBoundingClientRect().top - scrollMarginTopPx(element);
      if (Math.abs(offset) <= RESTORE_TOLERANCE_PX) pendingFragment = null;
      if (Math.abs(window.scrollY - before) < 0.5) return false;
      restore = { y: window.scrollY, until: performance.now() + RESTORE_WINDOW_MS };
      return true;
    };

    const remeasure = () => {
      const landed = landFragment();
      readMap();
      // On the very first measurement, `smooth` has nothing to catch up to —
      // start it settled so a reload deep in the page does not fly the camera
      // in from the gate. Sample first: while `settledOnce` is still false
      // the nearest-station latch seeds without history.
      sample(false);
      if (!settledOnce) {
        settledOnce = true;
        state.smooth = state.exact;
        state.settleToken += 1;
        setMeasured(true);
      } else if (landed && layout === 'semantic') {
        // A later deep-link landing while the canvas is still hidden: settle
        // the camera there too (nothing on screen to fly). Once route-live it
        // simply damps, as a re-measure does.
        state.smooth = state.exact;
        state.settleToken += 1;
        state.velocity = 0;
      }
    };

    const scheduleRemeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(remeasure);
    };

    /**
     * Layout flip (Lite ⇄ route-live) — the station-preservation fix.
     *
     * Toggling `world-route-live` collapses (or re-expands) every section,
     * so the document height changes by ~10k px at phone width and the
     * browser clamps `scrollY` wherever it lands: the world used to reveal on
     * Rules while the visitor was reading Teams, and a Lite fallback dropped
     * them into another table. A MutationObserver callback is a microtask
     * after the class write — before any layout-driven scroll event and
     * before paint — so here `state.exact` is still the last sample against
     * the OLD anchors. We map it into the new layout's reading of the same
     * station (`handoffProgress`), re-measure, and scroll to the inverse of
     * the new plateau map (`scrollFromProgress`).
     *
     * The restore is not travel: it samples as a re-measure (no velocity,
     * no direction change, no skip-through jump), re-seats the nearest latch
     * on the visitor's station and snaps `smooth` — the canvas is at opacity
     * 0 on one side of every flip, so there is no camera flight to show.
     *
     * In-flight gestures: the restore is ONE instant scroll, never re-asserted.
     * Scroll events that are not its echo are the visitor's own input and
     * are sampled normally from the restored position. Limits (honest): a
     * browser-animated scroll in flight at the flip (keyboard PageDown smooth
     * scroll) is cancelled by the instant restore, and `state.exact` can be
     * one frame stale if a ResizeObserver remeasure was still pending when
     * the class flipped (the old geometry is gone by the time we observe).
     */
    const onLayoutMutation = () => {
      const next = readSectionLayout();
      if (next === layout) return;
      const from = layout;
      layout = next;
      // A flip re-seats the position with the canvas hidden: no flight to gate.
      endSkipThrough(state, 'layout');
      // The flip restore owns the position from here (a deep link that has
      // not landed yet is carried by the same exact-progress restore).
      pendingFragment = null;
      cancelAnimationFrame(frame);
      if (!settledOnce || scrollMap.current.lo.length < 2) {
        remeasure();
        return;
      }
      const perceived = from === 'route' ? state.nearest : state.index;
      const target = handoffProgress(state.exact, perceived, ids.length, next);
      readMap();
      // Ceil: never let a subpixel round-down read the previous station
      // (targets sit ≥ 0.05 station from the far edge, so ceil cannot cross).
      const y = Math.ceil(scrollFromProgress(scrollMap.current, target));
      window.scrollTo({ top: y, left: window.scrollX, behavior: 'instant' });
      restore = { y: window.scrollY, until: performance.now() + RESTORE_WINDOW_MS };
      // Re-seat the nearest latch on the perceived station, stepped against
      // where the scroll actually landed (a clamp on a short page may not
      // reach the target; then the latch moves on as usual).
      const landed = progressFromScroll(scrollMap.current, window.scrollY);
      const seat = stepStationLatch(Math.min(ids.length - 1, Math.max(0, perceived)), landed, ids.length);
      sample(false, seat, 'echo');
      state.smooth = state.exact;
      state.settleToken += 1;
      state.velocity = 0;
    };

    /**
     * Pick up a scroll offset whose scroll event has not been dispatched yet
     * (see `RouteConductor.sync`). Routed through `onScroll`, so a restore
     * echo is still classified as one; when the real event arrives later it
     * re-samples the same offset, which moves nothing.
     */
    syncRef.current = () => {
      if (!settledOnce) return;
      if (Math.abs(window.scrollY - state.sampleScrollY) < 0.5) return;
      onScroll();
      if (state.lastSampleKind === 'travel') state.lastSampleKind = 'sync';
    };

    goToRef.current = (id) => {
      const index = ids.indexOf(id);
      if (index < 0 || !settledOnce || scrollMap.current.lo.length < 2) return false;
      if (
        document.documentElement.scrollHeight !== mapBasis.current.documentHeight ||
        window.innerHeight !== mapBasis.current.viewport
      ) {
        readMap();
      }
      // A chip tap is the visitor's own navigation: it supersedes a deep
      // link still waiting to land.
      pendingFragment = null;
      window.scrollTo({ top: stationScrollTarget(scrollMap.current, index), left: window.scrollX, behavior: 'instant' });
      // Sample now rather than on the (frame-dispatched) scroll event, so the
      // chip highlight and the rig read the landing on this very frame.
      syncRef.current();
      return true;
    };

    // Frame-loop station snap (advanceSmooth) → DOM consumers.
    snapStationCount.set(state, ids.length);
    snapListeners.set(state, () => {
      setActiveIndex((current) => (current === state.index ? current : state.index));
      listeners.current.forEach((listener) => listener());
    });
    directionRestListeners.set(state, () => {
      directionLatch.current = createDirectionLatch(state.exact, performance.now() / 1000);
      listeners.current.forEach((listener) => listener());
    });
    // Intent flip applied in the frame loop: re-seat the latch on it (extreme
    // at the current position, dwell restarted) so the next scroll sample
    // steps from the flipped direction instead of reverting it.
    directionIntentListeners.set(state, (direction) => {
      const time = performance.now() / 1000;
      directionLatch.current = { direction, extreme: state.exact, since: time, lastMove: time };
      listeners.current.forEach((listener) => listener());
    });
    window.addEventListener('wheel', onIntentWheel, { passive: true, capture: true });
    window.addEventListener('keydown', onIntentKey, { passive: true, capture: true });

    // Visitor input mid-skip releases it — the rig's own release set (wheel,
    // touch, key). Chip activation input precedes the jump it starts, so only
    // input after the skip began counts. A release that moves nothing (a wheel
    // at the page end) is still a release: the visitor has taken over.
    const skipGestures = ['wheel', 'touchstart', 'keydown'] as const;
    const onSkipGesture = (event: Event) => {
      if (event.timeStamp > 0 && event.timeStamp < skipStartedAt) return;
      if (endSkipThrough(state, 'input')) listeners.current.forEach((listener) => listener());
    };
    for (const type of skipGestures) window.addEventListener(type, onSkipGesture, { passive: true, capture: true });

    remeasure();
    const gestureEvents =['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    if (pendingFragment !== null) {
      for (const type of gestureEvents) window.addEventListener(type, dropFragment, { passive: true });
    }

    const layoutObserver = new MutationObserver(onLayoutMutation);
    layoutObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', scheduleRemeasure);

    // Sections change height as fonts swap, sprites decode and client tables
    // hydrate. Watch the sections themselves rather than guessing a delay.
    const observer = new ResizeObserver(scheduleRemeasure);
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }

    document.fonts?.ready.then(scheduleRemeasure).catch(() => {});

    return () => {
      snapListeners.delete(state);
      directionRestListeners.delete(state);
      directionIntentListeners.delete(state);
      inputIntents.delete(state);
      window.removeEventListener('wheel', onIntentWheel, { capture: true });
      window.removeEventListener('keydown', onIntentKey, { capture: true });
      syncRef.current = () => {};
      goToRef.current = () => false;
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', scheduleRemeasure);
      observer.disconnect();
      layoutObserver.disconnect();
      for (const type of gestureEvents) window.removeEventListener(type, dropFragment);
      for (const type of skipGestures) window.removeEventListener(type, onSkipGesture, { capture: true });
    };
    // `measured` and `ids` are read but must not re-subscribe the listeners:
    // `measured` only seeds the one-time settle guard above, and `ids` is
    // memoized on `idKey`, which is already a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, holdKey, measureToken]);

  return conductor;
}
