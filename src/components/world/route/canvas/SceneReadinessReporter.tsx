'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { currentSceneGeneration, markScenePresented, SCENE_PRESENT_SETTLE_MS } from '../world-readiness';
import { noteRenderedFrame, recordSceneMilestone, scheduleAtWallClock } from '../scene-progress';
import { drawnFrames } from './frame-hold';

/**
 * The readiness handshake's scene side (`markScenePresented`).
 *
 * Split out of RouteWorldCanvas.tsx (M15) without a behaviour change; the
 * canvas entry mounts it.
 */

/**
 * The readiness handshake's scene side: report `presented` once the renderer
 * has actually painted and the settle window has elapsed.
 *
 * Mounted INSIDE `<Canvas>`, so this only runs while a live renderer exists.
 * Two details matter:
 *
 * - The settle window is WALL CLOCK, not a frame count. A parked tab and the
 *   capture harness's embedded browser both run the frameloop on `demand`,
 *   where frames only happen on invalidate — counting frames there would never
 *   reach a threshold, and the harness records the effective tier from the very
 *   class this gate controls.
 * - The first frame is requested explicitly, for the same reason: in demand
 *   mode nothing would otherwise kick the render that starts the clock.
 *   ENGINE-A5 (D40): under the default `never` loop the request is a no-op
 *   and FrameCapDriver's rAF draws every frame of the ceremony (uncapped).
 *
 * The generation guard is what stops an abandoned scene — a theme switch or a
 * navigation that completed mid-stream — from presenting itself as the new
 * world's first usable frame.
 */
export function SceneReadinessReporter() {
  /**
   * The generation this reporter has already vouched for. Read inside a frame
   * callback, NEVER at mount render: the provider begins its generation in a
   * passive effect, which runs after this component's render, so a render-time
   * capture is one generation stale whenever the scene chunk is already
   * resolved (a retry, a cached soft navigation) — the settle callback would
   * refuse `markScenePresented()` forever, `HideHtmlOnRoute` would never
   * commit, and the 10 s deadline would kill a healthy scene (PR #63 review).
   * Frame callbacks run after the full passive-effect flush, so this always
   * sees the provider's bump.
   */
  const presented = useRef<number | null>(null);
  /**
   * The pending settle (generation it was armed for + its cancel). Review
   * wave-2 r2 (clouds never presented): a plain `setTimeout` settle was
   * armed and NEVER fired on clouds-1440 while the frame loop kept ticking at
   * 60 fps for 20 s — the page sat in `loading` until the readiness deadline
   * sent it to Lite. The settle is now `scheduleAtWallClock` (a timeout AND a
   * per-frame wall-clock check, whichever observes the target first — the
   * same bound the reveal gate uses), and the frame callback below re-checks
   * the due time itself, so a starved or lost timer can no longer strand a
   * painted scene.
   */
  const settle = useRef<{ generation: number; dueAt: number; cancel: () => void } | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  const gl = useThree((state) => state.gl);

  const present = useCallback((armed: number) => {
    settle.current?.cancel();
    settle.current = null;
    // A theme switch or a retry bumped the generation mid-settle, so this
    // scene is no longer the one on screen and must not vouch for itself.
    // Returning WITHOUT recording the refusal is what keeps the handshake
    // alive: the next painted frame re-arms against the live generation
    // (PR #63 review).
    if (armed !== currentSceneGeneration() || presented.current === armed) return;
    presented.current = armed;
    markScenePresented();
  }, []);

  const armSettle = useCallback(() => {
    const armed = currentSceneGeneration();
    const pending = settle.current;
    if (pending !== null) {
      if (pending.generation === armed) {
        // Frame-clock backstop for the scheduled settle.
        if (performance.now() >= pending.dueAt) present(armed);
        return;
      }
      pending.cancel();
      settle.current = null;
    }
    if (presented.current === armed) return;
    const dueAt = performance.now() + SCENE_PRESENT_SETTLE_MS;
    settle.current = { generation: armed, dueAt, cancel: () => {} };
    const cancel = scheduleAtWallClock(dueAt, () => present(armed));
    if (settle.current !== null && settle.current.generation === armed) settle.current.cancel = cancel;
    else cancel();
  }, [present]);

  useEffect(() => {
    invalidate();
  }, [invalidate]);

  useFrame(() => {
    // M4 for the loader (W7): the first painted frame of THIS generation.
    // Idempotent per generation in the store, and read inside the frame
    // callback for the same staleness reason as `presented` above.
    // Review r5 (wobble alignment): recorded only once the renderer has
    // actually DRAWN a frame — i.e. on the tick after the first render.
    // Wave-2 r2: counted by the render hold's own draw counter
    // (`drawnFrames`), NOT `info.render.frame`: the debug TelemetrySampler
    // used to zero `info.render.frame` every tick, so under `routeDebug=1`
    // this callback always read 0 and M4 only rose through the `presented`
    // fallback. The draw counter stays the source either way.
    if (drawnFrames(gl) > 0) {
      recordSceneMilestone(currentSceneGeneration(), 'firstFrame');
    }
    // Two-phase handoff (W7 r3): the sections hide only after the renderer
    // drew a frame under the fully composited canvas.
    noteRenderedFrame();
    armSettle();
  });

  useEffect(
    () => () => {
      settle.current?.cancel();
      settle.current = null;
    },
    [],
  );

  return null;
}
