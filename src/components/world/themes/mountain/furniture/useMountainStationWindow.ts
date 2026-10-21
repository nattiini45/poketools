'use client';

import { useWindowFlags } from '@/components/world/route/residency-store';

/**
 * The mountain figure-window gate (C-103 criterion 1), re-implemented
 * IN-PACKAGE (plaza's `useStationWindow` is another theme's client module,
 * not a shared export).
 *
 * D23 (complete at reveal) reversed the C-089 deferral: every window is
 * RESIDENT from the first render, so every GLB, program and upload lands
 * inside the Pokéball ceremony and nothing streams in after the world
 * appears. The idle lead, the skip-through gate and the per-window warm
 * compile are gone (nothing is left to latch).
 *
 * ROLLOUT-PLAN §3.2 E2: the `shown` latch is gone too. It kept this world
 * pixel-neutral while it sat outside the plaza pilot by hiding a group after
 * the reveal until the visitor first entered its window — a visibility flip
 * of resident content in front of the visitor (D23 pop-in). A group is now
 * shown from the ceremony on, exactly as on the plaza; `shown` stays in the
 * state for its call sites and is always true.
 *
 * What the window still decides (`src/lib/route-world/residency.ts`):
 * - `dormant`: outside `[from − 1, to + 1]` by the hysteretic nearest
 *   station — the group stays mounted and visible, its figures stop their
 *   per-frame work (wrap it in `<DormancyScope>`).
 */
declare global {
  interface Window {
    /** Diagnosis/parity readout per mountain figure window (D23: `resident` and `shown` are true from the first render). */
    __mountainFigureWindows?: Record<string, { from: number; to: number; station: number; resident: boolean; shown: boolean; inWindow: boolean; dormant: boolean; updatedAtMs: number }>;
  }
}

/** Residency split (D23): always mounted, always shown; dormant off-window. */
export interface MountainStationWindowState {
  /** Mount the group — true from the first render. */
  mounted: boolean;
  /** Show the group — true from the first render (E2: no post-reveal visibility latch). */
  shown: boolean;
  /** Pause the group's figures: `<DormancyScope dormant={dormant}>`. */
  dormant: boolean;
}

/**
 * The window as a mount/show/dormant triple. `options.lead` is kept for
 * call-site compatibility and ignored (no idle lead since D23).
 */
export function useMountainStationWindowState(
  from: number,
  to: number,
  options: { lead?: boolean } = {},
): MountainStationWindowState {
  void options; // kept signature; D23 residency has no idle lead
  // ENGINE r2: the flags re-render the group only when they flip, not at
  // every station crossing (the station itself goes to the readout only).
  const { dormant } = useWindowFlags(from, to, (station, flags) => {
    const map = (window.__mountainFigureWindows ??= {});
    map[`[${from},${to}]`] = { from, to, station, resident: true, shown: true, inWindow: flags.inWindow, dormant: flags.dormant, updatedAtMs: performance.now() };
  });

  return { mounted: true, shown: true, dormant };
}

/**
 * The original boolean gate: `true` from the first render since D23 (the
 * group is resident from load). Use the state form for `dormant`.
 */
export function useMountainStationWindow(from: number, to: number, options: { lead?: boolean } = {}): boolean {
  return useMountainStationWindowState(from, to, options).mounted;
}
