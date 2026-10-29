/**
 * Maps what a dispatched route answered to a typed `Outcome` (plan 3.3, "Typed outcomes (no masking)").
 *
 * The repo's error shape is `ApiError` (`src/types/api.ts`): `{ success: false, error, code?, params? }`, written by
 * `safeErrorResponse` (`UserFacingError` and `AuthError` pass through with their status and code; a Supabase deadline is
 * 504 `upstream_timeout`; everything else is the route's static fallback at 500, with a `code` only when the route
 * passes `fallbackCode`), by `rateLimitedResponse` (429 plus `Retry-After`) and by routes that build the JSON by hand.
 *
 * What reaches the model is a catalogued `code` plus `params`, never `error`: the English `error` text is read only
 * for the issue list of a validation failure (zod messages the route formats itself). A `code` that is not a key of an
 * error catalog is replaced by the default of its outcome kind, so an unexpected string cannot travel on.
 */
import { ERROR_CATALOGS } from '@/i18n/messages/errors';
import { stripHiddenChars } from '@/lib/utils/hidden-text';
import type { HarnessErrorCode, HarnessErrorReason, Outcome, OutcomeError } from './types';

/** The parsed pieces of a response; `body` is `undefined` when it was empty or not JSON. */
export interface RouteResponseParts {
  readonly status: number;
  readonly body: unknown;
  /** The raw `Retry-After` header, if any. */
  readonly retryAfter?: string | null;
}

/** A code that marks a state lock (`PHASE_COMPLETED_LOCKED`, `ruleset_pin_locked`, `format_published_locked`). */
export const LOCK_CODE = /(^|_)locked(_|$)/i;
const CODE_SHAPE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
// Control characters, DEL and C1, and the hidden characters of `src/lib/utils/hidden-text.ts` (bidi, zero-width, tag characters,
// variation selectors), become spaces.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
// The loop's harness-event marker: route text that reaches the model cannot imitate it (plan 6.3).
const HARNESS_MARKER = /harness[\s_-]*event/giu;

const MAX_ISSUES_CHARS = 1000;
const MAX_PARAM_KEYS = 20;
const MAX_PARAM_CHARS = 200;
const FALLBACK_RETRY_AFTER_SECONDS = 60;

let catalogCodes: ReadonlySet<string> | null = null;

