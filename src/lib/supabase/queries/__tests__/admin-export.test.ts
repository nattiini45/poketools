import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callsOf, mock, resetQueryMock } from './query-mock';

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./query-mock')).mock.supabase }));

import { readExportTable } from '../admin-export';

beforeEach(resetQueryMock);

describe('readExportTable', () => {
  it('reads the named table in a total order and asks for the exact count on the first page', async () => {
    mock.state.results.push({ data: [{ id: 'a' }, { id: 'b' }], count: 2 });

    await expect(readExportTable('matches', 500)).resolves.toEqual({
      rows: [{ id: 'a' }, { id: 'b' }],
      total: 2,
      limited: false,
    });

    expect(mock.state.queries[0].table).toBe('matches');
    expect(callsOf(0).select).toEqual(['*', { count: 'exact' }]);
    expect(mock.state.queries[0].calls.filter(([m]) => m === 'order')).toEqual([
      ['order', ['created_at', { ascending: true }]],
      ['order', ['id', { ascending: true }]],
    ]);
    expect(callsOf(0).range).toEqual([0, 499]);
  });

  it('reports a truncated export when more rows matched than the limit', async () => {
    mock.state.results.push({ data: [{ id: 'a' }], count: 9 });
    await expect(readExportTable('players', 1)).resolves.toMatchObject({ total: 9, limited: true });
  });

  it('propagates a query error', async () => {
    const failure = new Error('boom');
    mock.state.results.push({ error: failure });
    await expect(readExportTable('games', 10)).rejects.toBe(failure);
  });
});
