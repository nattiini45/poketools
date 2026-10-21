'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { publishRouteTelemetry } from '../post/post-store';

/**
 * The pose probe's pixel-ratio enrichment and the debug overlay's render
 * telemetry.
 *
 * Split out of RouteWorldCanvas.tsx (M15) without a behaviour change; the
 * canvas entry mounts it.
 */

/** The pose probe as seen from this module (CameraRig owns the real shape). */
type ProbeHost = Window & {
  __routeWorldProbe?: () => Record<string, unknown>;
};

/**
 * C-032: enrich the CameraRig pose probe with the live pixel ratio so a
 * capture sidecar can prove DPR held constant across a whole run (C-027 visual review
 * finding). Strictly additive — the wrapped function still returns everything
 * the rig published, plus `pixelRatio` from `renderer.getPixelRatio()`.
 *
 * Re-wrapped from `useFrame` rather than a mount effect: the rig reinstalls
 * the probe whenever its `conductor` identity changes, which happens between
 * stations of a capture run — a one-shot wrap would silently fall off by the
 * second sidecar. The per-frame check is a pointer compare; if the probe is
 * absent (rig removed), this is a no-op, never an error.
 */
export function ProbeDprBridge() {
  const gl = useThree((state) => state.gl);
  const wrappedRef = useRef<(() => Record<string, unknown>) | null>(null);
  const originalRef = useRef<(() => Record<string, unknown>) | null>(null);

  useFrame(() => {
    const host = window as ProbeHost;
    const current = host.__routeWorldProbe;
    if (!current || current === wrappedRef.current) return;
    originalRef.current = current;
    const original = current;
    const wrapped = (): Record<string, unknown> => ({ ...original(), pixelRatio: gl.getPixelRatio() });
    wrappedRef.current = wrapped;
    host.__routeWorldProbe = wrapped;
  });

  useEffect(
    () => () => {
      // Restore the rig's own function if ours is still installed.
      const host = window as ProbeHost;
      if (wrappedRef.current && host.__routeWorldProbe === wrappedRef.current && originalRef.current) {
        host.__routeWorldProbe = originalRef.current;
      }
    },
    [],
  );

  return null;
}

/**
 * C-032: per-frame render telemetry for the debug overlay — fps, draw calls,
 * triangles, rung, DPR — sampled from `renderer.info` and published to the
 * external store the DOM overlay polls (see `post-store.ts`).
 *
 * Draw-call accounting with a composer needs `autoReset` off: three resets
 * `info.render` after every `render()` call, which under post-processing
 * would leave the readout holding the last fullscreen pass (1 call, 2
 * triangles) instead of the frame. This sampler runs first every frame
 * (priority < 0 keeps automatic rendering), reads the previous frame's
 * accumulated totals, then zeroes just the render counters — memory counters
 * are cumulative and stay untouched.
 */
export function TelemetrySampler({ rung }: { rung: number }) {
  // `state.get` (not `state.gl`): the sampler mutates `renderer.info`, and the
  // react-hooks/immutability lint rightly flags writes through hook-returned
  // objects — reaching the renderer through the store accessor keeps the
  // mutation explicit while satisfying the rule.
  const get = useThree((state) => state.get);
  const ema = useRef(0);

  useEffect(() => {
    const gl = get().gl;
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
      gl.info.reset();
    };
  }, [get]);

  useFrame((_, delta) => {
    const gl = get().gl;
    const info = gl.info.render;
    const frameMs = delta * 1000;
    if (delta > 0 && delta < 1) {
      ema.current = ema.current === 0 ? 1 / delta : ema.current * 0.9 + (1 / delta) * 0.1;
    }
    publishRouteTelemetry({
      fps: ema.current,
      frameMs,
      calls: info.calls,
      triangles: info.triangles,
      rung,
      dpr: gl.getPixelRatio(),
    });
    info.calls = 0;
    info.triangles = 0;
    info.points = 0;
    info.lines = 0;
    // Never `info.frame`: three keys its once-per-frame skeleton update on
    // it (`WebGLObjects.update`). Zeroed every tick, the main pass always
    // read 0, so a skinned part the shadow pass skips (C-048's trimmed eyes
    // and mouths) never refreshed its bones and stood frozen in its first
    // pose while the body animated — in every `routeDebug=1` capture.
  }, -1000);

  return null;
}
