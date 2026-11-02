/** Longest wait a run of failures backs off to (a caster-chosen base interval above it is kept). */
export const MAX_POLL_BACKOFF_MS = 30_000;

/** Longest `Retry-After` an overlay honours, so a bad header cannot park it for good. */
export const MAX_RETRY_AFTER_MS = 120_000;

export interface PollTickResult {
  ok: boolean;
  /** The server's `Retry-After`, when it sent one. */
  retryAfterMs?: number | null;
}

/** `Retry-After` in whole seconds (what the broadcast routes send); an HTTP date or junk is ignored. */
export function parseRetryAfterMs(value: string | null | undefined): number | null {
  const text = value?.trim();
  if (!text || !/^\d+$/.test(text)) return null;
  return Number(text) * 1000;
}

/**
 * The wait before the next poll: the base interval while polls succeed, else
 * doubling per consecutive failure up to {@link MAX_POLL_BACKOFF_MS}, and never
 * shorter than the server's `Retry-After` (bounded by {@link MAX_RETRY_AFTER_MS}).
 */
export function nextPollDelayMs(baseMs: number, failures: number, retryAfterMs: number | null | undefined): number {
  if (failures <= 0) return baseMs;
  const backoff = Math.max(baseMs, Math.min(baseMs * 2 ** Math.min(failures, 16), MAX_POLL_BACKOFF_MS));
  return Math.min(Math.max(backoff, retryAfterMs ?? 0), Math.max(MAX_RETRY_AFTER_MS, baseMs));
}

/** The outcome of a poll that got a response: 2xx is ok; a 429's `Retry-After` slows the next poll. */
export function pollResultFromResponse(res: Pick<Response, 'ok' | 'headers'>): PollTickResult {
  if (res.ok) return { ok: true };
  return { ok: false, retryAfterMs: parseRetryAfterMs(res.headers.get('Retry-After')) };
}
