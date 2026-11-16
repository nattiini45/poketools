import { describe, expect, it } from 'vitest';
import { sortLineIds, isStatSort, type SortContext } from '../sort';
import { buildFixtureCatalog, stubNames } from './fixture-index';

describe('reference evolution threshold sorting', () => {
  const catalog = buildFixtureCatalog();
  const lines = catalog.lines.slice(0, 3).map((line, i) => ({
    ...line,
    stages: i === 2 ? line.stages.slice(0, 2) : line.stages,
    thresholds: { ...line.thresholds, cumulative: [[3, 15], [5, 8], [4, null]][i] as [number, number | null] },
  }));
  const ids = lines.map(line => line.lineId);
  const ctx: SortContext = {
    catalog: new Map(lines.map(line => [line.lineId, line])), ix: null,
    sortStage: 'base', favorites: new Set(), names: stubNames, dataLocale: 'en',
  };

  it('uses the first threshold of each path for next and the cumulative final for total', () => {
    expect(sortLineIds(ids, 'next', ctx)).toEqual([ids[0], ids[2], ids[1]]);
    expect(sortLineIds(ids, 'total', ctx)).toEqual([ids[2], ids[1], ids[0]]);
    expect(sortLineIds(ids, 'total', { ...ctx, sortStage: 'final' })).toEqual([ids[2], ids[1], ids[0]]);
    expect(isStatSort('next')).toBe(false);
    expect(isStatSort('total')).toBe(false);
  });
});
