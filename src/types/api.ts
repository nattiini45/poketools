import type { ApiErrorCode } from '@/i18n/messages/errors';
import type { ActionIssue } from '@/lib/format-engine/runtime/actions';
import type { TeamValidationResult } from '@/types/team';

/**
 * An error code of a pack extension's own routes (docs/format-packs.md, "Pack extensions").
 * Its message lives in the extension's own catalog, which the extension's client components pass
 * to `useApiErrorText`; it is not an `ApiErrorCode`. Made only by `extensionErrorCode()`
 * (`src/lib/api/extension-error-code.ts`), so a public route cannot send an arbitrary string.
 */
export type ExtensionErrorCode = string & { readonly __extensionErrorCode: true };

/** A notice about a write that succeeded (the client words it from the code, like an error code). */
export interface ApiWarning {
  code: string;
  params?: Record<string, string | number>;
}

/**
 * What a team write tells the editor about the rules of a kit league. Absent when the league has no team rules or the
 * team meets them. `unmet` carries the whole verdict (rendered by code); `unavailable` means the verdict could not be
 * computed, which is never the same as "meets the rules". The write itself has succeeded either way.
 */
export type TeamCheckAdvisory = { status: 'unmet'; verdict: TeamValidationResult } | { status: 'unavailable' };

export interface ApiResponse<T> {
  success: true;
  data: T;
  /** Notices about the write (for example a Swiss round that could not avoid every rematch). */
  warnings?: ApiWarning[];
  /** The league-rules advisory of a team write in a kit league (POST /api/teams, PATCH /api/teams/[id], POST /api/match-prep). */
  team_check?: TeamCheckAdvisory;
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
  /** The problems of a rejected action submission when code is `format_action_invalid` (codes, step indexes and item ids the actor sent; nothing else). */
  issues?: ActionIssue[];
}

export type ApiResult<T> = ApiResponse<T> | ApiError;
