'use client';

import { useEffect, useState } from 'react';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { useWindowFlags } from '@/components/world/route/residency-store';

/**
 * The visitor's station index, read the exact way AmbientFigures reads it —
 * the conductor's hysteretic NEAREST station (W6: `progress.nearest`,
 * stepped by `stepStationLatch`), delivered through the conductor's change
 * channel, which commits before the next frame (the capture harness's FBO
 * present must never land in the commit gap).
 *
 * D23 (complete at reveal) reversed C-089's deferral. The station windows no
 * longer decide WHEN a population mounts: every window is resident from the
 * first render, so every GLB, program and texture upload lands inside the
 * Pokéball ceremony and nothing streams in after the world appears. The
 * window now decides only DORMANCY (`src/lib/route-world/residency.ts`):
 * outside `[from − 1, to + 1]` a group stays mounted and visible (the warm
 * pass and the shadow map see it) but its figures stop their per-frame work.
 * The windows keep their C-089 sizing — one station of lead before a
 * population's first on-camera station — so a group is awake before the
 * camera reaches it, from either direction.
 *
 * The idle lead, the skip-through gate and the per-window warm compile
 * (`useStationLead`, `useSkipGate`, `useWarmCompile`) are gone from here:
 * with nothing left to latch, a skip-through has nothing to mount (the W6
 * residual is absorbed), and the ceremony's warm pass compiles everything.
 */
declare global {
  interface Window {
    /**
     * Diagnosis/parity readout per window, keyed by bounds. `entered` and
     * `resident` are true from the first render (D23: nothing latches after
     * load; the harness's skip-through mount audit therefore sees no
     * false → true transition). `inWindow` is the old entry test, `dormant`
     * the frame-work gate.
     */
    __c089Windows?: Record<string, { from: number; to: number; station: number; entered: boolean; resident: boolean; inWindow: boolean; dormant: boolean; updatedAtMs: number }>;
    __c089Station?: { station: number; exact: number; updatedAtMs: number };
    __c089StationLog?: { t: number; exact: number; rounded: number }[];
  }
}

/**
 * Append one station read to the capped in-page trace (bar-1 evidence).
 * `rounded` keeps its historical field name; it now holds the latched
 * nearest station.
 */
function logStationRead(exact: number, rounded: number): void {
  const log = (window.__c089StationLog ??= []);
  log.push({ t: performance.now(), exact, rounded });
  if (log.length > 400) log.splice(0, log.length - 400);
}

export function useStationIndex(): number {
  const { conductor } = useWorldState();
  const [station, setStation] = useState(() => conductor.progress.current?.nearest ?? 0);

  useEffect(() => {
    const readNearest = () => {
      const exact = conductor.progress.current?.exact ?? 0;
      const nearest = conductor.progress.current?.nearest ?? 0;
      logStationRead(exact, nearest);
      setStation((cur) => (nearest === cur ? cur : nearest));
    };
    readNearest();
    // The conductor's change channel fires on every scroll sample AND every
    // re-measure — the gap once escalated here (PR #63 review: a resize or
    // programmatic jump left the index stale until the next scroll) is closed
    // by the W6 channel rather than a per-consumer scroll listener.
    return conductor.subscribe(readNearest);
  }, [conductor]);

  // Diagnosis readout: the station value the fixtures actually hold, next to
  // the conductor's own exact at the same instant.
  useEffect(() => {
    window.__c089Station = {
      station,
      exact: conductor.progress.current?.exact ?? -1,
      updatedAtMs: performance.now(),
    };
  }, [station, conductor]);

  return station;
}

/** One plaza window: resident from the first render, dormant outside its lead. */
export interface StationWindowState {
  resident: true;
  dormant: boolean;
}

/**
 * The window as a residency/dormancy pair (D23). `resident` is true from the
 * first render; wrap the group in `<DormancyScope dormant={dormant}>` so its
 * figures pause off-window. `options.lead` / `options.skipStation` are kept
 * for call-site compatibility and ignored: residency no longer waits for an
 * idle lead or a skip-through gate.
 */
export function useStationWindowState(
  from: number,
  to: number,
  options: { lead?: boolean; skipStation?: number } = {},
): StationWindowState {
  void options; // kept signature; D23 residency ignores the lead / skip options
  // ENGINE r2: re-renders only when a flag flips, never at a mere station
  // crossing (the gate and hero props call this and ignore the result); the
  // station goes to the readout outside React state.
  const { dormant } = useWindowFlags(from, to, (station, flags) => {
    const map = (window.__c089Windows ??= {});
    map[`[${from},${to}]`] = { from, to, station, entered: true, resident: true, inWindow: flags.inWindow, dormant: flags.dormant, updatedAtMs: performance.now() };
  });

  return { resident: true, dormant };
}

/**
 * The C-089 boolean gate, kept for its callers: always `true` since D23 (the
 * population is resident from load). Use `useStationWindowState` for the
 * dormancy flag.
 */
export function useStationWindow(
  from: number,
  to: number,
  options: { lead?: boolean; skipStation?: number } = {},
): boolean {
  return useStationWindowState(from, to, options).resident;
}
