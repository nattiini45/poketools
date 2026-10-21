'use client';

import { useEffect, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { type FrameStats, getFrameStats, recordFrame, resetFrameStats } from '../perf/frame-stats';
import { bindResidencySource, trackDefaultLoadingManager } from '../scene-progress';
import { getResidencySnapshot, residencyComplete, subscribeResidency } from '../residency-store';
import { uncappedFrameMs } from '../frame-cap';

/**
 * Load-progress relays (residency, THREE's default loading manager) and the
 * always-on frame-time recorder.
 *
 * Split out of RouteWorldCanvas.tsx (M15) without a behaviour change; the
 * canvas entry mounts it.
 */

/**
 * D23: relays seat R's residency store (`residency-store.ts`, scene chunk)
 * into the progress store the provider reads (`bindResidencySource`), for as
 * long as this canvas lives.
 */
export function ResidencyBridge() {
  useEffect(
    () =>
      bindResidencySource({
        complete: residencyComplete,
        subscribe: subscribeResidency,
        // Committed populations (a stall-detector progress count; high-water).
        progress: () => {
          const snapshot = getResidencySnapshot();
          return snapshot.registered - snapshot.pending;
        },
      }),
    [],
  );
  return null;
}

/**
 * M3 for the loader (W7): chains THREE's default loading manager for as long
 * as this canvas lives and restores the previous handlers on unmount.
 *
 * A LAYOUT effect on purpose: R3F calls `onCreated` from its root provider's
 * layout effect, which runs after every child's — so the chain is installed
 * before `armFigureLoader` flushes the queued GLB preloads and their
 * `onStart` is observed rather than missed.
 */
export function LoadProgressBridge() {
  useLayoutEffect(() => trackDefaultLoadingManager(), []);
  return null;
}

type FrameStatsHost = Window & {
  __routeWorldFrameStats?: () => FrameStats;
};

/**
 * Always-on frame-time recorder for the D1 percentile budgets.
 *
 * Not debug-gated: one ring-buffer write per frame costs far less than the
 * render it measures, and a budget that only exists behind a query param never
 * gets measured on a real device. Published on the same window-bridge
 * convention as `__routeWorldPresent` and `__routeWorldRenderPath`, so a perf
 * trace can read percentiles without driving any UI.
 */
export function FrameStatsRecorder() {
  useFrame((_, delta) => {
    // D38: a frame the cap skipped on purpose is not a slow frame.
    recordFrame(uncappedFrameMs(delta * 1000));
  });

  useEffect(() => {
    const host = window as FrameStatsHost;
    host.__routeWorldFrameStats = getFrameStats;
    return () => {
      delete host.__routeWorldFrameStats;
      resetFrameStats();
    };
  }, []);

  return null;
}
