/**
 * `readBoundedPages`: ordered `.range()` paging that ends on the first short page (one request for
 * a result of 1,000 rows or fewer) and stops with a logged warning after a hard page bound.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAX_BOUNDED_PAGES, readBoundedPages } from '../read-bounded-pages';

type Page = { data: number[] | null; error: unknown };

/** A fake query over `total` rows (0..total-1) that records the requested ranges. */
function source(total: number) {
  const ranges: Array<[number, number]> = [];
  const page = (from: number, to: number): PromiseLike<Page> => {
    ranges.push([from, to]);
    const data = Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => from + i);
    return Promise.resolve({ data, error: null });
  };
  return { page, ranges };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('readBoundedPages', () => {
  it('returns no rows for an empty first page with one request', async () => {
    const { page, ranges } = source(0);

    const result = await readBoundedPages(page, { label: 'test' });

    expect(result).toEqual({ rows: [], truncated: false });
    expect(ranges).toEqual([[0, 999]]);
  });

  it('treats a null data page as empty', async () => {
    const page = vi.fn().mockResolvedValue({ data: null, error: null });

    const result = await readBoundedPages<number>(page, { label: 'test' });

    expect(result).toEqual({ rows: [], truncated: false });
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('reads a short result in ONE request', async () => {
    const { page, ranges } = source(3);

    const result = await readBoundedPages(page, { label: 'test' });

    expect(result.rows).toEqual([0, 1, 2]);
    expect(result.truncated).toBe(false);
    expect(ranges).toHaveLength(1);
  });

  it('needs a second (empty) request for exactly 1000 rows', async () => {
    const { page, ranges } = source(1000);

    const result = await readBoundedPages(page, { label: 'test' });

    expect(result.rows).toHaveLength(1000);
    expect(result.truncated).toBe(false);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('pages 2345 rows in order through three ranges', async () => {
    const { page, ranges } = source(2345);

    const result = await readBoundedPages(page, { label: 'test' });

    expect(result.rows).toEqual(Array.from({ length: 2345 }, (_, i) => i));
    expect(result.truncated).toBe(false);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('rethrows an error on a later page unchanged and returns no partial rows', async () => {
    const boom = { message: 'page 2 failed', code: 'XX000' };
    const base = source(5000);
    const page = vi.fn((from: number, to: number): PromiseLike<Page> => {
      if (from === 1000) return Promise.resolve({ data: null, error: boom });
      return base.page(from, to);
    });

    await expect(readBoundedPages(page, { label: 'test' })).rejects.toBe(boom);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it('stops at maxPages with endless full pages, flags truncated and warns once with the label', async () => {
    const ranges: Array<[number, number]> = [];
    const page = (from: number, to: number): PromiseLike<Page> => {
      ranges.push([from, to]);
      return Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => from + i), error: null });
    };

    const result = await readBoundedPages(page, { label: 'getThing tournament t1', maxPages: 2 });

    expect(result.rows).toHaveLength(2000);
    expect(result.truncated).toBe(true);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('getThing tournament t1');
    expect(message).toContain('2000-row bound');
  });

  it('defaults the bound to 20 pages (20,000 rows)', async () => {
    expect(DEFAULT_MAX_BOUNDED_PAGES).toBe(20);
    const { page, ranges } = source(25_000);

    const result = await readBoundedPages(page, { label: 'test' });

    expect(result.rows).toHaveLength(20_000);
    expect(result.truncated).toBe(true);
    expect(ranges).toHaveLength(20);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1.5, -1, Number.NaN])('rejects maxPages %s with a RangeError', async (maxPages) => {
    const { page, ranges } = source(10);

    await expect(readBoundedPages(page, { label: 'test', maxPages })).rejects.toBeInstanceOf(RangeError);
    expect(ranges).toHaveLength(0);
  });
});
