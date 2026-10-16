/**
 * Pagination parsing helper for list API routes.
 *
 * Centralises the repeated `parseInt(searchParams.get('limit'))` +
 * bounds-clamp + `search` extraction pattern. Enforces a hard ceiling
 * (`MAX_PAGE_LIMIT`) so a malicious `?limit=1000000` cannot blow up a query.
 */

export const MAX_PAGE_LIMIT = 200;
export const DEFAULT_PAGE_LIMIT = 50;

export interface ParsedPagination {
  limit: number;
  offset: number;
  search: string | undefined;
}

/**
 * Parse `limit`, `offset`, and `search` from a URLSearchParams.
 *
 * - `limit` defaults to `DEFAULT_PAGE_LIMIT`, clamped to `[1, MAX_PAGE_LIMIT]`.
 * - `offset` defaults to `0`, clamped to `>= 0`.
 * - `search` is trimmed; empty/whitespace becomes `undefined`.
 */
export function parsePagination(
  sp: URLSearchParams,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): ParsedPagination {
  const defaultLimit = opts.defaultLimit ?? DEFAULT_PAGE_LIMIT;
  const maxLimit = opts.maxLimit ?? MAX_PAGE_LIMIT;

  // Numeric input is clamped into [1, maxLimit] (limit=0 means 1 row, not
  // "use the default"); absent/non-numeric input falls back to the default.
  const rawLimit = Number.parseInt(sp.get('limit') ?? '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), maxLimit)
    : defaultLimit;

  const rawOffset = Number.parseInt(sp.get('offset') ?? '', 10);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const rawSearch = sp.get('search')?.trim();
  const search = rawSearch && rawSearch.length > 0 ? rawSearch : undefined;

  return { limit, offset, search };
}