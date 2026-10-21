/**
 * Request deadline for the server-side Supabase clients (code review H7).
 *
 * supabase-js routes PostgREST, GoTrue and Storage through one `global.fetch`,
 * and none of them sets a deadline: a stalled connection held the route until
 * undici's 300 s idle timeouts. Every request now carries
 * `AbortSignal.timeout`: 10 s for PostgREST and GoTrue (above the 8 s
 * `statement_timeout` the service role inherits, so a slow query still ends in
 * Postgres's own error first) and 30 s for Storage, whose bodies are binary
 * uploads and downloads. A caller's own signal (`.abortSignal()` on a query)
 * still works: the two are combined with `AbortSignal.any`.
 *
 * The deadline surfaces as a `SupabaseTimeoutError` naming the service, the
 * method, the path (never the query string) and the budget, whether it fires
 * before the response headers arrive or while the body is being read (the
 * body stream is re-wrapped so a mid-body abort is labelled the same way).
 * supabase-js does not throw it: it reports it in the call's `{ error }`
 * (PostgREST formats it as `SupabaseTimeoutError: …`), which the query layer
 * rethrows as usual.
 *
 * No retry here: a timed-out write may have committed, so retrying belongs to
 * a caller that knows the write is idempotent.
 */

export const SUPABASE_REQUEST_TIMEOUT_MS = 10_000;
export const SUPABASE_STORAGE_TIMEOUT_MS = 30_000;

export type SupabaseService = 'storage' | 'auth' | 'rest' | 'other';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class SupabaseTimeoutError extends Error {
  readonly service: SupabaseService;
  readonly timeoutMs: number;

  constructor(service: SupabaseService, method: string, path: string, timeoutMs: number, cause: unknown) {
    super(`Supabase ${service} request timed out after ${timeoutMs} ms: ${method} ${path}`, { cause });
    this.name = 'SupabaseTimeoutError';
    this.service = service;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * The message every `SupabaseTimeoutError` carries. supabase-js does not
 * rethrow the error object itself: PostgREST copies it into a plain
 * `{ message: 'SupabaseTimeoutError: …' }` error, GoTrue into an
 * `AuthRetryableFetchError` and Storage into a `StorageUnknownError` (whose
 * `originalError` is the timeout). The message is what all three keep.
 */
const TIMEOUT_MESSAGE = /\bSupabase (?:storage|auth|rest|other) request timed out after \d+ ms: /;

/** How deep `isSupabaseTimeoutError` follows `cause` / `originalError` links. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Whether `err` is a Supabase request deadline (a `SupabaseTimeoutError`, or
 * an error supabase-js or the query layer built from one): the instance
 * itself, a value whose `message` carries the deadline message, or one whose
 * `cause` / `originalError` chain leads to either. Used by
 * `safeErrorResponse` to answer 504 instead of a generic 500.
 */
export function isSupabaseTimeoutError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (current instanceof SupabaseTimeoutError) return true;
    if (typeof current !== 'object' || current === null) return false;
    const record = current as { message?: unknown; cause?: unknown; originalError?: unknown };
    if (typeof record.message === 'string' && TIMEOUT_MESSAGE.test(record.message)) return true;
    current = record.cause ?? record.originalError;
  }
  return false;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function parsePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '(unparseable url)';
  }
}

/** Which Supabase service a request URL targets, from its path prefix. */
export function supabaseService(url: string): SupabaseService {
  const path = parsePath(url);
  if (path.startsWith('/storage/v1/')) return 'storage';
  if (path.startsWith('/auth/v1/')) return 'auth';
  if (path.startsWith('/rest/v1/')) return 'rest';
  return 'other';
}

/** The deadline for a request URL: Storage gets the longer budget. */
export function supabaseTimeoutFor(url: string): number {
  return supabaseService(url) === 'storage' ? SUPABASE_STORAGE_TIMEOUT_MS : SUPABASE_REQUEST_TIMEOUT_MS;
}

export interface TimeoutFetchOptions {
  /** Overrides the per-service budget (tests). */
  timeoutMs?: number;
}

/** Statuses whose Response must not carry a body (`new Response(body, …)` throws for them). */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Re-wraps `res` so an error raised while its body is read goes through
 * `mapError`. Status, status text, headers and `url` are kept; the body bytes
 * pass through unchanged.
 */
function withMappedBodyErrors(res: Response, mapError: (err: unknown) => unknown): Response {
  if (res.body === null || NULL_BODY_STATUSES.has(res.status)) return res;
  const reader = res.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        controller.error(mapError(err));
        return;
      }
      if (chunk.done) controller.close();
      else controller.enqueue(chunk.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  const wrapped = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  Object.defineProperty(wrapped, 'url', { value: res.url });
  return wrapped;
}

/**
 * Wrap `inner` (default: the global `fetch`, looked up at call time so test
 * stubs apply) so every request carries a deadline.
 */
export function createTimeoutFetch(
  inner: FetchLike = (input, init) => fetch(input, init),
  options: TimeoutFetchOptions = {}
): FetchLike {
  return async (input, init) => {
    const url = requestUrl(input);
    const timeoutMs = options.timeoutMs ?? supabaseTimeoutFor(url);
    const deadline = AbortSignal.timeout(timeoutMs);
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;

    // Only the deadline becomes a SupabaseTimeoutError; a caller's abort and
    // every network or stream error propagate unchanged.
    const mapError = (err: unknown): unknown => {
      if (deadline.aborted && !callerSignal?.aborted) {
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        return new SupabaseTimeoutError(supabaseService(url), method, parsePath(url), timeoutMs, err);
      }
      return err;
    };

    let res: Response;
    try {
      res = await inner(input, { ...init, signal });
    } catch (err) {
      throw mapError(err);
    }
    return withMappedBodyErrors(res, mapError);
  };
}
