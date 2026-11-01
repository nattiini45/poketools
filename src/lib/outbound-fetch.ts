/**
 * `fetch` for requests to a third-party API that carry a secret or a stored,
 * admin-supplied target: it follows no redirect and gives up after a deadline.
 *
 * A 3xx is a failure (`redirect: 'error'` throws a `TypeError`), so a response
 * cannot bounce a bearer token or app password to another host, and a hung
 * peer cannot hold the request open. A timeout surfaces as a `TimeoutError`.
 * Callers log `err.name` or their own message, never the URL.
 */

/** Discord webhooks: small JSON or one image, and an admin may be waiting. */
export const DISCORD_TIMEOUT_MS = 8_000;
/** Social providers: a media upload plus the post. */
export const SOCIAL_TIMEOUT_MS = 10_000;

export function outboundFetch(
  url: string,
  init: Omit<RequestInit, 'redirect' | 'signal'>,
  timeoutMs: number,
): Promise<Response> {
  return fetch(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** An upstream error body trimmed for a log line: it is third-party text, so it is capped. */
export function logSnippet(body: string, max = 200): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
