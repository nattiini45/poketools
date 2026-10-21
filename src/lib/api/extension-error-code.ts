import type { ExtensionErrorCode } from '@/types/api';

/**
 * Brand an error code of a pack extension's own routes (docs/format-packs.md, "Pack extensions").
 * Client-safe and pure.
 *
 * Public routes send `ApiErrorCode`s from the catalogs under `src/i18n/messages/errors/`. An
 * extension's routes ship their own catalog instead (its client components render it with
 * `useApiErrorText(theirCatalog)`), so their codes are not `ApiErrorCode`s. The extension keeps
 * its codes in one table built with this function and tests that every entry is a key of its
 * catalog; route bodies use the table (`code: CODES.x`), never a string literal.
 */
export function extensionErrorCode<const K extends string>(code: K): K & ExtensionErrorCode {
  if (!/^[a-z0-9_]+$/.test(code)) {
    throw new Error(`[pack-extensions] error code "${code}" must be snake_case ([a-z0-9_]+)`);
  }
  return code as K & ExtensionErrorCode;
}
