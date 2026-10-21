/**
 * Scroll map — document scroll offset → route progress in station units
 * (bar W6, decision D6: the hold pin is replaced by a plateau).
 *
 * Each station becomes current when its `<section>` top reaches ACTIVATION of
 * the viewport (its anchor). Between anchors, progress is piecewise-linear in
 * scrollY. Hold stations (`RouteThemeDefinition.holdIds` — pulse and schedule
 * in every theme) additionally own a PLATEAU: a band of scroll offsets over
 * which progress stays exactly at the station's integer. The band runs from
 * the anchor to the offset where the section sits start-aligned against its
 * `scroll-margin-top` (plus START_ALIGN_EPS_PX of subpixel / sticky-nav
 * slack), so `scrollIntoView({ block: 'start' })` and a nav chip both land
 * exactly on the integer (PB-013) — which the old hold pin achieved by
 * overwriting progress, a discontinuity that snapped the camera backward when
 * scrolling down through the band and teleported it on two of five nav chips.
 *
 * The map is continuous and monotone non-decreasing in scrollY, so scrolling
 * one way can only ever move progress one way. Plateau edges are C1: the
 * segment leaving (or entering) a plateau eases its slope from 0 over
 * EASE_FRACTION of the segment, so the damped camera channel sees no velocity
 * kink when it leaves a hold.
 *
 * Pure data — geometry comes in as numbers, so it is unit-testable.
 */

import { NEAREST_STATION_BAND } from './direction-latch';

/** Fraction of the viewport height at which a section becomes its station. */
export const ACTIVATION = 0.35;

/** Subpixel / sticky-nav slack for `top` vs computed `scroll-margin-top`. */
export const START_ALIGN_EPS_PX = 12;

/** Share of a segment over which the slope eases in/out at a plateau edge. */
export const PLATEAU_EASE_FRACTION = 0.2;

/**
 * Longest share of a neighbouring segment a plateau may claim, so a tall
 * sticky header on a short section can never collapse the crossing itself.
 */
const MAX_PLATEAU_SHARE = 0.6;

export interface StationGeometry {
  /** Section top in document space (px), or null when the section is missing. */
  top: number | null;
  /** Computed `scroll-margin-top` of the section (px). */
  scrollMarginTop: number;
  /** Whether this station is a hold station (owns a plateau). */
  hold: boolean;
}

export interface ScrollMapInput {
  stations: readonly StationGeometry[];
  /** `window.innerHeight`. */
  viewport: number;
  /** `document.documentElement.scrollHeight`. */
  documentHeight: number;
}

export interface ScrollMap {
  /** Scroll offset at which each station becomes current (legacy anchors). */
  anchors: readonly number[];
  /** Start of the band where progress == station index (== anchor unless held). */
  lo: readonly number[];
  /** End of that band (== anchor unless held). */
  hi: readonly number[];
  /**
   * Where an integer progress RESTS (`scrollFromProgress`): the anchor for a
   * plain station; for a hold station its start-aligned offset (where a nav
   * chip or `scrollIntoView({ block: 'start' })` lands), clamped into its
   * plateau `[lo, hi]`.
   */
  rest: readonly number[];
  /** Hold flags, index-aligned with the stations. */
  holds: readonly boolean[];
}

export const EMPTY_SCROLL_MAP: ScrollMap = { anchors: [], lo: [], hi: [], holds: [], rest: [] };

/**
 * Anchors (forced strictly increasing, rescaled if the tail would sit past the
 * end of the document — so every station stays reachable on a short page),
 * plus a plateau band for every hold station.
 */
