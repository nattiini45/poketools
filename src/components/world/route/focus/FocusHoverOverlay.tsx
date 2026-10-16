'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocale } from '@/i18n/client';
import { REDUCED_MOTION_QUERY } from '@/lib/route-world/quality';
import type { ScreenRect } from '@/lib/route-world/evidence-probe';
import { getBallPhase } from '@/components/world/route/scene-progress';
import { useWorldHandoff, useWorldState } from '@/components/world/route/WorldStateProvider';
import { focusStore, useFocusState, useHoveredId, type FocusView } from './focus-store';
import {
  BRACKET_OFFSET_PX,
  BREATHE_MS,
  EDGE_INSET_PX,
  SETTLE_EPSILON,
  breatheKey,
  claimBreathe,
  expandRect,
  hoverHint,
  pickPrimarySubject,
  placePill,
  projectToViewport,
  stepSettle,
  type FlagStorage,
  type SettleTrack,
} from './hover-geometry';
import styles from './FocusHoverOverlay.module.css';

/**
 * Wave 2 (2C) — focus discoverability, page side. Mounted once per world
 * inside `WorldStateProvider` (2B owns the mount line in WorldShell); renders
 * nothing off the route tier or before the scene took the page.
 *
 * Desktop (mouse / pen): while a FocusSubject's raycast proxy is hovered,
 * four corner brackets hug its projected bounds and a label pill names it —
 * the subject label plus "Click to look closer" / "Klicken zum Vergrößern",
 * in the viewer's language (`useLocale()`). The 8 AABB corners are
 * projected with the live camera every frame, but ONLY while hovered: the
 * rAF loop exists for the hover's lifetime and not a frame longer. The pill
 * takes the first side (below, above, right, left) clear of the other padded
 * subject faces on screen and of an open docked panel (`placePill`).
 *
 * Touch: the first time a station settles in a session, its primary subject's
 * brackets breathe once for 1.6 s (`BREATHE_MS`) — the tap target announced
 * without a word of chrome. The once-per-station flag lives in
 * sessionStorage behind try/catch; storage that throws means no breathe (a
 * replay on every settle would be worse). No breathe under reduced motion.
 *
 * Nothing here is interactive (`pointer-events: none`, `aria-hidden`): the
 * semantic page stays the full task surface, the overlay only points at what
 * the canvas already offers. 0 draw calls — plain DOM.
 *
 * Honest limits:
 *  - The camera matrices read here are the ones the LAST rendered frame
 *    used (the renderer refreshes them in `render`; this loop does not touch
 *    the camera). Page rAF callbacks and R3F's own loop share a frame, but
 *    their order is not guaranteed, so during a camera move the brackets can
 *    trail the picture by one frame. On a settled station they are exact.
 *  - Brackets hide while the conductor is mid-crossing (`|smooth − exact|` ≥
 *    0.02 with no focus live): chrome that shows mid-crossing is anti-pattern
 *    3, and a hover the scroll carried away is stale anyway.
 *  - Pill obstacles are the registered focus subjects' projected bounds —
 *    the faces a pill could hide. The plan's DataFace table (2A) is broader
 *    (plates, tablets, signs); once it lands it should join the obstacles.
 *  - The settle predicate is a local mirror of 2A's `useStationSettle()`
 *    (see `stepSettle`), since that hook had not landed with this seat.
 */

/** A hovered subject less than this much on screen gets no brackets. */
const MIN_HOVER_ON_SCREEN = 0.5;
/** Pill obstacles are padded like the data-face wedges' screen share. */
const OBSTACLE_PAD_PX = 8;
/** The breathe watcher gives up after this long without a settle (the ball's 10 s deadline plus slack). */
const SETTLE_WATCH_MS = 12_000;
const TOUCH_QUERY = '(hover: none) and (pointer: coarse)';

/** A media query as React state; false on the server and first paint. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia?.(query);
      if (!mql) return () => undefined;
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}

function sessionFlags(): FlagStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The open (not closing) docked Focus panel's rect, or null. */
export function openPanelRect(): ScreenRect | null {
  const panel = document.querySelector<HTMLElement>('.world-focus-panel[open]:not([data-closing])');
  if (!panel) return null;
  const box = panel.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  return { x: box.left, y: box.top, w: box.width, h: box.height };
}

/**
 * Wave 2 integration: the entering (not exiting) Station Card's rect, or null.
 * The pill must never land on the card (both are chrome; chrome over chrome
 * is as unreadable as chrome over data). Read from the DOM the card already
 * exposes for the harness.
 */
export function stationCardRect(): ScreenRect | null {
  const card = document.querySelector<HTMLElement>('[data-station-caption][data-card-state="enter"]');
  if (!card) return null;
  const box = card.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  return { x: box.left, y: box.top, w: box.width, h: box.height };
}

function canvasBoxOf(view: FocusView) {
  return view.canvas.getBoundingClientRect();
}

type Mode = 'hover' | 'breathe';

