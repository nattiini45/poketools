import { beforeEach, describe, expect, it, vi } from 'vitest';

// A chainable query builder whose `.range()` resolves with the next queued page.
const h = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const pages: { data: unknown[] | null; error: unknown }[] = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ['from', 'select', 'in', 'order']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.range = (...args: unknown[]) => {
    calls.push({ method: 'range', args });
    return Promise.resolve(pages.shift() ?? { data: [], error: null });
  };
  return { calls, pages, builder };
});

vi.mock('../../client', () => ({ supabase: h.builder }));

import { listRoundStatusesByTournamentIds } from '../rounds';

const row = (id: string, tournament_id: string, round_number: number, status: string) => ({ id, tournament_id, round_number, status });

describe('listRoundStatusesByTournamentIds', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.pages.length = 0;
  });

  it('reads the id, number and status of every round of the tournaments in ONE query', async () => {
    h.pages.push({ data: [row('r1', 't1', 1, 'completed'), row('r2', 't1', 2, 'active'), row('r3', 't2', 1, 'pending')], error: null });

    const rounds = await listRoundStatusesByTournamentIds(['t1', 't2', 't1']);

    expect(h.calls.filter((c) => c.method === 'from')).toHaveLength(1);
    expect(h.calls.find((c) => c.method === 'select')!.args).toEqual(['id, tournament_id, round_number, status']);
    expect(h.calls.find((c) => c.method === 'in')!.args).toEqual(['tournament_id', ['t1', 't2']]);
    expect(rounds).toEqual([
      { id: 'r1', tournament_id: 't1', round_number: 1, status: 'completed' },
      { id: 'r2', tournament_id: 't1', round_number: 2, status: 'active' },
      { id: 'r3', tournament_id: 't2', round_number: 1, status: 'pending' },
    ]);
  });

  it('reads nothing for no tournaments', async () => {
    expect(await listRoundStatusesByTournamentIds([])).toEqual([]);
    expect(h.calls).toHaveLength(0);
  });

  it('pages past the PostgREST ceiling', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => row(`a${i}`, 't1', i + 1, 'completed'));
    h.pages.push({ data: full, error: null }, { data: [row('b1', 't1', 1001, 'completed')], error: null });

    const rounds = await listRoundStatusesByTournamentIds(['t1']);

    expect(rounds).toHaveLength(1001);
    expect(h.calls.filter((c) => c.method === 'range').map((c) => c.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('throws the database error', async () => {
    h.pages.push({ data: null, error: new Error('db down') });
    await expect(listRoundStatusesByTournamentIds(['t1'])).rejects.toThrow('db down');
  });
});
