import { describe, expect, it, vi } from 'vitest';
import { readExportRows } from '../export-rows';

type Row = Record<string, unknown>;

/** A table of `size` rows served through `.range()`; `cap` models a lower PostgREST `max_rows`. */
function source(size: number, options: { cap?: number; countable?: boolean } = {}) {
  const table: Row[] = Array.from({ length: size }, (_, i) => ({ id: i }));
  const calls: Array<[number, number, boolean]> = [];
  const page = vi.fn(async (from: number, to: number, withCount: boolean) => {
    calls.push([from, to, withCount]);
    const end = Math.min(to + 1, from + (options.cap ?? Infinity));
    return {
      data: table.slice(from, end),
      count: withCount && options.countable !== false ? size : null,
      error: null,
    };
  });
  return { page, calls };
}

describe('readExportRows', () => {
  it('pages past the 1000-row cap up to the limit and counts only on the first page', async () => {
    const { page, calls } = source(4200);
    const result = await readExportRows(page, 2500);

    expect(calls).toEqual([
      [0, 999, true],
      [1000, 1999, false],
      [2000, 2499, false],
    ]);
    expect(result.rows).toHaveLength(2500);
    expect(result.rows[2499]).toEqual({ id: 2499 });
    expect(result.total).toBe(4200);
    expect(result.limited).toBe(true);
  });

  it('stops after the last row when the table is smaller than the limit', async () => {
    const { page, calls } = source(1500);
    const result = await readExportRows(page, 10000);

    expect(calls).toHaveLength(2);
    expect(result.rows).toHaveLength(1500);
    expect(result.total).toBe(1500);
    expect(result.limited).toBe(false);
  });

  it('continues from the rows received when the server caps pages below the requested width', async () => {
    const { page, calls } = source(1200, { cap: 500 });
    const result = await readExportRows(page, 1200);

    expect(calls.map(([from]) => from)).toEqual([0, 500, 1000]);
    expect(result.rows.map((row) => row.id)).toEqual(Array.from({ length: 1200 }, (_, i) => i));
    expect(result.limited).toBe(false);
  });

  it('stops on an empty page when no count came back', async () => {
    const { page, calls } = source(1500, { countable: false });
    const result = await readExportRows(page, 10000);

    expect(calls).toHaveLength(3);
    expect(result.rows).toHaveLength(1500);
    expect(result.total).toBe(1500);
    expect(result.limited).toBe(false);
  });

  it('requests only the limit when it is smaller than a page', async () => {
    const { page, calls } = source(300);
    const result = await readExportRows(page, 10);

    expect(calls).toEqual([[0, 9, true]]);
    expect(result.rows).toHaveLength(10);
    expect(result.total).toBe(300);
    expect(result.limited).toBe(true);
  });

  it('returns an empty result for an empty source', async () => {
    const { page } = source(0);
    await expect(readExportRows(page, 1000)).resolves.toEqual({ rows: [], total: 0, limited: false });
  });

  it('throws a page error', async () => {
    const failure = new Error('boom');
    const page = vi.fn().mockResolvedValueOnce({ data: null, count: null, error: failure });
    await expect(readExportRows(page, 10)).rejects.toBe(failure);
  });

  it('never returns more than the limit when a page answers with extra rows', async () => {
    const page = vi.fn().mockResolvedValueOnce({
      data: Array.from({ length: 20 }, (_, i) => ({ id: i })),
      count: 20,
      error: null,
    });
    const result = await readExportRows(page, 5);

    expect(result.rows).toHaveLength(5);
    expect(result.total).toBe(20);
    expect(result.limited).toBe(true);
  });
});
