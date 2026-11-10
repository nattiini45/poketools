import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const results: { data: unknown; error: unknown }[] = [];
  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(results.shift() ?? { data: null, error: null });
    },
  };
  return { calls, results, client };
});

vi.mock('../../client', () => ({ supabase: h.client }));

import { writeBracket } from '../rounds';

const input = {
  tournament_id: 't-1',
  expected_status: 'completed' as const,
  replace: true,
  rounds: [{ id: 'r-1', name: 'Finals', round_number: 1, best_of: 3, bracket_side: 'winners' }],
  matches: [{ id: 'm-1', round_id: 'r-1', player_1_id: 'p-1', player_2_id: 'p-2', bracket_side: 'winners', bracket_pos: 0 }],
  current_round: 1,
};

const signal = (message: string, details: unknown = null) => ({
  code: 'P0001',
  message,
  details: details === null ? null : JSON.stringify(details),
  hint: null,
});

describe('writeBracket', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.results.length = 0;
  });

  it('writes the whole bracket in one database call (bracket_write) with the status the caller read', async () => {
    h.results.push({ data: { rounds: 1, matches: 1 }, error: null });

    await expect(writeBracket(input)).resolves.toEqual({ rounds: 1, matches: 1 });
    expect(h.calls).toEqual([
      {
        fn: 'bracket_write',
        args: {
          p_tournament_id: 't-1',
          p_expected_status: 'completed',
          p_replace: true,
          p_rounds: input.rounds,
          p_matches: input.matches,
          p_current_round: 1,
        },
      },
    ]);
  });

  it('answers a status that moved under the lock with 409 tournament_status_changed', async () => {
    h.results.push({ data: null, error: signal('tournament_status_changed', { status: 'active' }) });

    await expect(writeBracket(input)).rejects.toMatchObject({
      code: 'tournament_status_changed',
      params: { from: 'completed' },
      statusCode: 409,
    });
  });

  it('answers a phase that has rounds already with 409 bracket_already_generated', async () => {
    h.results.push({ data: null, error: signal('bracket_already_generated') });

    await expect(writeBracket({ ...input, replace: false })).rejects.toMatchObject({
      code: 'bracket_already_generated',
      statusCode: 409,
    });
  });

  it('answers a match played since the resets with 409 REGENERATE_PLAYED and its count', async () => {
    h.results.push({ data: null, error: signal('bracket_matches_played', { count: 2 }) });

    await expect(writeBracket(input)).rejects.toMatchObject({
      code: 'REGENERATE_PLAYED',
      params: { count: 2 },
      statusCode: 409,
    });
  });

  it('answers a missing tournament with 404 tournament_not_found', async () => {
    h.results.push({ data: null, error: signal('tournament_not_found') });

    await expect(writeBracket(input)).rejects.toMatchObject({ code: 'tournament_not_found', statusCode: 404 });
  });

  it('rethrows any other database error unchanged', async () => {
    const error = { code: '23503', message: 'foreign key violation', details: null, hint: null };
    h.results.push({ data: null, error });

    await expect(writeBracket(input)).rejects.toBe(error);
  });
});
