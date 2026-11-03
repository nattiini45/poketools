const FIRST_RETRY_MS = 2_000;
export const MAX_ERROR_RETRY_MS = 30_000;
/** A failure this long after the previous one starts a fresh back-off. */
const QUIET_RESET_MS = 120_000;

/** Delay before retry number `attempt` (0-based): 2 s, doubling, capped at 30 s. */
export function errorRetryDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  return Math.min(FIRST_RETRY_MS * 2 ** Math.min(n, 10), MAX_ERROR_RETRY_MS);
}

/**
 * Counts consecutive overlay failures. The error boundary's fallback unmounts
 * whenever `reset()` re-renders the page, so the count cannot live in component
 * state: a page that keeps throwing would retry every 2 s for ever.
 */
export function createErrorRetryTracker(now: () => number = () => Date.now()) {
  let attempt = 0;
  let lastAt = Number.NEGATIVE_INFINITY;
  return {
    /** Registers a failure and returns how long to wait before retrying. */
    nextDelayMs(): number {
      const at = now();
      if (at - lastAt > QUIET_RESET_MS) attempt = 0;
      lastAt = at;
      const delay = errorRetryDelayMs(attempt);
      attempt += 1;
      return delay;
    },
  };
}
