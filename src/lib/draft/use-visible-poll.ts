/**
 * Visibility-aware polling for the live draft screens (DATA-PLAN fix 2, D36/D37).
 *
 * - Polls every 3 s while the draft is live and the tab is visible.
 * - Pauses while `document.hidden`; refetches once on `visibilitychange` back
 *   to visible, then resumes the cadence. The initial fetch on mount runs even
 *   in a hidden tab, so the board has data the moment it is shown.
 * - Once a tick reports `'complete'`, slows to at least 60 s, or stops when the
 *   caller passes `completeIntervalMs: null`. A tab refocus still refetches once.
 * - A tick that reports `'stop'` (401/403) halts the poller; only an explicit
 *   `refresh()` revives it.
 *
 * Ticks are chained with setTimeout (never setInterval), so a slow request can
 * never overlap the next one. The scheduling core (`createVisiblePoller`) is
 * framework-free so it can be tested with fake timers; `useVisiblePoll` is the
 * thin React adapter the draft components use.
 */

import { useCallback, useEffect, useRef } from 'react';

/** What a tick tells the poller about the draft it just read. */
export type PollOutcome = 'live' | 'complete' | 'stop';

/** One poll. The signal aborts when the poller stops (unmount / key change). */
export type PollTick = (signal: AbortSignal) => Promise<PollOutcome | void>;

/** Cadence while a draft is live and the tab is visible (design decision D37). */
export const LIVE_POLL_INTERVAL_MS = 3_000;
/** Floor for the cadence once the draft is complete. */
export const COMPLETE_POLL_INTERVAL_MS = 60_000;

export interface VisiblePollOptions {
  /** Interval while live. Default {@link LIVE_POLL_INTERVAL_MS}. */
  liveIntervalMs?: number;
  /**
   * Interval once a tick reports `'complete'`. `null` stops scheduled polling
   * (a refocus or `refresh()` still fetches once). Values below
   * {@link COMPLETE_POLL_INTERVAL_MS} are raised to it.
   */
  completeIntervalMs?: number | null;
}

/** The slice of `document` the poller needs (injectable for tests). */
export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface PollTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface VisiblePollerEnv {
  /** `document` in the browser; `null` means "always visible". */
  visibility?: VisibilitySource | null;
  /** Defaults to the global timers (so vitest fake timers apply). */
  timers?: PollTimers;
}

export interface VisiblePoller {
  /** Fetch once now, then follow the cadence. */
  start(): void;
  /** Cancel the timer, drop the visibility listener and abort the tick signal. */
  stop(): void;
  /**
   * Fetch now (e.g. after a mutation) and reschedule from the result. Resolves
   * once a tick that started after this call has finished.
   */
  refresh(): Promise<void>;
}

/** Map a draft pool status onto a poll outcome. */
export function outcomeForPoolStatus(status: string): PollOutcome {
  return status === 'complete' ? 'complete' : 'live';
}

function resolveCompleteInterval(value: number | null | undefined): number | null {
  if (value === null) return null;
  return Math.max(COMPLETE_POLL_INTERVAL_MS, value ?? COMPLETE_POLL_INTERVAL_MS);
}

const globalTimers: PollTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export function createVisiblePoller(
  tick: PollTick,
  options: VisiblePollOptions = {},
  env: VisiblePollerEnv = {},
): VisiblePoller {
  const liveMs = options.liveIntervalMs ?? LIVE_POLL_INTERVAL_MS;
  const completeMs = resolveCompleteInterval(options.completeIntervalMs);
  const visibility = env.visibility ?? null;
  const timers = env.timers ?? globalTimers;

  let controller: AbortController | null = null;
  let timer: unknown = null;
  /** The running tick, tagged with the run (signal) that started it. */
  let inFlight: { signal: AbortSignal; promise: Promise<void> } | null = null;
  let rerun = false;
  let halted = false;
  let lastOutcome: PollOutcome = 'live';

  const isRunning = () => controller !== null && !controller.signal.aborted;
  const isHidden = () => visibility?.hidden === true;

  function clearTimer() {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  }

  function schedule() {
    clearTimer();
    if (!isRunning() || halted || isHidden()) return;
    const ms = lastOutcome === 'complete' ? completeMs : liveMs;
    if (ms === null) return;
    timer = timers.setTimeout(() => {
      timer = null;
      if (isHidden()) return;
      void runTick();
    }, ms);
  }

  function runTick(): Promise<void> {
    if (!isRunning()) return Promise.resolve();
    const signal = (controller as AbortController).signal;
    if (inFlight && inFlight.signal === signal) {
      // A tick is already running; run one more when it lands so a caller
      // that mutated state sees a read that started after its write.
      rerun = true;
      return inFlight.promise;
    }
    clearTimer();
    let settled = false;
    const promise = (async () => {
      let outcome: PollOutcome = 'live';
      try {
        outcome = (await tick(signal)) ?? 'live';
      } catch (err) {
        // Ticks own their error handling; a throw keeps the cadence alive.
        console.error('[use-visible-poll] tick threw:', err);
      } finally {
        settled = true;
        if (inFlight?.signal === signal) inFlight = null;
      }
      if (signal.aborted) return;
      lastOutcome = outcome;
      if (outcome === 'stop') {
        halted = true;
        rerun = false;
        clearTimer();
        return;
      }
      if (rerun) {
        rerun = false;
        await runTick();
        return;
      }
      schedule();
    })();
    // A tick that throws synchronously has already settled by now.
    if (!settled) inFlight = { signal, promise };
    return promise;
  }

  function onVisibilityChange() {
    if (!isRunning() || halted) return;
    if (isHidden()) {
      clearTimer();
      return;
    }
    void runTick();
  }

  return {
    start() {
      if (isRunning()) return;
      controller = new AbortController();
      halted = false;
      rerun = false;
      lastOutcome = 'live';
      visibility?.addEventListener('visibilitychange', onVisibilityChange);
      void runTick();
    },
    stop() {
      clearTimer();
      visibility?.removeEventListener('visibilitychange', onVisibilityChange);
      controller?.abort();
      rerun = false;
    },
    refresh() {
      if (!isRunning()) return Promise.resolve();
      halted = false;
      return runTick();
    },
  };
}

export interface UseVisiblePollOptions extends VisiblePollOptions {
  /** false: no polling at all. Default true. */
  enabled?: boolean;
  /** Restart the poller (with an immediate fetch) when this changes, e.g. the pool id. */
  resetKey?: string;
}

/**
 * React adapter for {@link createVisiblePoller}. The latest `tick` is always
 * used, so callers need not memoise it; change `resetKey` to restart.
 */
export function useVisiblePoll(
  tick: PollTick,
  options: UseVisiblePollOptions = {},
): { refresh: () => Promise<void> } {
  const {
    enabled = true,
    liveIntervalMs = LIVE_POLL_INTERVAL_MS,
    completeIntervalMs = COMPLETE_POLL_INTERVAL_MS,
    resetKey = '',
  } = options;

  const tickRef = useRef(tick);
  const pollerRef = useRef<VisiblePoller | null>(null);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useEffect(() => {
    if (!enabled) return;
    const poller = createVisiblePoller(
      (signal) => tickRef.current(signal),
      { liveIntervalMs, completeIntervalMs },
      { visibility: typeof document === 'undefined' ? null : document },
    );
    pollerRef.current = poller;
    poller.start();
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [enabled, liveIntervalMs, completeIntervalMs, resetKey]);

  const refresh = useCallback(() => pollerRef.current?.refresh() ?? Promise.resolve(), []);

  return { refresh };
}
