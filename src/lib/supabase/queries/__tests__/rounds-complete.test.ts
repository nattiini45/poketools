import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: { fn: string; args: unknown }[] = [];
  const results: { data: unknown; error: unknown }[] = [];
  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return Promise.resolve(results.shift() ?? { data: null, error: null });
    },
  };
  return { calls, results, client };
});

vi.mock('../../client', () => ({ supabase: h.client }));

import { completeRound } from '../rounds';

const roundRow = {
  id: 'r1',
  tournament_id: 't1',
  name: 'Round 1',
  round_number: 1,
  best_of: 3,
  status: 'completed',
  bye_player_ids: [],
};

describe('completeRound', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.results.length = 0;
  });

  it('claims the transition in the database, under the lock of the round row, with the force flag', async () => {
    h.results.push({ data: { outcome: 'completed', round: roundRow, unfinished: 0 }, error: null });

    const result = await completeRound('r1', { force: false });

    expect(result).toMatchObject({ outcome: 'completed', unfinished: 0, round: { id: 'r1', status: 'completed' } });
    expect(h.calls).toEqual([{ fn: 'round_complete', args: { p_round_id: 'r1', p_force: false } }]);
  });

  it('reports how many unfinished matches a forced completion left, as counted under the lock', async () => {
    h.results.push({ data: { outcome: 'completed', round: roundRow, unfinished: 2 }, error: null });

    const result = await completeRound('r1', { force: true });

    expect(result).toMatchObject({ outcome: 'completed', unfinished: 2 });
    expect(h.calls[0].args).toEqual({ p_round_id: 'r1', p_force: true });
  });

  it('reports a refusal for unfinished matches without a write', async () => {
    h.results.push({ data: { outcome: 'unfinished', unfinished: 1 }, error: null });

    expect(await completeRound('r1', { force: false })).toEqual({ outcome: 'unfinished', unfinished: 1 });
  });

  it('reports unchanged when the round was already completed or is gone', async () => {
    h.results.push({ data: { outcome: 'already_completed' }, error: null });
    h.results.push({ data: { outcome: 'not_found' }, error: null });

    expect(await completeRound('r1', { force: false })).toEqual({ outcome: 'unchanged' });
    expect(await completeRound('r1', { force: false })).toEqual({ outcome: 'unchanged' });
  });

  it('throws on a write error instead of reporting a lost claim', async () => {
    const failure = { message: 'timeout', code: '' };
    h.results.push({ data: null, error: failure });

    await expect(completeRound('r1', { force: false })).rejects.toBe(failure);
  });

  it('throws on a result it does not know instead of guessing an outcome', async () => {
    h.results.push({ data: { outcome: 'something_else' }, error: null });
    h.results.push({ data: null, error: null });

    await expect(completeRound('r1', { force: false })).rejects.toThrow(/unexpected result/);
    await expect(completeRound('r1', { force: false })).rejects.toThrow(/unexpected result/);
  });
});
