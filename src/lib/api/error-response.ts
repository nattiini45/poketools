import { NextResponse } from 'next/server';
import type { ApiErrorCode } from '@/i18n/messages/errors';
// The plain EN catalog object only (no define/runtime imports): keeps this helper light.
import commonErrors from '@/i18n/messages/errors/common/en';
import type { ApiResult, ExtensionErrorCode } from '@/types/api';
import { isSupabaseTimeoutError } from '@/lib/supabase/timeout-fetch';
import { logger } from '@/lib/logger';
import { UserFacingError } from './user-facing-error';

/** Response header that carries the id of a failed request; the matching server log line holds the same id. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** HTTP status for a Supabase request that hit its deadline (`timeout-fetch.ts`). */
export const SUPABASE_TIMEOUT_STATUS = 504;

/**
 * Duck-type check for AuthError (has `statusCode` property).
 * Avoids importing @/lib/auth/helpers which transitively pulls in next-auth,
 * keeping this helper dependency-light for use in public routes.
 */
function isAuthError(err: unknown): err is Error & { statusCode: number } {
  return (
    err instanceof Error &&
    'statusCode' in err &&
    typeof (err as Record<string, unknown>).statusCode === 'number'
  );
}

type CommonErrorCode = keyof typeof commonErrors & ApiErrorCode;

function isCommonErrorCode(code: unknown): code is CommonErrorCode {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(commonErrors, code);
}

/**
 * The `code` an AuthError carries (`AuthError.code`, an `errors/common` key).
 * Checked at runtime because the duck-typed error is not typed as AuthError;
 * anything that is not an `errors/common` key is dropped.
 */
function authErrorCode(err: Error & { code?: unknown }): CommonErrorCode | undefined {
  return isCommonErrorCode(err.code) ? err.code : undefined;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/** An incoming id is echoed into a header and a log line, so only a plain token is reused. */
function resolveRequestId(request: { headers: Headers } | undefined): string {
  const incoming = request?.headers.get(REQUEST_ID_HEADER);
  return incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
}

/**
 * Build a safe error response that never leaks internal details to clients.
 * UserFacingError and AuthError messages are user-facing by design and passed
 * through (UserFacingError additionally carries an optional `code` and
 * `params` and is logged server-side; AuthError carries an optional `code`).
 * All other errors are logged server-side and replaced with the static
 * fallback, plus `fallbackCode` when given: pass one only where the failure
 * is actionable for a user (i18n-core §4.1 rule 5).
 *
 * A Supabase request deadline (`SupabaseTimeoutError`, however supabase-js or
 * the query layer wrapped it) is its own cause: it answers 504 with the
 * catalogued `upstream_timeout` code and the route's fallback text, and is
 * logged with the original error, never folded into the generic 500.
 *
 * Every response carries an `x-request-id` header, and the server log line
 * (`logger.error('api', ...)`, field `requestId`) holds the same id, so a
 * support report that quotes the header leads straight to the log. A route
 * that passes its `request` has an incoming `x-request-id` reused (a malformed
 * one is replaced); otherwise a fresh UUID is issued.
 */
export function safeErrorResponse(
  err: unknown,
  fallback: string,
  status = 500,
  fallbackCode?: ApiErrorCode | ExtensionErrorCode,
  request?: { headers: Headers }
): NextResponse<ApiResult<never>> {
  const requestId = resolveRequestId(request);
  const headers = { [REQUEST_ID_HEADER]: requestId };
  // Must run before the AuthError duck-type check: UserFacingError also has a
  // numeric `statusCode`, so the duck-type would absorb it and drop `code`.
  if (err instanceof UserFacingError) {
    logger.error('api', fallback, { requestId, status: err.statusCode, error: err });
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: err.message, code: err.code, params: err.params },
      { status: err.statusCode, headers }
    );
  }
  if (isSupabaseTimeoutError(err)) {
    logger.error('api', `${fallback} (Supabase request deadline)`, { requestId, status: SUPABASE_TIMEOUT_STATUS, error: err });
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: fallback, code: 'upstream_timeout' },
      { status: SUPABASE_TIMEOUT_STATUS, headers }
    );
  }
  if (isAuthError(err)) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: err.message, code: authErrorCode(err) },
      { status: err.statusCode, headers }
    );
  }
  logger.error('api', fallback, { requestId, status, error: err });
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: fallback, code: fallbackCode },
    { status, headers }
  );
}