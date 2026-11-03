import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callsOf, mock, resetQueryMock } from './query-mock';

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./query-mock')).mock.supabase }));

import { promoteFirstAdmin, siteAdminExists } from '../bootstrap';

beforeEach(resetQueryMock);

describe('siteAdminExists', () => {
  it('asks for one admin row only', async () => {
    mock.state.results.push({ data: [{ id: 'p1' }] });

    await expect(siteAdminExists()).resolves.toBe(true);

    expect(mock.state.queries[0].table).toBe('players');
    expect(callsOf(0).select).toEqual(['id']);
    expect(callsOf(0).eq).toEqual(['is_admin', true]);
    expect(callsOf(0).limit).toEqual([1]);
  });

  it('is false when no admin row exists', async () => {
    mock.state.results.push({ data: [] });
    await expect(siteAdminExists()).resolves.toBe(false);
  });

  it('throws a failed read instead of reporting no admin', async () => {
    const failure = new Error('boom');
    mock.state.results.push({ error: failure });
    await expect(siteAdminExists()).rejects.toBe(failure);
  });
});

describe('promoteFirstAdmin', () => {
  it('calls the atomic function and returns its outcome', async () => {
    mock.state.rpcResults.push({ data: 'promoted' });

    await expect(promoteFirstAdmin('p1')).resolves.toBe('promoted');

    expect(mock.state.rpcs).toEqual([{ fn: 'bootstrap_first_admin', args: { p_player_id: 'p1' } }]);
  });

  it('throws an rpc error', async () => {
    const failure = new Error('rpc down');
    mock.state.rpcResults.push({ error: failure });
    await expect(promoteFirstAdmin('p1')).rejects.toBe(failure);
  });
});
