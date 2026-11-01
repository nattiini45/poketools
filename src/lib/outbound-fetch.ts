/**
 * `fetch` for requests to a third-party API that carry a secret or a stored,
 * admin-supplied target: it follows no redirect and gives up after a deadline.
 *
 * A 3xx is a failure (`redirect: 'error'` throws a `TypeError`), so a response
 * cannot bounce a bearer token or app password to another host, and a hung
 * peer cannot hold the request open. A timeout surfaces as a `TimeoutError`.
 * Callers log `err.name` or their own message, never the URL, and never an
 * upstream response body: a third party (or a self-hosted PDS) can echo the
 * handle, app password or webhook URL it was sent back in an error text.
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

/**
 * A non-2xx answer from a provider. Carries the provider, the step and the
 * HTTP status only: the response body is third-party text and stays out of the
 * message, so the message is safe to throw, return and log as it is.
 */
export class OutboundHttpError extends Error {
  readonly provider: string;
  readonly operation: string;
  readonly status: number;

  constructor(provider: string, operation: string, status: number) {
    super(`[${provider}] ${operation} failed: ${status}`);
    this.name = 'OutboundHttpError';
    this.provider = provider;
    this.operation = operation;
    this.status = status;
  }
}

/** Builds the error for a failed response and discards its body unread so the connection is released. */
export async function outboundHttpError(
  provider: string,
  operation: string,
  response: Pick<Response, 'status'> & { body?: Response['body'] },
): Promise<OutboundHttpError> {
  await response.body?.cancel().catch(() => undefined);
  return new OutboundHttpError(provider, operation, response.status);
}