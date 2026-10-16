import {
  projectAabbToRect,
  type AabbLike,
  type ProjectedRect,
  type ScreenRect,
} from '@/lib/route-world/evidence-probe';
import type { Locale } from '@/i18n/config';
import { routeT } from '@/lib/route-world/paint-copy';

/**
 * Wave 2 (2C) — the pure screen-space geometry behind the focus hover
 * brackets, the touch settle breathe and the holo beam. No DOM, no three:
 * the components project with the live camera (`projectAabbToRect`) and hand
 * the rects in, so every placement rule here is unit-testable.
 *
 * All rects are viewport CSS px, origin top-left, y down.
 */

export interface Viewport {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Bands chrome never enters (anti-pattern 3): the site header across the top
 * (the docked panel's `top: calc(56px + 1rem)` clears the same band) and the
 * route HUD's 56 px landmark along the bottom (WorldNav `.world-nav-hud`,
 * the box the capture harness stamps).
 */
export const HEADER_BAND_PX = 56;
export const HUD_BAND_PX = 56;

/** Clearance kept from the viewport edges and from those bands. */
export const EDGE_INSET_PX = 8;

/**
 * How far the corner brackets stand off the projected bounds. The bounds
 * already carry FocusSubject's 6 cm padding; 4 px keeps the strokes off the
 * face while staying well inside the 8 px "hugs the bounds" acceptance.
 */
export const BRACKET_OFFSET_PX = 4;

/** Gap between the brackets and the label pill. */
export const PILL_GAP_PX = 10;

export type PillSide = 'below' | 'above' | 'right' | 'left';

/** Preference order: under the subject reads as a caption, then above, then beside. */
const PILL_SIDES: readonly PillSide[] = ['below', 'above', 'right', 'left'];

export interface PillPlacement {
  side: PillSide;
  /** Top-left of the pill. */
  x: number;
  y: number;
  /** Overlap area (px²) with obstacles at this placement; 0 means clear. */
  overlap: number;
}

/** Column-major 4×4 product `a · b` (three's `Matrix4.elements` layout). */
export function multiplyMat4(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out = new Array<number>(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** The camera surface projection needs — structurally a three `Camera`. */
export interface ProjectingCamera {
  projectionMatrix: { elements: ArrayLike<number> };
  matrixWorldInverse: { elements: ArrayLike<number> };
}

/**
 * A world AABB's 8 corners through the camera, in VIEWPORT px: the canvas
 * box offsets the canvas-local rect (the route canvas is fixed full-viewport,
 * so the offset is normally 0 — kept so a letterboxed canvas stays honest).
 */
export function projectToViewport(
  bounds: AabbLike,
  camera: ProjectingCamera,
  canvasBox: { left: number; top: number; width: number; height: number },
): ProjectedRect {
  const viewProj = multiplyMat4(camera.projectionMatrix.elements, camera.matrixWorldInverse.elements);
  const projected = projectAabbToRect(bounds, viewProj, canvasBox.width, canvasBox.height);
  const shift = (rect: ScreenRect | null): ScreenRect | null =>
    rect ? { x: rect.x + canvasBox.left, y: rect.y + canvasBox.top, w: rect.w, h: rect.h } : null;
  return { ...projected, rect: shift(projected.rect), fullRect: shift(projected.fullRect) };
}

export function expandRect(rect: ScreenRect, by: number): ScreenRect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
}

export function overlapArea(a: ScreenRect, b: ScreenRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function clamp(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(max, Math.max(min, value));
}

/** The area chrome may use: the viewport minus both bands and the edge inset. */
export function safeArea(viewport: Viewport): ScreenRect {
  const top = HEADER_BAND_PX + EDGE_INSET_PX;
  const bottom = HUD_BAND_PX + EDGE_INSET_PX;
  return {
    x: EDGE_INSET_PX,
    y: top,
    w: Math.max(0, viewport.width - EDGE_INSET_PX * 2),
    h: Math.max(0, viewport.height - top - bottom),
  };
}

function pillAt(side: PillSide, target: ScreenRect, pill: { w: number; h: number }): Point {
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  switch (side) {
    case 'below':
      return { x: cx - pill.w / 2, y: target.y + target.h + PILL_GAP_PX };
    case 'above':
      return { x: cx - pill.w / 2, y: target.y - PILL_GAP_PX - pill.h };
    case 'right':
      return { x: target.x + target.w + PILL_GAP_PX, y: cy - pill.h / 2 };
    case 'left':
      return { x: target.x - PILL_GAP_PX - pill.w, y: cy - pill.h / 2 };
  }
}

/**
 * Where the label pill goes: the first side (below, above, right, left) that
 * fits the safe area and touches no obstacle — the other padded subject faces
 * on screen and an open docked panel. A pill that would cross the viewport
 * edge along its free axis slides along the bracket edge instead of flipping
 * sides. When every side is blocked, the side with the least overlap wins (a
 * pill that covers part of a neighbour beats no label at all) and `overlap`
 * reports it honestly, so the harness can see the compromise.
 */
export function placePill(
  target: ScreenRect,
  pill: { w: number; h: number },
  obstacles: readonly ScreenRect[],
  viewport: Viewport,
): PillPlacement {
  const safe = safeArea(viewport);
  let best: PillPlacement | null = null;
  for (const side of PILL_SIDES) {
    const raw = pillAt(side, target, pill);
    const vertical = side === 'below' || side === 'above';
    // Slide along the free axis only; the placement axis must fit as-is, or
    // the pill would land on the subject it labels.
    const x = vertical ? clamp(raw.x, safe.x, safe.x + safe.w - pill.w) : raw.x;
    const y = vertical ? raw.y : clamp(raw.y, safe.y, safe.y + safe.h - pill.h);
    const fits =
      x >= safe.x && y >= safe.y && x + pill.w <= safe.x + safe.w && y + pill.h <= safe.y + safe.h;
    if (!fits) continue;
    const box = { x, y, w: pill.w, h: pill.h };
    let overlap = overlapArea(box, target);
    for (const obstacle of obstacles) overlap += overlapArea(box, obstacle);
    const placement: PillPlacement = { side, x, y, overlap };
    if (overlap === 0) return placement;
    if (best === null || overlap < best.overlap) best = placement;
  }
  if (best) return best;
  // Nothing fits (a subject filling the whole frame): pin the pill inside the
  // safe area's bottom edge — still legible, and the overlap says so.
  const x = clamp(target.x + target.w / 2 - pill.w / 2, safe.x, safe.x + safe.w - pill.w);
  const y = safe.y + safe.h - pill.h;
  return { side: 'below', x, y, overlap: overlapArea({ x, y, w: pill.w, h: pill.h }, target) };
}

/** Which panel edge the beam lands on. */
export type DockEdge = 'left' | 'top';

/** Clearance from the panel's rounded corners where the beam may land. */
export const DOCK_CORNER_PX = 24;

/**
 * Beam end on the docked panel: its left edge for the desktop right rail,
 * its top edge for the ≤ 767 px bottom sheet. The end sits level with the
 * subject centre (rail) or under it (sheet), clamped clear of the corners,
 * so the stroke is as short and as straight as the layout allows.
 */
export function dockPoint(panel: ScreenRect, from: Point, edge: DockEdge): Point {
  if (edge === 'left') {
    return {
      x: panel.x,
      y: clamp(from.y, panel.y + DOCK_CORNER_PX, panel.y + panel.h - DOCK_CORNER_PX),
    };
  }
  return {
    x: clamp(from.x, panel.x + DOCK_CORNER_PX, panel.x + panel.w - DOCK_CORNER_PX),
    y: panel.y,
  };
}

/** How far inside the subject rect the drawn stroke begins. */
export const BEAM_START_INSET_PX = 4;

/**
 * Where the drawn beam starts. The beam AIMS from the subject's projected
 * centre (the 2C brief), but the stroke is only drawn from the point where
 * that centre→dock line leaves the subject rect, a few px inside it — a
 * stroke across the board or the ace would be DOM chrome over a projected
 * face (anti-pattern 3). So the start is always inside the subject rect and
 * nothing covers the data. A dock end inside the subject rect (the panel
 * overlapping a subject that fills the frame) returns the centre itself.
 */
export function beamStart(subject: ScreenRect, end: Point): Point {
  const centre = { x: subject.x + subject.w / 2, y: subject.y + subject.h / 2 };
  const inner = expandRect(subject, -Math.min(BEAM_START_INSET_PX, subject.w / 2, subject.h / 2));
  const dx = end.x - centre.x;
  const dy = end.y - centre.y;
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (inner.x + inner.w - centre.x) / dx);
  if (dx < 0) t = Math.min(t, (inner.x - centre.x) / dx);
  if (dy > 0) t = Math.min(t, (inner.y + inner.h - centre.y) / dy);
  if (dy < 0) t = Math.min(t, (inner.y - centre.y) / dy);
  if (!Number.isFinite(t) || t >= 1 || t < 0) return centre;
  return { x: centre.x + dx * t, y: centre.y + dy * t };
}

// ── Touch settle breathe ────────────────────────────────────────────────────

/** How long the brackets breathe on a station's first settle (the brief). */
export const BREATHE_MS = 1600;

/**
 * The settle predicate the breathe waits on. It mirrors the plan's latched
 * `useStationSettle()` (2A): `|smooth − exact| < 0.02` and the hysteretic
 * nearest station held for 150 ms. Kept local because that hook had not
 * landed when this seat was built — swap to it once it exists (followup).
 */
export const SETTLE_EPSILON = 0.02;
export const SETTLE_HOLD_MS = 150;

export interface SettleTrack {
  nearest: number;
  /** When the current still run on `nearest` began; null while moving. */
  since: number | null;
}

/**
 * One settle sample: returns the updated track and whether the station at
 * `nearest` counts as settled at `now`. The hold restarts whenever the
 * camera moves (`|smooth − exact|` ≥ epsilon) or the nearest station changes.
 */
export function stepSettle(
  track: SettleTrack | null,
  sample: { exact: number; smooth: number; nearest: number },
  now: number,
): { track: SettleTrack; settled: boolean } {
  const still = Math.abs(sample.smooth - sample.exact) < SETTLE_EPSILON;
  if (!still) return { track: { nearest: sample.nearest, since: null }, settled: false };
  const since = track && track.nearest === sample.nearest && track.since !== null ? track.since : now;
  return { track: { nearest: sample.nearest, since }, settled: now - since >= SETTLE_HOLD_MS };
}

/** sessionStorage key of the "already breathed" flag, one per world station. */
export function breatheKey(themeId: string, station: number): string {
  return `route-focus-breathe:${themeId}:${station}`;
}

/** Minimal storage surface (sessionStorage in the browser, a Map in tests). */
export interface FlagStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Claims the once-per-station-per-session breathe. True exactly once per key
 * while storage works. Storage that throws (private mode, blocked site data)
 * or is missing yields false: without a flag the breathe could replay on
 * every settle, which is worse than not breathing (anti-pattern 15).
 */
export function claimBreathe(storage: FlagStorage | null, key: string): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(key) !== null) return false;
    storage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * The breathe's primary subject for a settled station: the registered subject
 * with the largest projected on-screen area among those at least
 * `MIN_PRIMARY_ON_SCREEN` in frame. Subjects carry no station tag, so "the
 * station's primary subject" is read off the frozen pose instead: the board
 * or ace the station frames biggest. Honest limit: at a station whose
 * largest subject is a neighbour's board cropped into frame, the 85 % floor
 * is what keeps it out; a station framing nothing that clears it breathes
 * nothing.
 */
export const MIN_PRIMARY_ON_SCREEN = 0.85;

export interface ProjectedSubject {
  id: string;
  rect: ScreenRect | null;
  onScreenFraction: number;
}

export function pickPrimarySubject(rows: readonly ProjectedSubject[]): string | null {
  let bestId: string | null = null;
  let bestArea = 0;
  for (const row of rows) {
    if (!row.rect || row.onScreenFraction < MIN_PRIMARY_ON_SCREEN) continue;
    const area = row.rect.w * row.rect.h;
    if (area > bestArea) {
      bestArea = area;
      bestId = row.id;
    }
  }
  return bestId;
}

/** Hover-pill hint, in the viewer's language (anti-pattern 16; `world-route.hoverHint`). */
export function hoverHint(locale: Locale): string {
  return routeT(locale)('hoverHint');
}
