'use client';

import { useEffect, useRef } from 'react';
import { REDUCED_MOTION_QUERY } from '@/lib/route-world/quality';
import type { ScreenRect } from '@/lib/route-world/evidence-probe';
import { useWorldHandoff, useWorldState } from '@/components/world/route/WorldStateProvider';
import { focusStore, useFocusState } from './focus-store';
import { beamStart, dockPoint, projectToViewport, type Point } from './hover-geometry';
import { openPanelRect, useMediaQuery } from './FocusHoverOverlay';
import styles from './HoloBeam.module.css';

/**
 * Wave 2 (2C) — the holo beam: one SVG stroke from the focused subject to the
 * docked panel's docking edge (the left edge of the ≥ 768 px right rail, the
 * top edge of the ≤ 767 px bottom sheet — the same `mobile` flag the panel
 * CSS and `panelFrameOffset` dock by). Mounted once per world beside
 * FocusHoverOverlay (2B owns the mount line).
 *
 * Timeline:
 *  - Nothing while the camera blends in: the beam draws only once the focus
 *    store reaches `focused` (the rig's `settle()` — blend landed, cross-blend
 *    finished) AND the panel is open and not closing. It draws subject → dock
 *    in 420 ms, and its dock end flares once into the panel border (the §1
 *    "dissolves into the panel's border"), then stays as a faint tether that
 *    follows the subject while the visitor orbits or dollies.
 *  - It retracts back into the subject (220 ms) the moment the focus leaves
 *    `focused` (close → `releasing`, or a cross-tap → `focusing` on a new
 *    subject — which then draws a fresh beam once that blend lands) or the
 *    panel starts its exit (`data-closing`).
 *  - Absent under reduced motion (renders nothing), off the route tier, and
 *    before the scene took the page.
 *
 * The stroke is AIMED from the subject's projected centre but drawn only from
 * where that line leaves the subject rect (`beamStart`), so it never lies
 * across the board or the ace it names (anti-pattern 3). The end lands on the
 * panel edge, level with the subject centre, clamped off the rounded corners.
 *
 * Honest limits: geometry follows the LAST rendered camera (see
 * FocusHoverOverlay — up to one frame of trail during an orbit drag); the
 * panel rect is read with `getBoundingClientRect` per frame while the beam is
 * up, which is one layout read of an already-laid-out fixed element. The
 * loop runs only while the beam is drawn or retracting. 0 draw calls.
 */

/**
 * Retract duration — the CSS transition in HoloBeam.module.css runs the same
 * 220 ms; the loop keeps re-projecting the shrinking stroke until it ends.
 * (The 420 ms draw is CSS-only: the loop follows the subject regardless.)
 */
const RETRACT_MS = 220;

type Stage = 'off' | 'armed' | 'draw' | 'retract';

export default function HoloBeam() {
  const { tier, mobile } = useWorldState();
  const { routeSceneLive } = useWorldHandoff();
  const focus = useFocusState();
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const enabled = tier === 'route' && routeSceneLive && !reducedMotion;

  const rootRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const stageRef = useRef<Stage>('off');
  /** Last geometry drawn — a retract keeps shrinking along it if the panel is gone. */
  const lastRef = useRef<{ from: Point; to: Point } | null>(null);

  const subjectId = focus.subject?.id ?? null;
  const wants = enabled && focus.phase === 'focused' && focus.subject?.panel !== undefined;

  useEffect(() => {
    const root = rootRef.current;
    const path = pathRef.current;
    const dot = dotRef.current;
    if (!root || !path || !dot) return;
    let frame = 0;
    let retractUntil = 0;

    const setStage = (stage: Stage) => {
      stageRef.current = stage;
      root.dataset.stage = stage;
    };

    const geometry = (): { from: Point; to: Point } | null => {
      const view = focusStore.view();
      const subject = subjectId ? focusStore.find(subjectId) : null;
      const panel: ScreenRect | null = openPanelRect();
      if (!view || !subject || !panel) return null;
      const projected = projectToViewport(subject.bounds, view.camera, view.canvas.getBoundingClientRect());
      if (!projected.rect) return null;
      const rect = projected.rect;
      const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      const to = dockPoint(panel, centre, mobile ? 'top' : 'left');
      return { from: beamStart(rect, to), to };
    };

    const paint = (g: { from: Point; to: Point }) => {
      lastRef.current = g;
      path.setAttribute('d', `M ${g.from.x.toFixed(1)} ${g.from.y.toFixed(1)} L ${g.to.x.toFixed(1)} ${g.to.y.toFixed(1)}`);
      dot.setAttribute('cx', g.to.x.toFixed(1));
      dot.setAttribute('cy', g.to.y.toFixed(1));
    };

    const tick = () => {
      frame = 0;
      const stage = stageRef.current;
      if (wants) {
        const g = geometry();
        if (!g) {
          // Focused, but the panel has not opened yet (the param commit lags
          // the settle) or is closing: hold off / retract, keep watching.
          if (stage === 'draw' || stage === 'armed') {
            setStage('retract');
            retractUntil = performance.now() + RETRACT_MS;
          }
          frame = requestAnimationFrame(tick);
          return;
        }
        paint(g);
        // Arm first (offset 1, no transition) so the draw transition has a
        // committed start value, then draw on the next frame.
        if (stage === 'off' || stage === 'retract') setStage('armed');
        else if (stage === 'armed') setStage('draw');
        frame = requestAnimationFrame(tick);
        return;
      }
      if (stage === 'off') return;
      if (stage !== 'retract') {
        setStage('retract');
        retractUntil = performance.now() + RETRACT_MS;
      }
      const g = geometry() ?? lastRef.current;
      if (g) paint(g);
      if (performance.now() >= retractUntil) {
        setStage('off');
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [wants, subjectId, mobile]);

  // A disabled beam (reduced motion, Lite) leaves nothing drawn behind.
  useEffect(() => {
    if (enabled) return;
    stageRef.current = 'off';
    lastRef.current = null;
  }, [enabled]);

  if (!enabled) return null;

  return (
    <svg
      ref={rootRef}
      aria-hidden="true"
      focusable="false"
      className={styles.root}
      data-holo-beam=""
      data-stage="off"
    >
      <path ref={pathRef} className={styles.beam} pathLength={1} d="M 0 0" />
      <circle ref={dotRef} className={styles.dock} r={3} cx={0} cy={0} />
    </svg>
  );
}
