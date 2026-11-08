/**
 * `getPhaseKillTallies`: the kills of the completed matches of the phases, per match id and player id. It reads only
 * completed matches (what a table scores), pages past `max_rows` without a cap, chunks long phase lists and makes no
 * request for an empty one.
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

import { getPhaseKillTallies } from '../games';

const stepsOf = (call: { steps: Step[] }, name: string) => call.steps.filter(([step]) => step === name);
const row = (id: string, match_id: string, player_id: string, kos_dealt: number, was_koed: boolean) => ({
  id,
  player_id,
  kos_dealt,
  was_koed,
  games: { match_id, matches: { tournament_id: 'p1', status: 'completed' } },
});

beforeEach(() => {
  state.calls.length = 0;
  state.respond = null;
});

describe('getPhaseKillTallies', () => {
  it('sums kos dealt minus fainted Pokemon per match and player, reading the completed matches of the phases only', async () => {
    state.respond = (call) => ({
      data:
        stepsOf(call, 'range')[0][1] === 0
          ? [row('1', 'm1', 'a', 3, false), row('2', 'm1', 'a', 2, true), row('3', 'm1', 'b', 0, true), row('4', 'm2', 'a', 1, false)]
          : [],
    });
    await expect(getPhaseKillTallies(['p1', 'p2', 'p1'])).resolves.toEqual({ m1: { a: 4, b: -1 }, m2: { a: 1 } });
    const [call] = state.calls;
    expect(call.table).toBe('battle_stats');
    expect(stepsOf(call, 'in')).toEqual([['in', 'games.matches.tournament_id', ['p1', 'p2']]]);
    expect(stepsOf(call, 'eq')).toEqual([['eq', 'games.matches.status', 'completed']]);
  });

  it('answers an empty record without a request for no phases', async () => {
    await expect(getPhaseKillTallies([])).resolves.toEqual({});
    expect(state.calls).toEqual([]);
  });

  it('walks every page without a cap, so a long phase is complete under max_rows', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => row(`a${i}`, 'm1', 'a', 1, false));
    state.respond = (call) => {
      const from = stepsOf(call, 'range')[0][1];
      return { data: from === 0 ? first : from === 1000 ? [row('b0', 'm1', 'a', 1, false)] : [] };
    };
    await expect(getPhaseKillTallies(['p1'])).resolves.toEqual({ m1: { a: 1001 } });
  });

  it('splits a long phase list into several reads', async () => {
    const phases = Array.from({ length: 150 }, (_, i) => `p${i}`);
    await getPhaseKillTallies(phases);
    const reads = state.calls.map((call) => (stepsOf(call, 'in')[0][2] as string[]).length);
    expect(reads.filter((n) => n > 0)).toEqual(expect.arrayContaining([100, 50]));
  });

  it('throws a failed read', async () => {
    state.respond = () => ({ data: null, error: new Error('boom') });
    await expect(getPhaseKillTallies(['p1'])).rejects.toThrow('boom');
  });
});