export default function FocusHoverOverlay() {
  const { tier, theme, conductor } = useWorldState();
  const { routeSceneLive } = useWorldHandoff();
  const hoveredId = useHoveredId();
  const focus = useFocusState();
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const touch = useMediaQuery(TOUCH_QUERY);
  const [breatheId, setBreatheId] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const bracketsRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);

  const live = tier === 'route' && routeSceneLive && theme !== null;
  const focusLive = focus.phase !== 'idle';
  // The focused subject needs no "look closer" — it is already being looked at.
  const hoverTarget =
    live && hoveredId !== null && !(focusLive && focus.subject?.id === hoveredId) ? hoveredId : null;
  const targetId = hoverTarget ?? (live && !focusLive ? breatheId : null);
  const mode: Mode | null = hoverTarget ? 'hover' : targetId ? 'breathe' : null;
  const hoveredSubject = hoverTarget ? focusStore.find(hoverTarget) : null;
  // i18n D11: the hint follows the viewer, never the theme.
  const locale = useLocale();

  // ── Projection loop: alive only while something is bracketed ─────────────
  useEffect(() => {
    const root = rootRef.current;
    const brackets = bracketsRef.current;
    const pill = pillRef.current;
    if (!targetId || !mode || !root || !brackets) return;
    let frame = 0;
    const hide = () => {
      root.dataset.visible = 'false';
    };
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const view = focusStore.view();
      const subject = focusStore.find(targetId);
      const progress = conductor.progress.current;
      const crossing =
        focusStore.get().phase === 'idle' &&
        progress !== null &&
        Math.abs(progress.smooth - progress.exact) >= SETTLE_EPSILON;
      if (!view || !subject || crossing || document.hidden) {
        hide();
        return;
      }
      const canvasBox = canvasBoxOf(view);
      const projected = projectToViewport(subject.bounds, view.camera, canvasBox);
      if (!projected.rect || projected.onScreenFraction < MIN_HOVER_ON_SCREEN) {
        hide();
        return;
      }
      const target = expandRect(projected.rect, BRACKET_OFFSET_PX);
      brackets.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`;
      brackets.style.width = `${target.w}px`;
      brackets.style.height = `${target.h}px`;
      if (mode === 'hover' && pill) {
        const obstacles: ScreenRect[] = [];
        for (const other of focusStore.subjects()) {
          if (other.id === subject.id) continue;
          const rect = projectToViewport(other.bounds, view.camera, canvasBox).rect;
          if (rect) obstacles.push(expandRect(rect, OBSTACLE_PAD_PX));
        }
        const panel = openPanelRect();
        if (panel) obstacles.push(expandRect(panel, EDGE_INSET_PX));
        const card = stationCardRect();
        if (card) obstacles.push(expandRect(card, EDGE_INSET_PX));
        const placement = placePill(
          target,
          { w: pill.offsetWidth, h: pill.offsetHeight },
          obstacles,
          { width: window.innerWidth, height: window.innerHeight },
        );
        pill.style.transform = `translate3d(${placement.x}px, ${placement.y}px, 0)`;
        pill.dataset.side = placement.side;
        pill.dataset.overlap = String(Math.round(placement.overlap));
      }
      root.dataset.visible = 'true';
    };
    hide();
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      hide();
    };
  }, [targetId, mode, conductor]);

  // ── Touch: breathe the primary subject once per station per session ──────
  const themeId = theme?.id ?? null;
  const breatheEnabled = live && touch && !reducedMotion && !focusLive && themeId !== null;
  useEffect(() => {
    if (!breatheEnabled || themeId === null) return;
    let frame = 0;
    let watchUntil = 0;
    let track: SettleTrack | null = null;
    /** The station whose settle this visit already handled (breathed or not). */
    let handled: number | null = null;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;

    const evaluate = (station: number) => {
      handled = station;
      const view = focusStore.view();
      if (!view) return;
      const canvasBox = canvasBoxOf(view);
      const primary = pickPrimarySubject(
        focusStore.subjects().map((subject) => {
          const projected = projectToViewport(subject.bounds, view.camera, canvasBox);
          return { id: subject.id, rect: projected.rect, onScreenFraction: projected.onScreenFraction };
        }),
      );
      if (!primary || !claimBreathe(sessionFlags(), breatheKey(themeId, station))) return;
      setBreatheId(primary);
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => setBreatheId(null), BREATHE_MS);
    };

    const tick = () => {
      frame = 0;
      const progress = conductor.progress.current;
      const now = performance.now();
      if (!progress || now > watchUntil) return;
      const step = stepSettle(track, progress, now);
      track = step.track;
      if (handled !== null && handled !== progress.nearest) handled = null;
      const ballDone = getBallPhase() === 'done' || getBallPhase() === 'hidden';
      if (step.settled && ballDone && !document.hidden) {
        if (handled !== progress.nearest) evaluate(progress.nearest);
        return; // settled: sleep until the conductor reports movement again
      }
      frame = requestAnimationFrame(tick);
    };

    const wake = () => {
      watchUntil = performance.now() + SETTLE_WATCH_MS;
      if (frame === 0) frame = requestAnimationFrame(tick);
    };

    wake();
    const unsubscribe = conductor.subscribe(wake);
    return () => {
      unsubscribe();
      if (frame !== 0) cancelAnimationFrame(frame);
      if (clearTimer) clearTimeout(clearTimer);
      setBreatheId(null);
    };
  }, [breatheEnabled, themeId, conductor]);

  if (!live) return null;

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className={styles.root}
      data-focus-hover=""
      data-mode={mode ?? 'none'}
      data-target={targetId ?? ''}
      data-visible="false"
    >
      <div ref={bracketsRef} className={styles.brackets}>
        <div className={styles.frame}>
          <span className={`${styles.corner} ${styles.tl}`} />
          <span className={`${styles.corner} ${styles.tr}`} />
          <span className={`${styles.corner} ${styles.bl}`} />
          <span className={`${styles.corner} ${styles.br}`} />
        </div>
      </div>
      {mode === 'hover' && hoveredSubject && (
        <div ref={pillRef} className={styles.pill}>
          <span className={styles.label}>{hoveredSubject.label}</span>
          <span className={styles.hint}>{hoverHint(locale)}</span>
        </div>
      )}
    </div>
  );
}
