'use client';

import { useLayoutEffect, useSyncExternalStore } from 'react';
import { useWorldHandoff, useWorldState } from '@/components/world/route/WorldStateProvider';
import { getRenderedFrames } from '@/components/world/route/scene-progress';
import { abortThemeVeil, getThemeVeilPhase, subscribeThemeVeil } from '@/components/world/route/theme-veil-store';
import {
  INITIAL_COMPOSITE_GATE,
  routeHandoffAllowed,
  stepHandoffComposite,
  type CompositeSample,
} from '@/lib/route-world/ball-loader-state';

/** Phase 1 of the handoff: the canvas rises over the still-painted page. */
export const ROUTE_HANDOFF_ATTR = 'data-route-handoff';
/** Phase 2: the sections' paint is hidden — the world IS the page. */
export const ROUTE_LIVE_CLASS = 'world-route-live';

/** One read of the canvas wrapper's composited state (see `stepHandoffComposite`). */
function sampleCanvas(): CompositeSample {
  const canvas = document.querySelector<HTMLElement>('[data-route-canvas]');
  if (canvas === null) {
    // No canvas to show: the page must stay (never hide it over nothing).
    return { canvasOpacity: 0, animating: false, renderedFrames: getRenderedFrames() };
  }
  const animating =
    typeof canvas.getAnimations === 'function' &&
    canvas.getAnimations().some((animation) => animation.pending || animation.playState === 'running');
  return {
    canvasOpacity: Number.parseFloat(getComputedStyle(canvas).opacity),
    animating,
    renderedFrames: getRenderedFrames(),
  };
}

/**
 * Route-tier: the 3D plaza is the page. HTML sections keep their height so
 * the conductor still measures them, but their paint is hidden. Lite is
 * untouched.
 *
 * The handover waits on `routeSceneLive` from the provider — the readiness
 * handshake, not capability detection: `tier === 'route'` only means this
 * device may run the scene, so hiding the paint on that alone would leave a
 * blank page for as long as the scene chunk, models and environment take to
 * stream. Committing on a presentation the provider WITNESSED arrive keeps
 * the semantic page usable through the whole loading interval, and a scene
 * that fails or times out stays in Lite — where neither mark is ever applied
 * — so recovery is the readable page rather than an empty viewport.
 *
 * TWO-PHASE handoff (review r3, blank-frame veto). The r2 single class flip
 * hid the sections AND started the canvas fade from 0 in one style change, so
 * a stalled frame composited neither (an empty ground-colour page for up to
 * 550 ms). Now:
 *
 * 1. On `routeSceneLive` this writes `html[data-route-handoff]` in a layout
 *    effect — the same commit that renders the ball's `data-revealing`, so the
 *    CSS ceremony (flight → hinge → beam → canvas fade, globals.css W7 block) runs as
 *    one compositor timeline. The canvas rises to opacity 1 OVER the
 *    sections, which are still painted underneath: by paint order its
 *    positioned wrapper already lies above them.
 * 2. `world-route-live` (the class every section-hiding rule is scoped to) is
 *    added only when `stepHandoffComposite` says the canvas has composited:
 *    computed opacity 1, no transition/animation (the release fade) still running,
 *    for consecutive animation frames, and the renderer drew a frame since.
 *
 * So any frame, however stalled, shows the page, the world, or the world
 * opening over the page — never neither. Both marks drop together when the
 * handoff is withdrawn (Lite, a new generation, unmount).
 *
 * Disclosed limit: phase 2 is sampled on animation frames, so a hidden tab
 * (rAF paused) keeps the page painted under the world until it is visible
 * again — invisible, and harmless. The phase-2 layout flip re-seats the
 * scroll on the visitor's station (useScrollConductor), now with the world
 * visible rather than behind the r2 flash.
 *
 * The trust latch itself lives in the provider: this component can remount
 * (key/layout change) while the scene is legitimately presented, and a local
 * latch initialized in that state would suppress the handover for the rest
 * of the session (PR #63 review).
 *
 * Wave-2 r3 (Lite floor): the handoff is written ONLY from that commit and
 * never under the Lite tier (`routeHandoffAllowed`) — a reduced-motion
 * visitor on the auto tier resolves Lite (D12), mounts no canvas, and must
 * never see either mark. (The r2 "canvas shown under reduced motion" reading
 * was the harness's own timecode canvas, picked up by a `canvas` fallback
 * selector while no route canvas existed.)
 */
const getIdleVeil = () => 'idle' as const;

function removeMarks(): void {
  const root = document.documentElement;
  root.removeAttribute(ROUTE_HANDOFF_ATTR);
  root.classList.remove(ROUTE_LIVE_CLASS);
}

export default function HideHtmlOnRoute() {
  const { tier } = useWorldState();
  const { routeSceneLive: sceneLive } = useWorldHandoff();
  const routeSceneLive = routeHandoffAllowed({ tier, routeSceneLive: sceneLive });
  // D32: while the theme veil is up the world stays the page — the swap's
  // generation loads, warms and arms BEHIND the veil, so the handoff marks
  // (sections hidden, HUD shown, canvas opaque) are kept through it instead
  // of handing the page back for a second ceremony. Route tier only: any
  // flip to Lite drops the veil and the marks together.
  const veilPhase = useSyncExternalStore(subscribeThemeVeil, getThemeVeilPhase, getIdleVeil);
  const veilHolds = tier === 'route' && veilPhase !== 'idle';

  useLayoutEffect(() => {
    if (tier !== 'route') abortThemeVeil();
  }, [tier]);

  // Unmount (and only unmount) drops the marks unconditionally.
  useLayoutEffect(() => removeMarks, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    // D32: read at call time — the veil commits its generation (which
    // withdraws this handoff) while it is already opaque.
    const veilHoldsNow = () => tier === 'route' && getThemeVeilPhase() !== 'idle';
    if (!routeSceneLive) {
      // The veiled swap keeps the marks the live generation wrote.
      if (!veilHoldsNow()) removeMarks();
      return;
    }
    root.setAttribute(ROUTE_HANDOFF_ATTR, '');

    let gate = INITIAL_COMPOSITE_GATE;
    let frame = 0;
    const tick = () => {
      frame = 0;
      const step = stepHandoffComposite(gate, sampleCanvas());
      gate = step.gate;
      if (step.live) {
        root.classList.add(ROUTE_LIVE_CLASS);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      if (!veilHoldsNow()) removeMarks();
    };
  }, [routeSceneLive, tier]);

  // D32: the veil let go (or aborted) while no generation is live: the page
  // is handed back (Lite, or a swap that never armed).
  useLayoutEffect(() => {
    if (!veilHolds && !routeSceneLive) removeMarks();
  }, [veilHolds, routeSceneLive]);

  return null;
}
