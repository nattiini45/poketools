// Type-only import: this file stays dependency-free at runtime.
import type { ApiErrorCode, ApiErrorParams } from '@/i18n/messages/errors';

export interface UserFacingErrorOptions<C extends ApiErrorCode = ApiErrorCode> {
  /**
   * Machine-readable code so clients can branch on a specific failure and
   * render it in the viewer's language. Must be a key of an error catalog
   * under `src/i18n/messages/errors/` (i18n-core §4.1).
   */
  code?: C;
  /** Values for the catalog message's `{placeholders}` (English @pkmn names for Pokémon params). */
  params?: ApiErrorParams<C>;
  /** HTTP status for the response. Defaults to 400. */
  status?: number;
}

/**
 * Base class for domain errors whose `message` is safe to show to clients
 * verbatim (no internals). `safeErrorResponse()` passes these through instead
 * of collapsing them to a static fallback — extend this for any new domain
 * error instead of hand-rolling a NextResponse in the route.
 *
 * The `message` stays English (the log line and the client fallback); `code`
 * and `params` let the client translate it. Subclasses pass everything
 * through `super` and do not redeclare `code` or `params`.
 *
 * Kept dependency-free so `error-response.ts` stays light enough for use in
 * public routes (no next-auth in the import chain).
 */
export class UserFacingError<C extends ApiErrorCode = ApiErrorCode> extends Error {
  readonly code?: C;
  /**
   * Checked against `C` in the constructor options; stored as a plain record
   * so an error with one literal code stays assignable to `UserFacingError`
   * (a conditional field type would make the class invariant in `C`).
   */
  readonly params?: Readonly<Record<string, string | number>>;
  readonly statusCode: number;

  constructor(message: string, opts: UserFacingErrorOptions<C> = {}) {
    super(message);
    this.name = 'UserFacingError';
    this.code = opts.code;
    this.params = opts.params;
    this.statusCode = opts.status ?? 400;
  }
}