export function measureScrollMap(input: ScrollMapInput): ScrollMap {
  const { stations, viewport } = input;
  const maxScroll = Math.max(1, input.documentHeight - viewport);
  const anchors: number[] = [];

  for (const station of stations) {
    if (station.top === null) {
      anchors.push(anchors.length === 0 ? 0 : anchors[anchors.length - 1] + 1);
      continue;
    }
    anchors.push(Math.min(Math.max(station.top - viewport * ACTIVATION, 0), maxScroll));
  }

  if (anchors.length === 0) return EMPTY_SCROLL_MAP;

  anchors[0] = 0;
  for (let i = 1; i < anchors.length; i += 1) {
    if (anchors[i] <= anchors[i - 1]) anchors[i] = anchors[i - 1] + 1;
  }

  const tail = anchors[anchors.length - 1];
  if (tail > maxScroll) {
    const scale = maxScroll / tail;
    for (let i = 0; i < anchors.length; i += 1) anchors[i] *= scale;
  }

  const lo = anchors.slice();
  const hi = anchors.slice();
  const holds = stations.map((station) => station.hold);
  const rest = anchors.slice();
  const last = anchors.length - 1;

  for (let i = 0; i <= last; i += 1) {
    const station = stations[i];
    if (!station.hold || station.top === null) {
      holds[i] = false;
      continue;
    }
    const align = Math.min(Math.max(station.top - station.scrollMarginTop, 0), maxScroll);
    const anchor = anchors[i];
    // The band never reaches back past the previous plateau, nor claims more
    // than MAX_PLATEAU_SHARE of either neighbouring segment.
    const floor = i === 0 ? anchor : anchor - (anchor - hi[i - 1]) * MAX_PLATEAU_SHARE;
    const ceil = i === last ? Math.max(anchor, maxScroll) : anchor + (anchors[i + 1] - anchor) * MAX_PLATEAU_SHARE;
    lo[i] = Math.max(floor, Math.min(anchor, align - START_ALIGN_EPS_PX));
    hi[i] = Math.min(ceil, Math.max(anchor, align + START_ALIGN_EPS_PX));
    rest[i] = Math.min(hi[i], Math.max(lo[i], align));
  }

  return { anchors, lo, hi, holds, rest };
}

/**
 * Normalized progress through one segment with optional C1 ease-in (leaving a
 * plateau) and ease-out (entering one): slope 0 at an eased end, a constant
 * slope through the middle, joined with quadratic ramps. Monotone, f(0) = 0,
 * f(1) = 1.
 */
export function plateauEase(u: number, easeIn: boolean, easeOut: boolean, k: number = PLATEAU_EASE_FRACTION): number {
  const t = Math.min(1, Math.max(0, u));
  if (!easeIn && !easeOut) return t;
  if (easeIn && easeOut) {
    const m = 1 / (1 - k);
    if (t < k) return (m * t * t) / (2 * k);
    if (t > 1 - k) return 1 - (m * (1 - t) * (1 - t)) / (2 * k);
    return m * (t - k / 2);
  }
  const m = 1 / (1 - k / 2);
  const rampIn = (x: number) => (x < k ? (m * x * x) / (2 * k) : m * (x - k / 2));
  return easeIn ? rampIn(t) : 1 - rampIn(1 - t);
}

/** Continuous, monotone scroll offset → station units. */
export function progressFromScroll(map: ScrollMap, scrollY: number): number {
  const { lo, hi, holds } = map;
  const count = lo.length;
  if (count < 2) return 0;
  if (scrollY <= hi[0]) return 0;
  if (scrollY >= lo[count - 1]) return count - 1;

  let i = 0;
  while (i < count - 1 && scrollY >= lo[i + 1]) i += 1;
  if (scrollY <= hi[i]) return i;
  const span = lo[i + 1] - hi[i];
  if (span <= 0) return i + 1;
  return i + plateauEase((scrollY - hi[i]) / span, holds[i], holds[i + 1]);
}

/**
 * The hold station whose plateau contains `scrollY`, or null. This is the
 * conductor's `pin` readout (capture harness, nav): no longer an override —
 * progress is already exactly the integer on a plateau.
 */
export function plateauAt(map: ScrollMap, scrollY: number): number | null {
  for (let i = 0; i < map.lo.length; i += 1) {
    if (map.holds[i] && scrollY >= map.lo[i] && scrollY <= map.hi[i]) return i;
  }
  return null;
}

/** Bisection steps for inverting `plateauEase` (2^-60 of a segment: exact). */
const INVERT_ITERATIONS = 60;

