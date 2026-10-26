/**
 * The Format Studio's bounded reads: phase group counts (`tournament_groups ( count )` embeds), league group
 * counts (rows counted in JS) and the type assignment head counts. Ids are chunked by 50, each chunk is paged
 * with `.range()` until a short page, an empty list makes no request and errors are rethrown.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
  table: string;
  steps: [string, ...unknown[]][];
}

type Response = { data?: unknown; count?: number | null; error: unknown };

const state = vi.hoisted(() => ({
  calls: [] as { table: string; steps: [string, ...unknown[]][] }[],
  respond: null as null | ((call: { table: string; steps: [string, ...unknown[]][] }) => {
    data?: unknown;
    count?: number | null;
    error: unknown;
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => {
  function builder(table: string) {
    const call: Call = { table, steps: [] };
    state.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'in', 'order', 'range', 'eq', 'not']) {
      chain[name] = (...args: unknown[]) => {
        call.steps.push([name, ...args]);
        return chain;
      };
    }
    chain.then = (resolve: (value: unknown) => unknown) =>
      resolve(state.respond?.(call) ?? { data: [], count: 0, error: null });
    return chain;
  }
  return { supabase: { from: builder } };
});

import { getLeagueGroupCounts, getSeasonTypeAssignmentCounts, getStageGroupCounts } from '../format-studio';

const stepsOf = (call: Call, name: string) => call.steps.filter(([step]) => step === name);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`);
const rangeOf = (call: Call) => stepsOf(call, 'range')[0].slice(1);

beforeEach(() => {
  state.calls.length = 0;
  state.respond = null;
});

describe('getStageGroupCounts', () => {
  it('makes no request for an empty list', async () => {
    expect((await getStageGroupCounts([])).size).toBe(0);
    expect(state.calls).toHaveLength(0);
  });

  it('reads the count embed per phase and chunks 120 ids as 50, 50 and 20', async () => {
    state.respond = (call) =>
      (stepsOf(call, 'in')[0][2] as string[]).includes('s0')
        ? { data: [{ id: 't1', tournament_groups: [{ count: 4 }] }, { id: 't2', tournament_groups: [{ count: 0 }] }], error: null }
        : { data: [], error: null };
    const counts = await getStageGroupCounts(ids(120));
    expect(counts.get('t1')).toBe(4);
    expect(counts.get('t2')).toBe(0);
    expect(state.calls.map((call) => (stepsOf(call, 'in')[0][2] as string[]).length)).toEqual([50, 50, 20]);
    const call = state.calls[0];
    expect(call.table).toBe('tournaments');
    expect(stepsOf(call, 'select')[0][1]).toBe('id, tournament_groups ( count )');
    expect(stepsOf(call, 'in')[0][1]).toBe('season_id');
  });

  it('reads a missing embed as zero groups', async () => {
    state.respond = () => ({ data: [{ id: 't1', tournament_groups: null }, { id: 't2', tournament_groups: [] }], error: null });
    const counts = await getStageGroupCounts(['a']);
    expect(counts.get('t1')).toBe(0);
    expect(counts.get('t2')).toBe(0);
  });

  it('pages past 1000 rows', async () => {
    state.respond = (call) => {
      const [from] = rangeOf(call) as [number, number];
      return from === 0
        ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: `t${i}`, tournament_groups: [{ count: 1 }] })), error: null }
        : { data: [{ id: 'tail', tournament_groups: [{ count: 2 }] }], error: null };
    };
    const counts = await getStageGroupCounts(['a']);
    expect(state.calls.map(rangeOf)).toEqual([[0, 999], [1000, 1999]]);
    expect(counts.size).toBe(1001);
    expect(counts.get('tail')).toBe(2);
  });

  it('rethrows an error', async () => {
    const failure = new Error('boom');
    state.respond = () => ({ data: null, error: failure });
    await expect(getStageGroupCounts(['a'])).rejects.toBe(failure);
  });
});

describe('getLeagueGroupCounts', () => {
  it('makes no request for an empty list', async () => {
    expect((await getLeagueGroupCounts([])).size).toBe(0);
    expect(state.calls).toHaveLength(0);
  });

  it('counts season_groups rows per league and gives every requested league an entry', async () => {
    state.respond = () => ({
      data: [
        { id: 'g1', season_id: 'a' },
        { id: 'g2', season_id: 'a' },
        { id: 'g3', season_id: 'b' },
      ],
      error: null,
    });
    const counts = await getLeagueGroupCounts(['a', 'b', 'c']);
    expect([...counts]).toEqual([['a', 2], ['b', 1], ['c', 0]]);
    expect(state.calls[0].table).toBe('season_groups');
    expect(stepsOf(state.calls[0], 'in')[0][1]).toBe('season_id');
  });

  it('chunks by 50 and pages past 1000 rows', async () => {
    state.respond = (call) => {
      const [from] = rangeOf(call) as [number, number];
      const first = (stepsOf(call, 'in')[0][2] as string[])[0] === 's0';
      if (first && from === 0) return { data: Array.from({ length: 1000 }, (_, i) => ({ id: `g${i}`, season_id: 's0' })), error: null };
      if (first && from === 1000) return { data: [{ id: 'gx', season_id: 's0' }], error: null };
      return { data: [], error: null };
    };
    const counts = await getLeagueGroupCounts(ids(60));
    expect(state.calls).toHaveLength(3);
    expect(counts.get('s0')).toBe(1001);
    expect(counts.get('s59')).toBe(0);
  });

  it('rethrows an error', async () => {
    const failure = new Error('boom');
    state.respond = () => ({ data: null, error: failure });
    await expect(getLeagueGroupCounts(['a'])).rejects.toBe(failure);
  });
});

describe('getSeasonTypeAssignmentCounts', () => {
  const respond = (gym: Response, core: Response) => (call: Call) =>
    stepsOf(call, 'not')[0][1] === 'gym_type' ? gym : core;

  it('runs two head counts on season_participants and returns both numbers', async () => {
    state.respond = respond({ count: 3, error: null }, { count: 5, error: null });
    await expect(getSeasonTypeAssignmentCounts('s1')).resolves.toEqual({ gymTyped: 3, cored: 5 });
    expect(state.calls).toHaveLength(2);
    for (const call of state.calls) {
      expect(call.table).toBe('season_participants');
      expect(stepsOf(call, 'select')[0][2]).toEqual({ count: 'exact', head: true });
      expect(stepsOf(call, 'eq')[0].slice(1)).toEqual(['season_id', 's1']);
      expect(stepsOf(call, 'not')[0][2]).toBe('is');
    }
    expect(state.calls.map((call) => stepsOf(call, 'not')[0][1]).sort()).toEqual(['core_types', 'gym_type']);
  });

  it('reads a null count as zero', async () => {
    state.respond = respond({ count: null, error: null }, { count: null, error: null });
    await expect(getSeasonTypeAssignmentCounts('s1')).resolves.toEqual({ gymTyped: 0, cored: 0 });
  });

  it('rethrows the error of either count', async () => {
    const failure = new Error('gym failed');
    state.respond = respond({ count: null, error: failure }, { count: 1, error: null });
    await expect(getSeasonTypeAssignmentCounts('s1')).rejects.toBe(failure);
    const other = new Error('core failed');
    state.respond = respond({ count: 1, error: null }, { count: null, error: other });
    await expect(getSeasonTypeAssignmentCounts('s1')).rejects.toBe(other);
  });
});
