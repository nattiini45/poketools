/**
 * `readAllPages` walks `.range()` pages so a read past PostgREST `max_rows` is never truncated,
 * whatever cap the server applies (also one below the requested width), and propagates a page
 * error instead of returning a partial result.
 */
import { describe, expect, it, vi } from 'vitest';
import { POSTGREST_PAGE_SIZE, readAllPages } from '../read-all-pages';

const rows = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: offset + i }));

describe('readAllPages', () => {
  it('confirms a lone short page with one more (empty) request: it could have been the cap', async () => {
    const page = vi
      .fn()
      .mockResolvedValueOnce({ data: rows(3), error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    await expect(readAllPages(page)).resolves.toEqual(rows(3));
    expect(page.mock.calls).toEqual([
      [0, POSTGREST_PAGE_SIZE - 1],
      [3, POSTGREST_PAGE_SIZE + 2],
    ]);
  });

  it('keeps reading past a full page (max_rows) and stops at the first short page', async () => {
    const page = vi
      .fn()
      .mockResolvedValueOnce({ data: rows(POSTGREST_PAGE_SIZE), error: null })
      .mockResolvedValueOnce({ data: rows(2, POSTGREST_PAGE_SIZE), error: null });

    const all = await readAllPages(page);

    expect(all).toHaveLength(POSTGREST_PAGE_SIZE + 2);
    expect(page.mock.calls).toEqual([
      [0, POSTGREST_PAGE_SIZE - 1],
      [POSTGREST_PAGE_SIZE, 2 * POSTGREST_PAGE_SIZE - 1],
    ]);
  });

  it('asks for one more (empty) page when the total is an exact multiple of the page size', async () => {
    const page = vi
      .fn()
      .mockResolvedValueOnce({ data: rows(POSTGREST_PAGE_SIZE), error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    await expect(readAllPages(page)).resolves.toHaveLength(POSTGREST_PAGE_SIZE);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it('reads every row under a server cap of 500 (below the requested width), resuming after the rows received', async () => {
    const CAP = 500;
    const total = rows(1234);
    // A PostgREST server with max_rows = 500: every range answers at most 500 rows.
    const page = vi.fn(async (from: number, to: number) => ({
      data: total.slice(from, Math.min(to + 1, from + CAP)),
      error: null,
    }));

    const all = await readAllPages(page);

    expect(all).toEqual(total);
    expect(page.mock.calls.map(([from]) => from)).toEqual([0, 500, 1000]);
  });

  it('reads every row when the total is an exact multiple of a 500 cap', async () => {
    const CAP = 500;
    const total = rows(1000);
    const page = vi.fn(async (from: number, to: number) => ({
      data: total.slice(from, Math.min(to + 1, from + CAP)),
      error: null,
    }));

    await expect(readAllPages(page)).resolves.toEqual(total);
    expect(page.mock.calls.map(([from]) => from)).toEqual([0, 500, 1000]);
  });

  it('treats null data as an empty page', async () => {
    const page = vi.fn().mockResolvedValue({ data: null, error: null });

    await expect(readAllPages(page)).resolves.toEqual([]);
  });

  it('propagates a page error unchanged (never a partial result)', async () => {
    const failure = { code: '57014', message: 'canceling statement due to statement timeout' };
    const page = vi
      .fn()
      .mockResolvedValueOnce({ data: rows(POSTGREST_PAGE_SIZE), error: null })
      .mockResolvedValueOnce({ data: null, error: failure });

    await expect(readAllPages(page)).rejects.toBe(failure);
  });
});
