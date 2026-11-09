/**
 * `getPhaseGameCounts`: the games of the completed matches of the phases, counted per match id. It reads only completed
 * matches (what a table scores), pages past `max_rows`, chunks long phase lists and makes no request for an empty one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Step = [string, ...unknown[]];

const state = vi.hoisted(() => ({
  calls: [] as { table: string; steps: Step[] }[],
  respond: null as null | ((call: { table: string; steps: Step[] }) => { data?: unknown; error?: unknown }),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, steps: [] as Step[] };
      state.calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'in', 'eq', 'order', 'range']) {
        chain[name] = (...args: unknown[]) => {
          call.steps.push([name, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null, ...(state.respond?.(call) ?? {}) });
      return chain;
    },
  },
}));

import { getPhaseGameCounts } from '../format-engine';

const stepsOf = (call: { steps: Step[] }, name: string) => call.steps.filter(([step]) => step === name);
const game = (id: string, match_id: string) => ({ id, match_id });

beforeEach(() => {
  state.calls.length = 0;
  state.respond = null;
});

describe('getPhaseGameCounts', () => {
  it('counts the games per match, reading the completed matches of the phases only', async () => {
    state.respond = (call) => ({ data: stepsOf(call, 'range')[0][1] === 0 ? [game('g1', 'm1'), game('g2', 'm1'), game('g3', 'm2')] : [] });
    await expect(getPhaseGameCounts(['p1', 'p2', 'p1'])).resolves.toEqual({ m1: 2, m2: 1 });
    const [call] = state.calls;
    expect(call.table).toBe('games');
    expect(stepsOf(call, 'in')).toEqual([['in', 'matches.tournament_id', ['p1', 'p2']]]);
    expect(stepsOf(call, 'eq')).toEqual([['eq', 'matches.status', 'completed']]);
  });

  it('answers an empty record without a request for no phases', async () => {
    await expect(getPhaseGameCounts([])).resolves.toEqual({});
    expect(state.calls).toEqual([]);
  });

  it('walks every page, so a long season is complete under max_rows', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => game(`a${i}`, 'm1'));
    state.respond = (call) => {
      const from = stepsOf(call, 'range')[0][1];
      return { data: from === 0 ? first : from === 1000 ? [game('b0', 'm1'), game('b1', 'm2')] : [] };
    };
    await expect(getPhaseGameCounts(['p'])).resolves.toEqual({ m1: 1001, m2: 1 });
  });

  it('splits a long phase list into several reads and adds the counts', async () => {
    const phases = Array.from({ length: 150 }, (_, i) => `p${i}`);
    state.respond = (call) => ({ data: stepsOf(call, 'range')[0][1] === 0 ? [game(`g${state.calls.length}`, 'm1')] : [] });
    await expect(getPhaseGameCounts(phases)).resolves.toEqual({ m1: 2 });
    const reads = state.calls.map((call) => (stepsOf(call, 'in')[0][2] as string[]).length);
    expect(reads.filter((n) => n > 0)).toEqual(expect.arrayContaining([100, 50]));
  });

  it('throws a failed read', async () => {
    state.respond = () => ({ data: null, error: new Error('boom') });
    await expect(getPhaseGameCounts(['p'])).rejects.toThrow('boom');
  });
});