/**
 * Inverse of `progressFromScroll`: the scroll offset at which `map` reads
 * `progress` (clamped to the route). Used to carry the visitor's place
 * across a layout flip (Lite ⇄ route-live), where every section changes
 * height and the browser clamps `scrollY` onto a different station.
 *
 * - An integer lands on that station's `rest` offset: the anchor for a plain
 *   station; for a hold station the start-aligned offset — exactly where its
 *   nav chip lands, so a restored Puls / Spielplan frames like a chip click
 *   — clamped into the plateau, which extends ≥ START_ALIGN_EPS_PX past it
 *   so a small later remeasure shift stays on the integer.
 * - A fraction inverts the eased segment by bisection (`plateauEase` is
 *   monotone and strictly increasing inside the segment).
 *
 * Round trip: `progressFromScroll(map, scrollFromProgress(map, p)) === p`
 * to floating-point precision for every p in [0, count − 1]. The one
 * exception is a degenerate zero-length segment (span ≤ 0), which has no
 * fractional offsets at all; it returns the segment start.
 */
export function scrollFromProgress(map: ScrollMap, progress: number): number {
  const { lo, hi, holds } = map;
  const count = lo.length;
  if (count === 0) return 0;
  if (count < 2 || !Number.isFinite(progress)) return lo[0];
  const p = Math.min(count - 1, Math.max(0, progress));
  const i = Math.min(count - 1, Math.floor(p));
  const frac = p - i;
  if (frac === 0) return map.rest[i];

  const span = lo[i + 1] - hi[i];
  if (span <= 0) return hi[i];
  let low = 0;
  let high = 1;
  for (let step = 0; step < INVERT_ITERATIONS; step += 1) {
    const mid = (low + high) / 2;
    if (plateauEase(mid, holds[i], holds[i + 1]) < frac) low = mid;
    else high = mid;
  }
  return hi[i] + ((low + high) / 2) * span;
}

/**
 * Scroll offset a station's nav chip lands on (W6 round 3). The chip used to
 * be a plain fragment link, so the browser scrolled to `top −
 * scroll-margin-top` — the start-aligned offset. That is the station only for
 * a hold station (its plateau contains it); for a plain station (roster,
 * teams, rules) the anchor is `top − ACTIVATION × viewport`, and a fragment
 * jump landed 0.2 station past it (rules → roster at 390 read exact 1.222,
 * scrollY 863 vs 676) and failed to settle. The chip now lands on the
 * integer's `rest` offset, ceiled so a subpixel round-down can never read the
 * previous station (`floor(progress)` is the station).
 */
export function stationScrollTarget(map: ScrollMap, index: number): number {
  return Math.ceil(scrollFromProgress(map, index));
}

/**
 * Which layout the sections are in. `semantic` is the readable page (Lite,
 * and the route tier while the scene loads): tall sections, and the station
 * a visitor is "in" is `floor(exact)` — the one the Lite nav highlights.
 * `route` is `html.world-route-live`: one viewport per section, and the
 * station is the hysteretic NEAREST one (`stepStationLatch`), which is what
 * the HUD chip and the camera frame.
 */
export type SectionLayout = 'semantic' | 'route';

/** Keep a semantic-layout handoff this far short of the next station. */
export const HANDOFF_SEMANTIC_EDGE = 0.05;

/**
 * The progress to restore after a layout flip: the visitor's exact
 * progress, clamped into the domain where the NEW layout still reads the
 * station the visitor perceived in the OLD one.
 *
 * Carrying `exact` unchanged is right almost everywhere, but the two
 * layouts disagree on which station a fraction belongs to. A visitor
 * reading the lower half of a 6 000 px Teams table in the semantic page sits
 * at e.g. 3.8 (floor → Teams); in the route layout 3.8 rounds to Rules, so
 * the world would reveal one station late — the exact veto this fixes.
 * Symmetrically, route 3.7 (nearest → Rules) would drop the semantic reader
 * into the bottom of the Teams table. Clamping keeps `exact` wherever it is
 * already consistent and only moves it when it would change the station.
 *
 * `station` is the perceived station in the old layout (`floor(exact)` for
 * `semantic`, `nearest` for `route`); `to` is the new layout.
 */
export function handoffProgress(
  exact: number,
  station: number,
  count: number,
  to: SectionLayout,
  band: number = NEAREST_STATION_BAND,
): number {
  if (count <= 1) return 0;
  const last = count - 1;
  const s = Math.min(last, Math.max(0, Math.round(station)));
  const value = Number.isFinite(exact) ? exact : s;
  const [min, max] =
    to === 'route'
      ? [s - 0.5 + band, s + 0.5 - band]
      : [s, s === last ? last : s + 1 - HANDOFF_SEMANTIC_EDGE];
  return Math.min(last, Math.max(0, Math.min(max, Math.max(min, value))));
}
