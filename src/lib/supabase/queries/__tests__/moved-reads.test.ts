import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callsOf, mock, resetQueryMock } from './query-mock';

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./query-mock')).mock.supabase }));

import { getPoolEntrySeason } from '../draft-pool-entries';
import { getLineIdsByPick } from '../draft-replay-events';
import { findListVersionId } from '../point-buy-lists';
import { listCompletedMatchesInReplayOrder } from '../matches';

beforeEach(resetQueryMock);

describe('getPoolEntrySeason', () => {
  it('selects only the id and season of the entry it is asked for', async () => {
    mock.state.results.push({ data: { id: 'e1', season_id: 's1' } });

    await expect(getPoolEntrySeason('e1')).resolves.toEqual({ id: 'e1', season_id: 's1' });

    expect(mock.state.queries).toHaveLength(1);
    expect(mock.state.queries[0].table).toBe('draft_pool_entries');
    expect(callsOf(0).select).toEqual(['id, season_id']);
    expect(callsOf(0).eq).toEqual(['id', 'e1']);
    expect(callsOf(0).maybeSingle).toEqual([]);
  });

  it('is null when the entry does not exist', async () => {
    mock.state.results.push({ data: null });
    await expect(getPoolEntrySeason('missing')).resolves.toBeNull();
  });

  it('rethrows a failed read instead of reporting the entry as absent', async () => {
    const failure = new Error('boom');
    mock.state.results.push({ error: failure });
    await expect(getPoolEntrySeason('e1')).rejects.toBe(failure);
  });
});

describe('getLineIdsByPick', () => {
  it('reads only id and line_id of the pool picks and maps pick id to line id', async () => {
    mock.state.results.push({
      data: [
        { id: 'pick-1', line_id: 'line-a' },
        { id: 'pick-2', line_id: 'line-b' },
      ],
    });

    const lines = await getLineIdsByPick('pool-1');

    expect([...lines]).toEqual([
      ['pick-1', 'line-a'],
      ['pick-2', 'line-b'],
    ]);
    expect(mock.state.queries[0].table).toBe('draft_picks');
    expect(callsOf(0).select).toEqual(['id, line_id']);
    expect(callsOf(0).eq).toEqual(['draft_pool_id', 'pool-1']);
  });

  it('leaves out a pick that has no line', async () => {
    mock.state.results.push({
      data: [
        { id: 'pick-1', line_id: null },
        { id: 'pick-2', line_id: 'line-b' },
      ],
    });

    expect([...(await getLineIdsByPick('pool-1'))]).toEqual([['pick-2', 'line-b']]);
  });

  it('is an empty map for a pool without picks', async () => {
    mock.state.results.push({ data: [] });
    expect((await getLineIdsByPick('pool-1')).size).toBe(0);
  });

  it('is an empty map when the read returns no data', async () => {
    mock.state.results.push({ data: null });
    expect((await getLineIdsByPick('pool-1')).size).toBe(0);
  });

  it('rethrows a failed read instead of returning an empty map', async () => {
    const failure = new Error('boom');
    mock.state.results.push({ error: failure });
    await expect(getLineIdsByPick('pool-1')).rejects.toBe(failure);
  });
});

describe('findListVersionId', () => {
  it('looks a version up by name and version number and returns its id', async () => {
    mock.state.results.push({ data: { id: 'v-7' } });

    await expect(findListVersionId('Main list', 3)).resolves.toBe('v-7');

    expect(mock.state.queries[0].table).toBe('point_buy_list_versions');
    expect(callsOf(0).select).toEqual(['id']);
    expect(mock.state.queries[0].calls.filter(([method]) => method === 'eq').map(([, args]) => args)).toEqual([
      ['name', 'Main list'],
      ['version', 3],
    ]);
    expect(callsOf(0).maybeSingle).toEqual([]);
  });

  it('is null when no version has that name and number', async () => {
    mock.state.results.push({ data: null });
    await expect(findListVersionId('Main list', 99)).resolves.toBeNull();
  });

  it('rethrows a failed read instead of reporting the version as absent', async () => {
    const failure = new Error('boom');
    mock.state.results.push({ error: failure });
    await expect(findListVersionId('Main list', 3)).rejects.toBe(failure);
  });
});

describe('listCompletedMatchesInReplayOrder', () => {
  const row = (id: string, created_at: string, date_played: string | null = null) => ({
    id,
    player_1_id: 'a',
    player_2_id: 'b',
    winner_id: 'a',
    tournament_id: 't1',
    date_played,
    created_at,
  });

  it('reads completed matches that have a winner, on a total server order, in pages', async () => {
    mock.state.results.push({ data: [] });

    await expect(listCompletedMatchesInReplayOrder()).resolves.toEqual([]);

    expect(mock.state.queries).toHaveLength(1);
    const calls = mock.state.queries[0].calls;
    expect(mock.state.queries[0].table).toBe('matches');
    expect(callsOf(0).select).toEqual(['id, player_1_id, player_2_id, winner_id, tournament_id, date_played, created_at']);
    expect(callsOf(0).eq).toEqual(['status', 'completed']);
    expect(callsOf(0).not).toEqual(['winner_id', 'is', null]);
    expect(calls.filter(([method]) => method === 'order').map(([, args]) => args)).toEqual([
      ['date_played', { ascending: true, nullsFirst: false }],
      ['created_at', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(callsOf(0).range).toEqual([0, 999]);
  });

  it('sorts by date_played, falling back to created_at, not by the order the server returned', async () => {
    mock.state.results.push({
      data: [
        row('late', '2026-03-01T00:00:00Z'),
        row('entered-late-played-early', '2026-04-01T00:00:00Z', '2026-01-01T00:00:00Z'),
        row('middle', '2026-02-01T00:00:00Z'),
      ],
    });

    const matches = await listCompletedMatchesInReplayOrder();

    expect(matches.map((match) => match.id)).toEqual(['entered-late-played-early', 'middle', 'late']);
  });

  it('reads on past the first full page and sorts the whole list', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => row(`a${i}`, '2026-05-01T00:00:00Z'));
    mock.state.results.push({ data: first }, { data: [row('oldest', '2026-01-01T00:00:00Z')] });

    const matches = await listCompletedMatchesInReplayOrder();

    expect(mock.state.queries).toHaveLength(2);
    expect(mock.state.queries[1].calls.find(([method]) => method === 'range')?.[1]).toEqual([1000, 1999]);
    expect(matches).toHaveLength(1001);
    expect(matches[0].id).toBe('oldest');
  });

  it('rethrows a failed page instead of returning the rows read so far', async () => {
    const failure = new Error('boom');
    mock.state.results.push({ data: Array.from({ length: 1000 }, (_, i) => row(`a${i}`, '2026-05-01T00:00:00Z')) }, { error: failure });
    await expect(listCompletedMatchesInReplayOrder()).rejects.toBe(failure);
  });
});
