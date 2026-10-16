import { describe, expect, it } from 'vitest';
import {
  buildSortParam,
  compareSortValues,
  cycleColumnSort,
  nextSortParam,
  paginateArray,
  parseSortParam,
  parseTableParams,
  totalTablePages,
} from '@/lib/ui/table-params';

describe('parseTableParams', () => {
  it('defaults page and perPage safely', () => {
    expect(parseTableParams({})).toEqual({ page: 1, perPage: 20 });
  });

  it('clamps invalid page and perPage', () => {
    expect(parseTableParams({ page: '0', perPage: '99' })).toEqual({
      page: 1,
      perPage: 20,
    });
  });
});

describe('cycleColumnSort', () => {
  it('cycles asc → desc → none', () => {
    expect(cycleColumnSort(null, 'name')).toEqual({ key: 'name', direction: 'asc' });
    expect(cycleColumnSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({
      key: 'name',
      direction: 'desc',
    });
    expect(cycleColumnSort({ key: 'name', direction: 'desc' }, 'name')).toBeNull();
  });

  it('starts fresh asc when switching columns', () => {
    expect(cycleColumnSort({ key: 'name', direction: 'desc' }, 'date')).toEqual({
      key: 'date',
      direction: 'asc',
    });
  });
});

describe('parseSortParam / buildSortParam', () => {
  const columns = ['date', 'name'] as const;

  it('parses compound sort=col-dir', () => {
    expect(parseSortParam('name-asc', columns, { column: 'date', direction: 'desc' })).toEqual({
      key: 'name',
      direction: 'asc',
    });
  });

  it('falls back for invalid sort values', () => {
    expect(parseSortParam('bad', columns, { column: 'date', direction: 'desc' })).toEqual({
      key: 'date',
      direction: 'desc',
    });
  });

  it('builds compound sort params', () => {
    expect(buildSortParam('name', 'desc')).toBe('name-desc');
  });
});

describe('nextSortParam', () => {
  it('matches client cycle for server links', () => {
    expect(nextSortParam(null, 'date')).toBe('date-asc');
    expect(nextSortParam({ key: 'date', direction: 'asc' }, 'date')).toBe('date-desc');
    expect(nextSortParam({ key: 'date', direction: 'desc' }, 'date')).toBeUndefined();
  });
});

describe('compareSortValues', () => {
  it('orders numbers and nullish consistently', () => {
    expect(compareSortValues(1, 2)).toBeLessThan(0);
    expect(compareSortValues(null, 2)).toBeGreaterThan(0);
    expect(compareSortValues('b', 'a')).toBeGreaterThan(0);
  });

  it('sends non-finite numbers to the end without producing NaN', () => {
    expect(compareSortValues(Number.NaN, 1)).toBeGreaterThan(0);
    expect(compareSortValues(1, Number.NaN)).toBeLessThan(0);
    expect(compareSortValues(Number.NaN, Number.NaN)).toBe(0);
    expect(compareSortValues(Number.POSITIVE_INFINITY, 1)).toBeGreaterThan(0);
    expect(Number.isNaN(compareSortValues(Number.NaN, 1))).toBe(false);
  });
});

describe('paginateArray', () => {
  it('slices pages correctly', () => {
    expect(paginateArray([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
  });
});

describe('totalTablePages', () => {
  it('returns at least one page', () => {
    expect(totalTablePages(0, 20)).toBe(1);
    expect(totalTablePages(21, 20)).toBe(2);
  });
});
