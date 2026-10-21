'use client';

import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useWorldState } from '../WorldStateProvider';
import { beginStatsFrame, installWarmStatsBridge } from '../perf/warm-stats';
import { ceremonyRenderHold } from '../scene-progress';
import { themeVeilHoldsWorldDraws } from '../theme-veil-store';
import { drawnFrames, setFrameHold } from './frame-hold';

/**
 * Engine frame callbacks: the warm-stats frame opener, the ceremony render
 * hold and the sky clear colour.
 *
 * Split out of RouteWorldCanvas.tsx (M15) without a behaviour change; the
 * canvas entry mounts it.
 */

/**
 * ENGINE-A4R (routeDebug only): opens each frame's record in the work ledger
 * (perf/warm-stats.ts) before any other frame callback, and publishes
 * `window.__routeWarmStats` for the capture harness.
 */
export function WarmStatsFrames() {
  useEffect(() => installWarmStatsBridge(), []);
  useFrame(() => beginStatsFrame(performance.now()), -100000);
  return null;
}

/**
 * Ceremony render hold (wave-2 r2, W7 compositor-freeze veto — see
 * scene-progress `ceremonyRenderHold`): from the arm until shortly after the
 * ball is done the renderer does not draw, so no upload or program link of
 * content that streamed in late shares the GPU process with the CSS beam.
 * The canvas the ceremony fades in keeps its last drawn frame (the camera is
 * parked on the first station). Never before the renderer has drawn once.
 */
export function CeremonyRenderGate() {
  const gl = useThree((state) => state.gl);
  useFrame(() => {
    // ENGINE-FIX (D32): also while the theme veil closes over the world.
    setFrameHold(gl, 'ceremony', drawnFrames(gl) > 0 && (ceremonyRenderHold(performance.now()) || themeVeilHoldsWorldDraws()));
  }, -2000);
  useEffect(
    () => () => {
      // Only the ceremony's own reason: the warm hold belongs to the LoadWarmer.
      setFrameHold(gl, 'ceremony', false);
    },
    [gl],
  );
  return null;
}

export function SkyClear() {
  const { palette } = useWorldState();
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    gl.setClearColor(palette.sky, 1);
    gl.setClearAlpha(1);
  }, [gl, palette.sky]);

  return null;
}
