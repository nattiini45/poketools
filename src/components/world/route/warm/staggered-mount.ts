'use client';

import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { requestWarm } from './compile-guard';
import type { IdleHandle } from './station-lead';

/**
 * The staggered mount (`useStaggeredMount`, `onIdleSlice`).
 *
 * Split out of useStationWarmup.ts (M16) without a behaviour change; that
 * file re-exports it.
 */

// ── Staggered mount (review r5, plaza aces) ──────────────────────────────
//
// The plaza upward sweep still froze 550 ms (GPU) + 211 ms (long task) when
// the eight roster aces mounted in ONE commit: eight skinned clones, their
// geometry buffers and textures all reaching the GPU in the same frame. The
// window's content now arrives one member per idle slice: a slice runs only
// when the browser reports at least MOUNT_SLICE_BUDGET_MS of idle time left
// in the frame (or after MOUNT_SLICE_TIMEOUT_MS, so the row always completes
// even under a busy main thread), and every arrival re-opens the warm window
// so the compile guard and the texture slices run over the newcomer before
// it is drawn. Honest limit: the slice gates WHEN a member commits, not what
// its commit costs — one figure's clone + first upload can still exceed 4 ms,
// it is just never eight at once.

/** Idle time a slice needs before it mounts the next member. */
export const MOUNT_SLICE_BUDGET_MS = 4;
/** Longest a slice waits for idle time before mounting anyway. */
export const MOUNT_SLICE_TIMEOUT_MS = 120;

type IdleDeadlineLike = { timeRemaining: () => number; didTimeout: boolean };

/**
 * Schedule `callback` on the next idle slice with at least `budgetMs` left
 * (re-requesting when a slice is too short), or at `timeoutMs` regardless.
 */
export function onIdleSlice(callback: () => void, budgetMs: number, timeoutMs: number): IdleHandle {
  if (typeof window.requestIdleCallback !== 'function') {
    const id = window.setTimeout(callback, 16);
    return { cancel: () => window.clearTimeout(id) };
  }
  const started = performance.now();
  let id = 0;
  const run = (deadline: IdleDeadlineLike) => {
    const waited = performance.now() - started;
    if (deadline.didTimeout || waited >= timeoutMs || deadline.timeRemaining() >= budgetMs) {
      callback();
      return;
    }
    id = window.requestIdleCallback(run, { timeout: Math.max(1, timeoutMs - waited) });
  };
  id = window.requestIdleCallback(run, { timeout: timeoutMs });
  return { cancel: () => window.cancelIdleCallback(id) };
}

/**
 * How many of `count` members may be mounted: 0 while `active` is false,
 * then one more per idle slice until all are. Each arrival re-opens the warm
 * window (compile guard + texture slices) for the newcomer.
 */
export function useStaggeredMount(count: number, active: boolean): number {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const [mounted, setMounted] = useState(0);

  useEffect(() => {
    if (!active || mounted >= count) return;
    const handle = onIdleSlice(
      () => {
        requestWarm(gl, scene, camera);
        setMounted((current) => Math.min(count, current + 1));
      },
      MOUNT_SLICE_BUDGET_MS,
      MOUNT_SLICE_TIMEOUT_MS,
    );
    return () => handle.cancel();
  }, [active, mounted, count, gl, scene, camera]);

  return active ? Math.min(mounted, count) : 0;
}
