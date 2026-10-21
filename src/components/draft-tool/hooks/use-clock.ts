'use client';

/**
 * Display tick for the draft clock (draft-frontend §5.1, §5.7). Display only:
 * the server owns every deadline.
 *
 * The first render (server and hydration) uses the snapshot's `server_now`
 * as "now", so both markups agree. After mount a chained `setTimeout` ticks
 * every 250 ms under 10 minutes left, else every second, on the server clock
 * (`Date.now() + serverOffsetMs`). Inside a quiet window the number stands
 * still, so one tick is scheduled for the moment the window ends.
 */
import { useEffect, useRef, useState } from 'react';
import { computeClock, type ActiveSlotLike, type ClockView } from '@/lib/draft-ui/clock';

const FAST_BELOW_MS = 10 * 60 * 1000;
const FAST_TICK_MS = 250;
const SLOW_TICK_MS = 1000;

/** Longest single wait (setTimeout clamps above ~24.8 days; a held clock re-checks well before that). */
const MAX_WAIT_MS = 6 * 60 * 60 * 1000;

/**
 * Delay of the next display tick; null when nothing moves (paused, expired, no deadline). While a quiet window holds
 * the clock the delay runs to the window's end (`nowServerMs` = the "now" the view was computed for).
 */
export function clockTickMs(view: ClockView | null, nowServerMs?: number): number | null {
  if (!view || view.paused || view.expired || view.deadlineAt === null) return null;
  if (view.heldUntil !== null && nowServerMs !== undefined) {
    return Math.min(MAX_WAIT_MS, Math.max(SLOW_TICK_MS, view.heldUntil - nowServerMs));
  }
  return view.remainingMs < FAST_BELOW_MS ? FAST_TICK_MS : SLOW_TICK_MS;
}

export function useClock(slot: ActiveSlotLike | null, serverNow: number, serverOffsetMs: number): ClockView | null {
  // null until mounted: render from the snapshot's clock.
  const [now, setNow] = useState<number | null>(null);
  const effectiveNow = now ?? serverNow;
  const view = computeClock(slot, effectiveNow);
  const delay = clockTickMs(view, effectiveNow);
  // The slot timing the last tick ran for (by value, so an unstable object reference cannot spin the
  // tick); null while no tick runs (paused, expired, no slot).
  const slotKey = slot
    ? `${slot.deadline_at}|${slot.remaining_ms_at_pause}|${slot.duration_ms}|${slot.extensions_applied_ms}|${
        slot.quiet_hours ? `${slot.quiet_hours.startHour}-${slot.quiet_hours.endHour}@${slot.quiet_hours.timeZone}` : ''
      }`
    : null;
  const tickedKey = useRef<string | null>(null);

  useEffect(() => {
    if (delay === null) {
      tickedKey.current = null;
      return;
    }
    // Tick at once on mount, on a resume and when the slot timing changes, so the display never
    // waits a full interval with a stale "now"; afterwards at the regular cadence.
    const immediate = now === null || tickedKey.current !== slotKey;
    tickedKey.current = slotKey;
    const id = setTimeout(() => setNow(Date.now() + serverOffsetMs), immediate ? 0 : delay);
    return () => clearTimeout(id);
  }, [delay, now, serverOffsetMs, slotKey]);

  return view;
}
