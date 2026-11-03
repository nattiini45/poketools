import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callsOf, mock, resetQueryMock } from './query-mock';

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./query-mock')).mock.supabase }));

import {
  createStoryline,
  deleteStoryline,
  getStorylineById,
  listStorylinesBySeason,
  updateStoryline,
} from '../storylines';

beforeEach(resetQueryMock);
afterEach(() => vi.useRealTimers());

const ROW = { id: 's1', season_id: 'l1', title: 'T', body: 'B', tags: [], featured: false, created_by: 'p1' };

describe('storylines queries', () => {
  it('lists a league featured first, then newest updated', async () => {
    mock.state.results.push({ data: [ROW] });

    await expect(listStorylinesBySeason('l1')).resolves.toEqual([ROW]);

    expect(mock.state.queries[0].table).toBe('season_storylines');
    expect(callsOf(0).eq).toEqual(['season_id', 'l1']);
    expect(mock.state.queries[0].calls.filter(([m]) => m === 'order')).toEqual([
      ['order', ['featured', { ascending: false }]],
      ['order', ['updated_at', { ascending: false }]],
    ]);
  });

  it('reads one storyline and answers null for a missing one', async () => {
    mock.state.results.push({ data: ROW }, { data: null });
    await expect(getStorylineById('s1')).resolves.toEqual(ROW);
    await expect(getStorylineById('nope')).resolves.toBeNull();
  });

  it('inserts with the defaults for tags and featured and the creator id', async () => {
    mock.state.results.push({ data: ROW });

    await createStoryline({ season_id: 'l1', title: 'T', body: 'B', created_by: 'p1' });

    expect(callsOf(0).insert).toEqual([{ season_id: 'l1', title: 'T', body: 'B', tags: [], featured: false, created_by: 'p1' }]);
  });

  it('stamps updated_at on an update and passes only the given fields', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T10:00:00.000Z'));
    mock.state.results.push({ data: ROW });

    await updateStoryline('s1', { featured: true });

    expect(callsOf(0).update).toEqual([{ featured: true, updated_at: '2026-03-01T10:00:00.000Z' }]);
    expect(callsOf(0).eq).toEqual(['id', 's1']);
  });

  it('deletes by id', async () => {
    await deleteStoryline('s1');
    expect(mock.state.queries[0].calls.map(([m]) => m)).toEqual(['delete', 'eq']);
    expect(callsOf(0).eq).toEqual(['id', 's1']);
  });

  it('rethrows every failed query', async () => {
    const failure = new Error('boom');
    mock.state.results.push({ error: failure }, { error: failure }, { error: failure }, { error: failure }, { error: failure });
    await expect(listStorylinesBySeason('l1')).rejects.toBe(failure);
    await expect(getStorylineById('s1')).rejects.toBe(failure);
    await expect(createStoryline({ season_id: 'l1', title: 'T', body: 'B', created_by: 'p1' })).rejects.toBe(failure);
    await expect(updateStoryline('s1', { title: 'x' })).rejects.toBe(failure);
    await expect(deleteStoryline('s1')).rejects.toBe(failure);
  });
});
