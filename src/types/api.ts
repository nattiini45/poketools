import type { ApiErrorCode } from '@/i18n/messages/errors';

/**
 * An error code of a pack extension's own routes (docs/format-packs.md, "Pack extensions").
 * Its message lives in the extension's own catalog, which the extension's client components pass
 * to `useApiErrorText`; it is not an `ApiErrorCode`. Made only by `extensionErrorCode()`
 * (`src/lib/api/extension-error-code.ts`), so a public route cannot send an arbitrary string.
 */
export type ExtensionErrorCode = string & { readonly __extensionErrorCode: true };

export interface ApiResponse<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  /** English message: the log line and the client's fallback text. */
  error: string;
  details?: string;
  /**
   * Machine-readable code so clients can branch on a specific failure (e.g.
   * 'name_mismatch') and render it in the viewer's language. A key of an
   * error catalog under `src/i18n/messages/errors/` (i18n-core §4.1).
   */
  code?: ApiErrorCode | ExtensionErrorCode;
  /** Values for the catalog message's `{placeholders}`. */
  params?: Record<string, string | number>;
  /** Parsed Showdown usernames when code is `name_mismatch`. */
  ps_usernames?: string[];
}

export type ApiResult<T> = ApiResponse<T> | ApiError;
