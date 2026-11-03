import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callsOf, mock, resetQueryMock } from './query-mock';

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./query-mock')).mock.supabase }));

import { getTournamentSubmitContext } from '../tournaments';

beforeEach(resetQueryMock);

describe('getTournamentSubmitContext', () => {
  it('reads only visibility and the pinned generation of one tournament', async () => {
    mock.state.results.push({ data: { team_visibility: 'own_only', ruleset: { gen: 8 } } });

    await expect(getTournamentSubmitContext('t1')).resolves.toEqual({ teamVisibility: 'own_only', generation: 8 });

    expect(mock.state.queries[0].table).toBe('tournaments');
    expect(callsOf(0).select).toEqual(['team_visibility, ruleset:ruleset_definition_versions ( gen )']);
    expect(callsOf(0).eq).toEqual(['id', 't1']);
  });

  it('falls back to generation 9 when no ruleset is pinned', async () => {
    mock.state.results.push({ data: { team_visibility: 'always_public', ruleset: null } });
    await expect(getTournamentSubmitContext('t1')).resolves.toEqual({ teamVisibility: 'always_public', generation: 9 });
  });

  it('answers null for a tournament that does not exist', async () => {
    mock.state.results.push({ data: null });
    await expect(getTournamentSubmitContext('gone')).resolves.toBeNull();
  });

  it('rethrows a query error', async () => {
    const failure = new Error('boom');
    mock.state.results.push({ error: failure });
    await expect(getTournamentSubmitContext('t1')).rejects.toBe(failure);
  });
});
