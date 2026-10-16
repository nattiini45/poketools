'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { advanceSmooth } from './useScrollConductor';
import { armStationWarmup, compileHeldCount, guardCompileFrame, noteProgramsFrame } from './useStationWarmup';
import { useWorldHandoff, useWorldState } from './WorldStateProvider';

/** Debug captures only: `?routeShaderCheck=0` keeps three's shader checker off. */
function shaderCheckOptOut(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('routeShaderCheck') === '0';
  } catch {
    return false;
  }
}

/**
 * Advances the conductor's damped channel once per frame, ahead of every
 * other subscriber.
 *
 * `exact` is computed synchronously by the scroll listener and costs nothing
 * when the page is idle; `smooth` is the only part that needs a clock, so it
 * borrows the canvas's. The negative render priority guarantees the camera
 * and the world channels read a value produced this frame rather than the
 * last one, without taking over the render loop the way a positive priority
 * would.
 *
 * W6 round 2: it is also the first thing each frame runs, so it hosts the
 * compile guard (`useStationWarmup`) — renderables whose shader program is
 * still linking are held back BEFORE the frame renders them, instead of the
 * first draw blocking the whole frame for seconds. A nearest-station change
 * opens the warm window too (a crossing can bring new programs that no
 * station-window latch announced).
 *
 * Review r4 (W7 reveal hitches): the first frame of every canvas opens a
 * warm window too — before the reveal can arm — so the whole scene, the post
 * stack's render target included, compiles while the canvas is still hidden,
 * and `noteProgramsFrame` publishes `programsWarm` (trace-only since W2 — the
 * reveal gate no longer reads it). Outside
 * `?routeDebug=1` three's per-program `checkShaderErrors` pass is switched off:
 * its `getProgramInfoLog` calls on first use were part of the measured freeze.
 * Review r5: a debug capture can opt out too (`?routeShaderCheck=0`), so a
 * trace measures the production-like compile cost instead of the checker's.
 * It is set here, in the priority −1 frame that runs before the first render
 * of every canvas — the same moment an `onCreated` hook would.
 */
export default function ConductorDriver() {
  const { conductor, debug } = useWorldState();
  const { routeSceneLive } = useWorldHandoff();
  const lastNearest = useRef<number | null>(null);
  const checkShaders = useMemo(() => debug && !shaderCheckOptOut(), [debug]);

  useFrame((state, delta) => {
    if (state.gl.debug.checkShaderErrors !== checkShaders) state.gl.debug.checkShaderErrors = checkShaders;
    noteProgramsFrame(state.gl, state.scene, state.camera);
    // W6 round 2: a scrollTo whose scroll event is still queued behind a long
    // frame is sampled here, so the camera never flies against a stale offset.
    conductor.sync();
    const progress = conductor.progress.current;
    if (routeSceneLive && progress.nearest !== lastNearest.current) {
      if (lastNearest.current !== null) armStationWarmup(state.gl, state.scene, state.camera);
      lastNearest.current = progress.nearest;
    }
    guardCompileFrame(state.gl, state.scene, routeSceneLive);
    // A held renderable is released by a later frame; under the parked
    // `demand` frameloop make sure that frame comes.
    if (compileHeldCount() > 0) state.invalidate();
    advanceSmooth(progress, delta);
  }, -1);

  return null;
}
