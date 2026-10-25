import { POSTGREST_PAGE_SIZE } from '@/lib/supabase/read-all-pages';

/**
 * Bounded paged read for the admin exports. A single `select().limit(n)` is cut by PostgREST
 * `max_rows` without any signal, so an export asked for 5,000 rows would silently hold 1,000.
 * `readExportRows` walks `.range()` pages up to `limit` and reports how many rows matched in total,
 * so the admin sees "N of M" instead of a quietly short file.
 */

export interface ExportRowsResult {
  rows: Record<string, unknown>[];
  /** Rows that matched in the table (exact count of the first page); at least `rows.length`. */
  total: number;
  /** More rows matched than were returned (the limit was reached). */
  limited: boolean;
}

/**
 * Read up to `limit` rows. `page(from, to, withCount)` must build an ordered query (a unique
 * tie-breaker such as `id` last) ending in `.range(from, to)`; with `withCount` it also asks for
 * the exact count, which only the first page does.
 *
 * The next page starts after the rows actually received, so a server cap below the requested
 * width never skips rows. The read stops at `limit`, once every counted row is read, or on an
 * empty page. Never returns more than `limit` rows. Errors propagate unchanged.
 */
export async function readExportRows(
  page: (
    from: number,
    to: number,
    withCount: boolean,
  ) => PromiseLike<{ data: Record<string, unknown>[] | null; count: number | null; error: unknown }>,
  limit: number,
): Promise<ExportRowsResult> {
  const rows: Record<string, unknown>[] = [];
  let firstPageCount: number | null = null;
  while (rows.length < limit) {
    const from = rows.length;
    const width = Math.min(POSTGREST_PAGE_SIZE, limit - rows.length);
    const { data, count, error } = await page(from, from + width - 1, from === 0);
    if (error) throw error;
    if (from === 0) firstPageCount = count;
    const chunk = data ?? [];
    if (chunk.length === 0) break;
    rows.push(...chunk.slice(0, limit - rows.length));
    // The exact count of the first page tells where the table ends, so a read that fits its pages
    // costs no extra empty request. Without a count, an empty page is the end.
    if (firstPageCount !== null && rows.length >= firstPageCount) break;
  }
  const total = Math.max(firstPageCount ?? rows.length, rows.length);
  return { rows, total, limited: total > rows.length };
}
