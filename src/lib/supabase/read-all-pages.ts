/**
 * Complete reads under PostgREST `max_rows` (AGENTS: reads stay complete). A single select returns
 * at most `max_rows` rows and truncates the rest silently; `readAllPages` walks `.range()` pages
 * so the caller always gets every row, whatever `max_rows` the project is configured with. Errors
 * propagate unchanged.
 */

/**
 * Rows asked for per request (`.range()` width). PostgREST's default `max_rows` is 1000; a project
 * configured lower answers fewer rows per page, which `readAllPages` detects (see below).
 */
export const POSTGREST_PAGE_SIZE = 1000;

/**
 * Read every row of an ordered query. `page(from, to)` must build the query with a stable
 * `.order()` (a unique column, for example `id`) and end in `.range(from, to)`.
 *
 * The next page starts after the rows actually received, so a server cap below the requested
 * width never skips rows. A short page alone does not prove the end: it may be the cap. The read
 * stops on an empty page, or on a page shorter than a width the server has already shown it
 * serves (a full requested page, or an earlier short page that was not the end). With the default
 * cap, a read that fits one page therefore costs one extra (empty) request; a read longer than
 * one page costs none.
 */
export async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  /** The largest page the server has proven it returns (null until a page was followed by more rows). */
  let servedWidth: number | null = null;
  let from = 0;
  for (;;) {
    const { data, error } = await page(from, from + POSTGREST_PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = data ?? [];
    if (chunk.length === 0) return rows;
    rows.push(...chunk);
    from += chunk.length;
    if (chunk.length >= POSTGREST_PAGE_SIZE) {
      servedWidth = POSTGREST_PAGE_SIZE;
    } else if (servedWidth !== null && chunk.length < servedWidth) {
      return rows;
    } else {
      // A short page with no proven width: either the end or the server's cap. Remember it as
      // the candidate width; the next request settles it (empty = end, rows = it was the cap).
      servedWidth = chunk.length;
    }
  }
}
