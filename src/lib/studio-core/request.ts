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

export type ApiOutcome<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiErrorLike };

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
export function errorLikeOf(body: unknown): ApiErrorLike {
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

/** The error of a failed response: the server's code and params, else a code derived from the status. */
export function failureOf(response: Response, body: unknown): ApiErrorLike {
  const parsed = errorLikeOf(body);
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

export async function request<T>(
  f: FetchLike | undefined,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiOutcome<T>> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await (f ?? defaultFetch)(path, init);
  } catch {
    return { ok: false, status: 0, error: { code: 'network_error' } };
  }
  const parsed: unknown = await response.json().catch(() => null);
  if (response.ok && isRecord(parsed) && (parsed as Envelope).success === true) {
    return { ok: true, data: (parsed as Envelope).data as T };
  }
  return { ok: false, status: response.status, error: failureOf(response, parsed) };
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
