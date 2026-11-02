import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const results: { data: unknown; error: unknown }[] = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ['from', 'update', 'eq', 'neq', 'select']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.maybeSingle = () => {
    calls.push({ method: 'maybeSingle', args: [] });
    return Promise.resolve(results.shift() ?? { data: null, error: null });
  };
  return { calls, results, builder };
});

vi.mock('../../client', () => ({ supabase: h.builder }));

import { completeRound } from '../rounds';

describe('completeRound', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.results.length = 0;
  });

  it('updates only a round that is not completed yet, so the transition is claimed atomically', async () => {
    h.results.push({
      data: {
        id: 'r1',
        tournament_id: 't1',
        name: 'Round 1',
        round_number: 1,
        best_of: 3,
        status: 'completed',
        bye_player_ids: [],
      },
      error: null,
    });

    const round = await completeRound('r1');

    expect(round?.status).toBe('completed');
    expect(h.calls.find((c) => c.method === 'update')!.args).toEqual([{ status: 'completed' }]);
    expect(h.calls.find((c) => c.method === 'eq')!.args).toEqual(['id', 'r1']);
    expect(h.calls.find((c) => c.method === 'neq')!.args).toEqual(['status', 'completed']);
  });

  it('returns null when no row changed (already completed)', async () => {
    h.results.push({ data: null, error: null });

    expect(await completeRound('r1')).toBeNull();
  });

  it('throws on a write error instead of reporting a lost claim', async () => {
    const failure = { message: 'timeout', code: '' };
    h.results.push({ data: null, error: failure });

    await expect(completeRound('r1')).rejects.toBe(failure);
  });
});
