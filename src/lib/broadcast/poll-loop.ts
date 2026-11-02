'use client';

import { useEffect, useRef } from 'react';
import { nextPollDelayMs, type PollTickResult } from './poll-schedule';

/**
 * Poll loop of the overlays: `tick` runs at once, then again after
 * {@link nextPollDelayMs}. Ticks chain on `setTimeout`, so they never overlap
 * and a failure (a thrown tick, `{ ok: false }`, a 429's `Retry-After`) really
 * lengthens the next wait, where a `setInterval` created once could not. The
 * overlay keeps whatever data it last showed; `tick` decides that.
 *
 * `key` identifies what is polled (a match id, a URL): a new key restarts the
 * loop. `tick` itself may change on every render; the latest one runs.
 */
export function usePollLoop(
  key: string,
  baseMs: number,
  tick: () => Promise<PollTickResult | void>,
  enabled = true,
): void {
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const run = async () => {
      let result: PollTickResult;
      try {
        result = (await tickRef.current()) ?? { ok: true };
      } catch {
        result = { ok: false };
      }
      if (cancelled) return;
      failures = result.ok ? 0 : failures + 1;
      timer = setTimeout(run, nextPollDelayMs(baseMs, failures, result.retryAfterMs));
    };
    void run();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, baseMs, enabled]);
}
