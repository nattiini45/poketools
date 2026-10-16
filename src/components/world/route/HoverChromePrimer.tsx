'use client';

import { useEffect, useState } from 'react';
import styles from './focus/FocusHoverOverlay.module.css';
import { BEAM_PRERASTER } from '@/lib/route-world/ball-loader-state';
import { getBallPhase, getBallPhaseSince } from './scene-progress';
import { getScenePhase } from './world-readiness';

/**
 * ENGINE-A3 (D23 "nothing compiles after the reveal"): the focus hover
 * chrome, rastered once under the Pokéball.
 *
 * The first hover of a focus subject after the reveal showed the
 * FocusHoverOverlay's corner brackets (`filter: drop-shadow`) and label pill
 * (`backdrop-filter`, `box-shadow`) for the first time in the session, and
 * Chrome's GPU raster compiled their Skia programs right then: a 56-67 ms
 * GPU-process task (`Program::MainLinkLoadEvent::wait` under
 * `DoEndRasterCHROMIUM`), an 87 ms frame at 390 / dpr 2, in every world, on
 * the visitor's first pointer move over a board. The second hover drew in a
 * normal frame.
 *
 * So, as the ceremony's HUD primer does for the HUD glass (R6 E8), the same
 * classes are drawn for a moment at 0.2 % opacity while the ball is up and
 * the scene is presented (assets still loading, before the shader compile),
 * then removed. Nothing is visible, nothing is interactive, the Lite tier
 * never mounts it (route canvas only), and it runs once per page (a palette
 * swap reuses the programs).
 */

/** How long the primer stays up once the ceremony shows the ball (two stages of half each). */
export const HOVER_PRIMER_MS = 400;
/**
 * ENGINE-A4: the primer rasters in two stages (brackets, then pill) and must
 * be done before the loader's staggered beam pre-raster starts
 * (`BEAM_PRERASTER.startDelayMs` after the ball began loading): both link
 * Skia programs on the GPU main thread, and stacked they made one
 * 100-180 ms gap in the ball's own animation.
 */
export const HOVER_PRIMER_BEFORE_BEAM_MS = 100;
/** Poll interval while waiting for the presented ceremony. */
const HOVER_PRIMER_POLL_MS = 50;
/** Give up if the ceremony never reaches `presented` in this long (Lite, a failure). */
const HOVER_PRIMER_WATCH_MS = 30_000;

let primedThisPage = false;

/** Tests only. */
export function resetHoverChromePrimerForTests(): void {
  primedThisPage = false;
}

/**
 * Whether the primer should raster now (pure): the ball is loading and the
 * scene presented. ENGINE-A4: `loadingForMs` (since the ball began loading)
 * shortens the primer so it ends before the beam pre-raster begins; a scene
 * that presents later than that primes anyway, once (the beam steps are
 * 110 ms apart, so the primer lands between two of them).
 */
export function hoverPrimerDue(ballPhase: string, scenePhase: string, primed: boolean): boolean {
  return !primed && ballPhase === 'loading' && scenePhase === 'presented';
}

/** The primer's per-stage hold (ms): half of HOVER_PRIMER_MS, shortened to end before the beam pre-raster (pure). */
export function hoverPrimerStageMs(loadingForMs: number): number {
  const room = BEAM_PRERASTER.startDelayMs - HOVER_PRIMER_BEFORE_BEAM_MS - loadingForMs;
  return Math.max(50, Math.min(HOVER_PRIMER_MS / 2, Math.floor(room / 2)));
}

export default function HoverChromePrimer() {
  // ENGINE-A4: 0 = off, 1 = the corner brackets (drop-shadow), 2 = the label
  // pill (backdrop-filter, box-shadow): one Skia program set per stage.
  const [stage, setStage] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    if (primedThisPage) return;
    const started = performance.now();
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const poll = setInterval(() => {
      if (performance.now() - started > HOVER_PRIMER_WATCH_MS) {
        clearInterval(poll);
        return;
      }
      const ball = getBallPhase();
      if (!hoverPrimerDue(ball, getScenePhase(), primedThisPage)) return;
      const stageMs = hoverPrimerStageMs(performance.now() - getBallPhaseSince());
      primedThisPage = true;
      clearInterval(poll);
      setStage(1);
      hideTimer = setTimeout(() => {
        setStage(2);
        hideTimer = setTimeout(() => setStage(0), stageMs);
      }, stageMs);
    }, HOVER_PRIMER_POLL_MS);
    return () => {
      clearInterval(poll);
      if (hideTimer !== null) clearTimeout(hideTimer);
    };
  }, []);

  if (stage === 0) return null;
  return (
    <div
      aria-hidden="true"
      data-hover-primer=""
      style={{
        position: 'fixed',
        left: 16,
        top: 96,
        width: 160,
        height: 72,
        zIndex: 24,
        opacity: 0.002,
        pointerEvents: 'none',
      }}
    >
      {stage === 1 ? (
        <div style={{ position: 'absolute', left: 0, top: 0, width: 64, height: 40 }}>
          <span className={`${styles.corner} ${styles.tl}`} />
          <span className={`${styles.corner} ${styles.br}`} />
        </div>
      ) : (
        <div className={styles.pill} style={{ transform: 'translate(72px, 0)' }}>
          <span className={styles.label}>A</span>
          <span className={styles.hint}>A</span>
        </div>
      )}
    </div>
  );
}
