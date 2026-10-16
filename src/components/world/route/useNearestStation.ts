'use client';

import { useEffect, useState } from 'react';
import { useWorldState } from './WorldStateProvider';

/**
 * The visitor's nearest station, as ONE hysteretic signal (bar W6, D6).
 *
 * The conductor steps `progress.nearest` through `stepStationLatch` on every
 * sample: the value moves from station n to n+1 only once `exact` passes
 * n + 0.5 + NEAREST_STATION_BAND, and back only below n + 0.5 − band, so wheel
 * noise, rubber-band overscroll or a remeasure shift around a midpoint can
 * never flip the nav chip, the walker pockets or a residency window back and
 * forth. It still lands on the integer the capture harness settles a hair
 * short of (roster 0.993 → 1, rules 3.996 → 4), exactly as the old
 * `Math.round(exact)` reads did. That is the route layout; in the semantic
 * layout (Lite, or the route tier while the scene loads) the signal is
 * `floor(exact)` — the section the reader is in — so the HUD chip seen during
 * the load is the station the Lite → route flip restores (useScrollConductor).
 *
 * React consumers subscribe to the conductor's change channel, which fires
 * synchronously inside the conductor's own passive scroll listener AND on
 * every re-measure — so the state still commits before the next frame (the
 * capture harness's FBO present must never land in the commit gap), and a
 * resize or a programmatic jump no longer leaves the index stale until the
 * visitor next scrolls (the gap escalated at useStationWindow.ts, PR #63).
 *
 * Per-frame consumers read `conductor.progress.current.nearest` directly.
 *
 * "Which station is nearest" is not "has the visitor arrived": arrival
 * chrome (the Station Card, the reading window, arrival ceremonies) keys on
 * the latched `useStationSettle()` (fidelity wave 2), which is built on this
 * same hysteretic station plus the smooth/exact catch-up and a 150 ms hold.
 */
export function useNearestStation(): number {
  const { conductor } = useWorldState();
  const [station, setStation] = useState(() => conductor.progress.current?.nearest ?? 0);

  useEffect(() => {
    const read = () => {
      const next = conductor.progress.current?.nearest ?? 0;
      setStation((current) => (current === next ? current : next));
    };
    read();
    return conductor.subscribe(read);
  }, [conductor]);

  return station;
}
