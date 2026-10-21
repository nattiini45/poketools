import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom, calls, result } = vi.hoisted(() => {
  const calls: [string, ...unknown[]][] = [];
  const result: { data: unknown; error: unknown } = { data: [], error: null };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'not']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: result.data, error: result.error }).then(resolve, reject);
  return { mockFrom: vi.fn(() => builder), calls, result };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: mockFrom } }));

import { getCosmoMatchdays } from '../progress-log';

describe('getCosmoMatchdays', () => {
  beforeEach(() => {
    calls.length = 0;
    result.data = [];
    result.error = null;
    mockFrom.mockClear();
  });

  it("reads the tracker's cosmo_point rows that carry a matchday", async () => {
    await getCosmoMatchdays('t-cosmog');
    expect(mockFrom).toHaveBeenCalledWith('evo_progress_log');
    expect(calls).toEqual([
      ['select', 'matchday, amount'],
      ['eq', 'tracker_id', 't-cosmog'],
      ['eq', 'source', 'cosmo_point'],
      ['not', 'matchday', 'is', null],
    ]);
  });

  it('counts a matchday as awarded once a positive row exists, even after a reversal row', async () => {
    result.data = [
      { matchday: 5, amount: 1 },
      { matchday: 3, amount: 1 },
      { matchday: 3, amount: -1 }, // reversal: does not re-open matchday 3
      { matchday: 4, amount: -1 }, // a lone negative row never counts as an award
      { matchday: 1, amount: 1 },
    ];
    expect(await getCosmoMatchdays('t-cosmog')).toEqual([1, 3, 5]);
  });

  it('throws the query error', async () => {
    const err = Object.assign(new Error('boom'), { code: '42P01' });
    result.error = err;
    result.data = null;
    await expect(getCosmoMatchdays('t-cosmog')).rejects.toBe(err);
  });
});
