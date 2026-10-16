import { describe, expect, it } from 'vitest';
import {
  compareSortValues,
  cycleColumnSort,
  paginateArray,
  totalTablePages,
} from '@/lib/ui/table-params';

interface Row {
  id: string;
  name: string;
  score: number;
}

const rows: Row[] = [
  { id: '1', name: 'Charlie', score: 10 },
  { id: '2', name: 'Alice', score: 30 },
  { id: '3', name: 'Bob', score: 20 },
];

function sortRows(data: Row[], sort: ReturnType<typeof cycleColumnSort>, key: keyof Row): Row[] {
  if (!sort) return data;
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...data].sort(
    (a, b) => compareSortValues(a[key], b[key]) * direction,
  );
}

describe('useClientTable behavior (pure sort/pagination pipeline)', () => {
  it('sorts rows desc by score then paginates', () => {
    const sort = cycleColumnSort(null, 'score');
    expect(sort).toEqual({ key: 'score', direction: 'asc' });
    const sorted = sortRows(rows, { key: 'score', direction: 'desc' }, 'score');
    expect(sorted.map((row) => row.id)).toEqual(['2', '3', '1']);

    const perPage = 2;
    const pageRows = paginateArray(sorted, 1, perPage);
    expect(pageRows).toHaveLength(2);
    expect(totalTablePages(sorted.length, perPage)).toBe(2);
  });

  it('resets page math when sort changes on large lists', () => {
    const manyRows = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      name: `Player ${i}`,
      score: i,
    }));
    let page = 2;
    const perPage = 20;
    expect(paginateArray(manyRows, page, perPage)).toHaveLength(5);

    page = 1;
    const sorted = sortRows(manyRows, cycleColumnSort(null, 'score'), 'score');
    expect(paginateArray(sorted, page, perPage)).toHaveLength(20);
  });
});
