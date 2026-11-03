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
 *
 * `tick` receives an `AbortSignal` that fires when the key changes or the
 * overlay unmounts. A tick passes it to `fetch` and checks `signal.aborted`
 * after each `await`, before it commits state: a late answer for the previous
 * key must not replace the data of the current one.
 */
export function usePollLoop(
  key: string,
  baseMs: number,
  tick: (signal: AbortSignal) => Promise<PollTickResult | void>,
  enabled = true,
): void {
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const run = async () => {
      let result: PollTickResult;
      try {
        result = (await tickRef.current(signal)) ?? { ok: true };
      } catch {
        result = { ok: false };
      }
      if (signal.aborted) return;
      failures = result.ok ? 0 : failures + 1;
      timer = setTimeout(run, nextPollDelayMs(baseMs, failures, result.retryAfterMs));
    };
    void run();

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, baseMs, enabled]);
}
