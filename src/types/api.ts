import type { ApiErrorCode } from '@/i18n/messages/errors';

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
  code?: ApiErrorCode;
  /** Values for the catalog message's `{placeholders}`. */
  params?: Record<string, string | number>;
  /** Parsed Showdown usernames when code is `name_mismatch`. */
  ps_usernames?: string[];
}

export type ApiResult<T> = ApiResponse<T> | ApiError;
