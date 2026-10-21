'use client';

import { useEffect, useState } from 'react';
import type { QualityStep } from '@/lib/route-world/quality';
import { useQuality } from '../QualityGovernor';
import { useWorldHandoff, useWorldState } from '../WorldStateProvider';

/**
 * The station lead (idle and travel) and the idle-callback helper.
 *
 * Split out of useStationWarmup.ts (M16) without a behaviour change; that
 * file re-exports it.
 */

/** Rest time one station before a window before the idle lead may fire. */
export const STATION_LEAD_IDLE_MS = 1200;

/**
 * Quality gate for the idle lead (quality.ts stays the only authority: this
 * reads a ladder field, it does not invent a tier). Only rungs that still
 * carry the post stack (0–1) have the headroom to hold a station's population
 * early; lower rungs keep the plain entry latch.
 */
export function stationLeadAllowed(step: QualityStep): boolean {
  return step.post;
}

/** Whether `station` sits exactly one station outside `[from, to]`. */
export function isLeadStation(station: number, from: number, to: number): boolean {
  return station === from - 1 || station === to + 1;
}

/**
 * TRAVEL lead distance, in station units (round 4). The idle lead needs the
 * visitor to rest; a sweep or fling that starts at once mounted the window at
 * its mid-crossing entry latch — the plaza upward sweep from rules mounted
 * the aces window [1,3] at smooth ≈ 3.65 and their first draw froze the frame
 * for 333 ms at 3.44. While the latched direction points AT the window and
 * the position is within this many stations of the window's near edge, the
 * window latches. The measure is symmetric by construction: going down it is
 * `from − position`, going up `position − to`, so station k−1 is warmed at
 * k + 0.6 on the way up exactly as k+1 is at k − 0.6 on the way down.
 */
export const STATION_TRAVEL_LEAD = 1.65;

/** The progress fields the travel lead reads. */
export interface TravelLeadProgress {
  /** Scroll-mapped position (the conductor's `exact`, which leads `smooth`). */
  position: number;
  /** Latched travel direction (−1 up, +1 down, 0 at rest). */
  direction: -1 | 0 | 1;
}

/**
 * Whether a window `[from, to]` should be pre-mounted by the travel lead:
 * the visitor is moving toward it and is within STATION_TRAVEL_LEAD stations
 * of its near edge (inside the window is the entry latch's business).
 */
export function travelLeadWanted(progress: TravelLeadProgress, from: number, to: number): boolean {
  if (progress.direction === 0) return false;
  const distance = progress.direction < 0 ? progress.position - to : from - progress.position;
  return distance > 0 && distance <= STATION_TRAVEL_LEAD + 1e-9;
}

export type IdleHandle = { cancel: () => void };

function onIdle(callback: () => void): IdleHandle {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 1000 });
    return { cancel: () => window.cancelIdleCallback(id) };
  }
  const id = window.setTimeout(callback, 0);
  return { cancel: () => window.clearTimeout(id) };
}

/**
 * True once the visitor has rested one station ahead of the window (see the
 * module note); latches for the session like the residency it feeds.
 * `enabled` false keeps it permanently false.
 */
export function useStationLead(station: number, from: number, to: number, enabled: boolean): boolean {
  const { conductor } = useWorldState();
  const { routeSceneLive } = useWorldHandoff();
  const quality = useQuality();
  const allowed = enabled && routeSceneLive && stationLeadAllowed(quality);
  const adjacent = isLeadStation(station, from, to);
  const [lead, setLead] = useState(false);

  useEffect(() => {
    if (lead || !allowed || !adjacent) return;
    let idle: IdleHandle | null = null;
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        const progress = conductor.progress.current;
        // Still travelling (latched direction, or `exact` not at rest on the
        // lead station): re-arm instead of mounting under a moving camera.
        if (progress.direction !== 0 || !isLeadStation(progress.nearest, from, to)) {
          arm();
          return;
        }
        idle = onIdle(() => setLead(true));
      }, STATION_LEAD_IDLE_MS);
    };
    arm();
    return () => {
      window.clearTimeout(timer);
      idle?.cancel();
    };
  }, [lead, allowed, adjacent, conductor, from, to]);

  // Travel lead (round 4): latch as soon as the visitor heads toward the
  // window and is within STATION_TRAVEL_LEAD of it — both directions alike.
  // Read on the conductor's change channel (every scroll sample), so the
  // commit lands before the next frame, a full station ahead of the entry.
  useEffect(() => {
    if (lead || !allowed) return;
    const check = () => {
      const progress = conductor.progress.current;
      if (!progress) return;
      if (travelLeadWanted({ position: progress.exact, direction: progress.direction }, from, to)) setLead(true);
    };
    check();
    return conductor.subscribe(check);
  }, [lead, allowed, conductor, from, to]);

  return lead;
}