/** True when `code` is a key of an error catalog under `src/i18n/messages/errors/`. */
export function isCatalogCode(code: unknown): code is string {
  if (typeof code !== 'string' || !CODE_SHAPE.test(code)) return false;
  if (catalogCodes === null) {
    const all = new Set<string>();
    for (const catalog of Object.values(ERROR_CATALOGS)) for (const key of Object.keys(catalog.en)) all.add(key);
    catalogCodes = all;
  }
  return catalogCodes.has(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clean(text: string, max: number): string {
  return stripHiddenChars(text, ' ').replace(CONTROL_CHARS, ' ').replace(HARNESS_MARKER, 'harness event').trim().slice(0, max);
}

/** The route's `code` when it is catalogued, else `fallback`. */
function codeOf(body: unknown, fallback: string): string {
  const code = isRecord(body) ? body.code : undefined;
  return isCatalogCode(code) ? code : fallback;
}

/** String and number params only, bounded, control characters stripped; `undefined` when none are left. */
function paramsOf(body: unknown): Readonly<Record<string, string | number>> | undefined {
  const raw = isRecord(body) ? body.params : undefined;
  if (!isRecord(raw)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_PARAM_KEYS) break;
    if (!CODE_SHAPE.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string') out[key] = clean(value, MAX_PARAM_CHARS);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function errorOf(status: number, body: unknown, fallbackCode: string): OutcomeError {
  const params = paramsOf(body);
  return { httpStatus: status, code: codeOf(body, fallbackCode), ...(params ? { params } : {}) };
}

/** The issue list of a validation failure: `params.issues` (what `validation_failed` carries), else `error`. */
function issuesOf(body: unknown): string {
  if (isRecord(body)) {
    const params = isRecord(body.params) ? body.params : undefined;
    if (typeof params?.issues === 'string') return clean(params.issues, MAX_ISSUES_CHARS);
    if (typeof body.error === 'string') return clean(body.error, MAX_ISSUES_CHARS);
  }
  return '';
}

function retryAfterSeconds(parts: RouteResponseParts): number {
  const header = parts.retryAfter?.trim();
  if (header && /^\d{1,7}$/.test(header)) return Math.max(Number(header), 1);
  const seconds = isRecord(parts.body) && isRecord(parts.body.params) ? parts.body.params.seconds : undefined;
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) return Math.max(Math.ceil(seconds), 1);
  return FALLBACK_RETRY_AFTER_SECONDS;
}

/** The result of a call the harness could not make or finish; `write` says whether the route could have committed. */
export function harnessError(
  reason: HarnessErrorReason,
  options: { code?: HarnessErrorCode; httpStatus?: number | null; write: boolean; ran: boolean },
): Outcome {
  const unknownOutcome = options.ran && options.write;
  const timeoutCode: HarnessErrorCode = unknownOutcome ? 'unknown_outcome' : 'upstream_timeout';
  const code = options.code ?? (reason === 'step_timeout' ? timeoutCode : 'agent_harness_error');
  return { kind: 'harness_error', httpStatus: options.httpStatus ?? null, code, reason, unknownOutcome };
}

/**
 * Maps a route response to an `Outcome`. `write` is true for any method but GET: only then can a masked 500, a 504 or an
 * unexpected answer leave the outcome unknown.
 *
 * Order of the 4xx rules: 401, 429, a lock (status 423, or a `*_locked` code on a 400, 403, 409 or 422), 403, 404 and
 * 410, 409, then the validation family (400, 413, 415, 422). A lock code wins over the status because routes answer
 * their locks with 403 (`ruleset_published_locked`) and 409 (`ruleset_pin_locked`, `PHASE_COMPLETED_LOCKED`) alike.
 * A 503 `rate_limit_unavailable` (a limiter that failed closed before anything ran) is `rate_limited`; any other 5xx but
 * 504 is `masked_server_error`.
 */
export function mapRouteResponse(parts: RouteResponseParts, options: { write: boolean }): Outcome {
  const { status, body } = parts;
  const { write } = options;

  if (status >= 200 && status < 300) {
    const data = isRecord(body) && 'data' in body ? body.data : body;
    return { kind: 'ok', httpStatus: status, data, body };
  }
  if (status >= 300 && status < 400) return harnessError('unexpected_status', { httpStatus: status, write, ran: true });

  if (status >= 400 && status < 500) {
    const rawCode = isRecord(body) ? body.code : undefined;
    if (status === 401) return { kind: 'unauthenticated', httpStatus: 401, code: 'unauthenticated', sessionExpired: false };
    if (status === 429) {
      return { kind: 'rate_limited', httpStatus: 429, code: 'rate_limited', retryAfterSeconds: retryAfterSeconds(parts) };
    }
    const locked = status === 423 || (typeof rawCode === 'string' && LOCK_CODE.test(rawCode) && [400, 403, 409, 422].includes(status));
    if (locked) return { kind: 'locked', ...errorOf(status, body, 'step_failed') };
    if (status === 403) return { kind: 'forbidden', ...errorOf(status, body, 'forbidden') };
    if (status === 404 || status === 410) return { kind: 'not_found', ...errorOf(status, body, 'not_found_generic') };
    if (status === 409) return { kind: 'conflict', ...errorOf(status, body, 'step_failed') };
    if (status === 400 || status === 413 || status === 415 || status === 422) {
      return { kind: 'validation', issues: issuesOf(body), ...errorOf(status, body, 'validation_failed') };
    }
    // 402, 405, 406, 408, ...: no route of the registry answers these; the call was rejected, so nothing was written.
    return harnessError('unexpected_status', { httpStatus: status, write, ran: false });
  }

  if (status === 503 && isRecord(body) && body.code === 'rate_limit_unavailable') {
    return { kind: 'rate_limited', httpStatus: 503, code: 'rate_limit_unavailable', retryAfterSeconds: retryAfterSeconds(parts) };
  }
  if (status === 504) {
    return { kind: 'upstream_timeout', httpStatus: 504, code: 'upstream_timeout', unknownOutcome: write };
  }
  if (status >= 500 && status < 600) {
    return { kind: 'masked_server_error', unknownOutcome: write, ...errorOf(status, body, write ? 'unknown_outcome' : 'unknown_error') };
  }
  return harnessError('unexpected_status', { httpStatus: status, write, ran: true });
}

/** Parses a response body as JSON; empty or invalid text is `undefined`. */
export function parseBody(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** True when the step may have committed and must be verified, never retried (plan 3.3). */
export function isUnknownOutcome(outcome: Outcome): boolean {
  switch (outcome.kind) {
    case 'upstream_timeout':
    case 'masked_server_error':
    case 'harness_error':
      return outcome.unknownOutcome;
    default:
      return false;
  }
}

/** The catalogued code of a failed outcome, `null` for `ok`. A step that is `isUnknownOutcome` is `unknown_outcome`. */
export function outcomeCode(outcome: Outcome): string | null {
  if (outcome.kind === 'ok') return null;
  if (isUnknownOutcome(outcome)) return 'unknown_outcome';
  return outcome.code;
}
