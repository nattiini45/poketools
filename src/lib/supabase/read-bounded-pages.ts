/**
 * Complete reads under PostgREST `max_rows` with a hard bound (AGENTS: reads stay complete).
 *
 * `readBoundedPages` walks `.range()` pages of an ordered query. Unlike `readAllPages` it ends on
 * the first page shorter than `POSTGREST_PAGE_SIZE`, so a result of 1,000 rows or fewer costs ONE
 * request (the same shape as `getMatchesByTournament`), and it stops after `maxPages` full pages,
 * logging what was not read. It assumes the server answers full pages of 1,000 rows
 * (`supabase/config.toml` `max_rows`); use `readAllPages` when that cannot be assumed. Errors
 * propagate unchanged and no partial rows are returned.
 */
import { POSTGREST_PAGE_SIZE } from './read-all-pages';

/** Pages read before the bound applies: 20 pages of 1,000 rows. */
export const DEFAULT_MAX_BOUNDED_PAGES = 20;

export interface BoundedPagesOptions {
  /** Names the caller in the bound warning. */
  label: string;
  /** Full pages read before the read stops (default `DEFAULT_MAX_BOUNDED_PAGES`). */
  maxPages?: number;
}

export interface BoundedPagesResult<T> {
  rows: T[];
  /** True when the bound was reached and later rows were not read. */
  truncated: boolean;
}

/**
 * `page(from, to)` must build the query with a stable total `.order()` ending in a unique column
 * (for example `id`) and end in `.range(from, to)`; pass the query builder itself (it is
 * `PromiseLike`), do not await inside the callback.
 */
export async function readBoundedPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  options: BoundedPagesOptions,
): Promise<BoundedPagesResult<T>> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_BOUNDED_PAGES;
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new RangeError(`readBoundedPages: maxPages must be an integer of at least 1, got ${String(maxPages)}`);
  }

  const rows: T[] = [];
  for (let index = 0; index < maxPages; index++) {
    const from = index * POSTGREST_PAGE_SIZE;
    const { data, error } = await page(from, from + POSTGREST_PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < POSTGREST_PAGE_SIZE) return { rows, truncated: false };
  }

  console.warn(
    `[read-bounded-pages] ${options.label}: reached the ${maxPages * POSTGREST_PAGE_SIZE}-row bound; later rows are not read`,
  );
  return { rows, truncated: true };
}
