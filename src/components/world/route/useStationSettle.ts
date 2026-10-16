'use client';

import { useEffect, useState } from 'react';
import {
  SETTLE_EPS,
  SETTLE_HOLD_MS,
  createSettleState,
  stepSettleLatch,
  type SettleState,
} from '@/lib/route-world/data-surfaces';
import { useWorldState } from './WorldStateProvider';

export interface StationSettle {
  /** The hysteretic nearest station the latch tracks (`progress.nearest`). */
  station: number;
  /** Latched: the visitor has ARRIVED at `station` (see `stepSettleLatch`). */
  settled: boolean;
}

/**
 * The single latched `settled` signal (fidelity wave 2, WAVE-PLAN §1 / §5.4).
 * The Station Card, the 6 s reading window after arrival and every arrival
 * ceremony key on THIS, never on raw x.5 progress.
 *
 * `settled` turns true once the rendered position has caught up
 * (`|smooth − exact| < 0.02`), the hysteretic nearest station has held for
 * 150 ms and the rendered position sits at that station; it stays true
 * until the nearest station changes or the rendered position clearly leaves
 * (the pure latch, `stepSettleLatch` in data-surfaces.ts, is unit-tested).
 *
 * Sampling: `smooth` is advanced by the canvas frame loop, not by scroll
 * events, so the hook polls on requestAnimationFrame only while something
 * can still change without a scroll (smooth catching up, or the hold clock
 * running) and otherwise sleeps until the conductor's change channel fires.
 *
 * Honest limit: with no frame loop advancing `smooth` (Lite tier, a hidden
 * tab) the latch cannot settle — correct for the route-tier-only card, but
 * a Lite consumer must not key on it.
 */
export function useStationSettle(): StationSettle {
  const { conductor } = useWorldState();
  const [state, setState] = useState<SettleState>(createSettleState);

  useEffect(() => {
    let current = createSettleState();
    let raf = 0;
    const tick = () => {
      raf = 0;
      const progress = conductor.progress.current;
      if (!progress) return;
      const now = performance.now();
      const next = stepSettleLatch(current, {
        smooth: progress.smooth,
        exact: progress.exact,
        nearest: progress.nearest,
        now,
      });
      if (next !== current) {
        current = next;
        setState(next);
      }
      const catching = Math.abs(progress.smooth - progress.exact) >= SETTLE_EPS;
      const holding = !current.settled && now - current.heldSince < SETTLE_HOLD_MS;
      if (catching || holding) raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (raf === 0) raf = requestAnimationFrame(tick);
    };
    wake();
    const unsubscribe = conductor.subscribe(wake);
    return () => {
      unsubscribe();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [conductor]);

  return { station: Math.max(0, state.station), settled: state.settled };
}
