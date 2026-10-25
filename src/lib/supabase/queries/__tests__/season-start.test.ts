import { beforeEach, describe, expect, it, vi } from 'vitest';

// A chainable query builder whose `.eq()` resolves with the queued result.
const h = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const results: { data: unknown[] | null; error: unknown }[] = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ['from', 'select']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.eq = (...args: unknown[]) => {
    calls.push({ method: 'eq', args });
    return Promise.resolve(results.shift() ?? { data: [], error: null });
  };
  return { calls, results, builder };
});

vi.mock('../../client', () => ({ supabase: h.builder }));

import { getSeasonPhaseStartSignals } from '../season-start';

describe('getSeasonPhaseStartSignals', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.results.length = 0;
  });

  it('reads status and the embedded round count of every phase in ONE query', async () => {
    h.results.push({
      data: [
        { status: 'active', rounds: [{ count: 4 }] },
        { status: 'upcoming', rounds: [{ count: 0 }] },
      ],
      error: null,
    });

    const phases = await getSeasonPhaseStartSignals('season-1');

    expect(h.calls.filter((c) => c.method === 'from')).toEqual([{ method: 'from', args: ['tournaments'] }]);
    expect(h.calls.find((c) => c.method === 'select')!.args).toEqual(['status, rounds ( count )']);
    expect(h.calls.find((c) => c.method === 'eq')!.args).toEqual(['season_id', 'season-1']);
    expect(phases).toEqual([
      { status: 'active', rounds_total: 4 },
      { status: 'upcoming', rounds_total: 0 },
    ]);
  });

  it('counts a missing or empty embed as zero rounds', async () => {
    h.results.push({
      data: [
        { status: 'upcoming', rounds: null },
        { status: 'upcoming', rounds: [] },
      ],
      error: null,
    });

    expect(await getSeasonPhaseStartSignals('season-1')).toEqual([
      { status: 'upcoming', rounds_total: 0 },
      { status: 'upcoming', rounds_total: 0 },
    ]);
  });

  it('returns an empty list for a league without phases', async () => {
    h.results.push({ data: null, error: null });
    expect(await getSeasonPhaseStartSignals('season-1')).toEqual([]);
  });

  it('rethrows a query error', async () => {
    const failure = new Error('db down');
    h.results.push({ data: null, error: failure });
    await expect(getSeasonPhaseStartSignals('season-1')).rejects.toBe(failure);
  });
});
