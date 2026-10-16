import { NextResponse } from 'next/server';
import type { ApiErrorCode } from '@/i18n/messages/errors';
// The plain EN catalog object only (no define/runtime imports): keeps this helper light.
import commonErrors from '@/i18n/messages/errors/common/en';
import type { ApiResult } from '@/types/api';
import { UserFacingError } from './user-facing-error';

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

/**
 * Build a safe error response that never leaks internal details to clients.
 * UserFacingError and AuthError messages are user-facing by design and passed
 * through (UserFacingError additionally carries an optional `code` and
 * `params` and is logged server-side; AuthError carries an optional `code`).
 * All other errors are logged server-side and replaced with the static
 * fallback, plus `fallbackCode` when given: pass one only where the failure
 * is actionable for a user (i18n-core §4.1 rule 5).
 */
export function safeErrorResponse(
  err: unknown,
  fallback: string,
  status = 500,
  fallbackCode?: ApiErrorCode
): NextResponse<ApiResult<never>> {
  // Must run before the AuthError duck-type check: UserFacingError also has a
  // numeric `statusCode`, so the duck-type would absorb it and drop `code`.
  if (err instanceof UserFacingError) {
    console.error(`[API] ${fallback}:`, err);
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: err.message, code: err.code, params: err.params },
      { status: err.statusCode }
    );
  }
  if (isAuthError(err)) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: err.message, code: authErrorCode(err) },
      { status: err.statusCode }
    );
  }
  console.error(`[API] ${fallback}:`, err);
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: fallback, code: fallbackCode },
    { status }
  );
}
