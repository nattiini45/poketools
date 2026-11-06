/**
 * The studios' request layer: one `request` function that every per-route function of the Format Studio and the Ruleset
 * Studio is a one-liner over, each with an injectable `fetch` so the tests run without a network. Client-safe: types and
 * plain code only, no server module.
 *
 * The error shape is `ApiErrorLike` (a type import only): `@/i18n/api-errors` itself reaches the format pack and so zod
 * in a static import walk, which the editor-core closure test forbids. The body is read here with the same rules instead.
 *
 * `request` resolves to an `ApiOutcome` and never throws: a failed response gives the server's `code` and `params` (the UI
 * renders them with `useApiErrorText`), a request that never reached the server gives `network_error` with status 0.
 * There are no retries here (the UI decides) and a body is never logged. Callers URL-encode every path segment.
 *
 * `makeClassifier` sorts an error into the class the UI reacts to (conflict dialog, retry hint, sign-in prompt, ...). Each
 * studio supplies the class of every one of its own codes; the codes every route can answer with are known here.
 */
import type { ApiErrorLike } from '@/i18n/api-errors';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * `E` is the error shape of a route that answers with more than `{ error, code, params }` (a validation list, say); the
 * default is the plain `ApiErrorLike`. A route's own members come from its `extras` hook (see `request`).
 */
export type ApiOutcome<T, E extends ApiErrorLike = ApiErrorLike> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: E };

/**
 * Reads the route-specific members of a failed response body (`body.issues`, say) and returns only the ones that have
 * the right type. It runs on a body of any shape, so it must check what it reads. It never overrides `error`, `code` or
 * `params`: those come from the shared reader.
 */
export type ErrorExtras<E extends ApiErrorLike = ApiErrorLike> = (body: unknown) => Partial<E>;

function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

interface Envelope {
  success?: unknown;
  data?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `error`, `code` and `params` members of an API error body that have the right type (as `toApiErrorLike`). */
function baseErrorLikeOf(body: unknown): ApiErrorLike {
  if (!isRecord(body)) return {};
  const out: ApiErrorLike = {};
  if (typeof body.error === 'string') out.error = body.error;
  if (typeof body.code === 'string') out.code = body.code;
  if (isRecord(body.params)) {
    const params: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(body.params)) {
      if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) params[name] = value;
    }
    out.params = params;
  }
  return out.error !== undefined || out.code !== undefined ? out : {};
}

/**
 * The `error`, `code` and `params` members of an API error body that have the right type. An optional `extras` hook adds
 * the route's own members to the result (it can never replace the three shared ones).
 */
export function errorLikeOf<E extends ApiErrorLike = ApiErrorLike>(body: unknown, extras?: ErrorExtras<E>): E {
  const base = baseErrorLikeOf(body);
  return (extras === undefined ? base : { ...extras(body), ...base }) as E;
}

/**
 * The error of a failed response: the server's code and params, else a code derived from the status. The `extras`
 * members of the body (see `errorLikeOf`) are kept on every branch.
 */
export function failureOf<E extends ApiErrorLike = ApiErrorLike>(response: Response, body: unknown, extras?: ErrorExtras<E>): E {
  const parsed = errorLikeOf<E>(body, extras);
  if (parsed.code !== undefined && parsed.code !== null) return parsed;
  if (response.status === 401) return { ...parsed, code: 'unauthenticated' };
  if (response.status === 429) {
    const header = response.headers?.get('retry-after');
    const seconds = header === null || header === undefined || header.trim() === '' ? Number.NaN : Number(header);
    return Number.isFinite(seconds) && seconds >= 0
      ? { ...parsed, code: 'rate_limited', params: { seconds } }
      : { ...parsed, code: 'rate_limited' };
  }
  return { ...parsed, code: 'unknown_error' };
}

/**
 * Sends one request. `extras` (optional, last) reads the route's own members of a failed body into the error, for the
 * routes whose failures carry more than a code (for example a list of validation issues); a success never calls it.
 */
export async function request<T, E extends ApiErrorLike = ApiErrorLike>(
  f: FetchLike | undefined,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  extras?: ErrorExtras<E>,
): Promise<ApiOutcome<T, E>> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await (f ?? defaultFetch)(path, init);
  } catch {
    return { ok: false, status: 0, error: { code: 'network_error' } as E };
  }
  const parsed: unknown = await response.json().catch(() => null);
  if (response.ok && isRecord(parsed) && (parsed as Envelope).success === true) {
    return { ok: true, data: (parsed as Envelope).data as T };
  }
  return { ok: false, status: response.status, error: failureOf<E>(response, parsed, extras) };
}

// ─── Error classes ───────────────────────────────────────────────────────────────────────────────

export type ApiErrorKind =
  | 'stale_revision'
  | 'rate_limited'
  | 'too_large'
  | 'forbidden'
  | 'unauthenticated'
  | 'not_found'
  | 'invalid'
  | 'blocked'
  /** A concurrent change got in the way of a request that was valid when the page was read: refresh, then retry. */
  | 'conflict'
  | 'network'
  | 'other';

export interface ClassifiedError {
  kind: ApiErrorKind;
  /** The revision the server holds (`stale_revision`). */
  staleRev?: number;
  /** Seconds until the next request is allowed (`rate_limited`). */
  retryAfter?: number;
}

/** Codes any studio route can answer with, whatever the studio. */
const COMMON_CODE_KINDS: Readonly<Record<string, ApiErrorKind>> = {
  rate_limited: 'rate_limited',
  validation_failed: 'invalid',
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  network_error: 'network',
};

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function numberParam(error: ApiErrorLike, name: string): number | undefined {
  const value = error.params?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export interface ClassifierOptions {
  /** The class of every code of the studio (a `Record` over its code union makes a new code a type error until classified). */
  codeKinds: Readonly<Record<string, ApiErrorKind>>;
  /** The studio's stale-revision code; its `draft_rev` param is the revision the server holds. */
  staleRevisionCode: string;
}

/** Builds the `classifyApiError` of a studio. */
export function makeClassifier({ codeKinds, staleRevisionCode }: ClassifierOptions): (error: ApiErrorLike, status?: number) => ClassifiedError {
  return (error, status) => {
    const code = error.code ?? undefined;
    if (code === staleRevisionCode) {
      const staleRev = numberParam(error, 'draft_rev');
      return staleRev === undefined ? { kind: 'stale_revision' } : { kind: 'stale_revision', staleRev };
    }
    if (code === 'rate_limited' || (code === undefined && status === 429)) {
      const retryAfter = numberParam(error, 'seconds');
      return retryAfter === undefined ? { kind: 'rate_limited' } : { kind: 'rate_limited', retryAfter };
    }
    if (code !== undefined) {
      if (hasOwn(codeKinds, code)) return { kind: codeKinds[code] };
      if (hasOwn(COMMON_CODE_KINDS, code)) return { kind: COMMON_CODE_KINDS[code] };
    }
    if (status === 401) return { kind: 'unauthenticated' };
    if (status === 0) return { kind: 'network' };
    return { kind: 'other' };
  };
}
