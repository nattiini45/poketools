/**
 * `getStagesBySeasonIds`: the batched phase read behind the Format Studio list. Ids go in chunks of 50, every
 * chunk is paged with `.range()` until a short page (PostgREST truncates silently at 1000 rows), an empty id list
 * makes no request, a league without phases maps to an empty list, and errors are rethrown.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
  table: string;
  steps: [string, ...unknown[]][];
}

const state = vi.hoisted(() => ({
  calls: [] as { table: string; steps: [string, ...unknown[]][] }[],
  respond: null as null | ((call: { table: string; steps: [string, ...unknown[]][] }) => { data: unknown; error: unknown }),
}));

vi.mock('@/lib/supabase/client', () => {
  function builder(table: string) {
    const call: Call = { table, steps: [] };
    state.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'in', 'order', 'range', 'eq']) {
      chain[name] = (...args: unknown[]) => {
        call.steps.push([name, ...args]);
        return chain;
      };
    }
    chain.then = (resolve: (value: unknown) => unknown) => resolve(state.respond?.(call) ?? { data: [], error: null });
    return chain;
  }
  return { supabase: { from: builder } };
});

import { getStagesBySeasonIds } from '../tournaments';

function stageRow(id: string, seasonId: string, order = 0) {
  return {
    id,
    name: `Stage ${id}`,
    description: '',
    season_id: seasonId,
    bracket_type: 'round_robin',
    ruleset_id: 'rs1',
    best_of_default: 3,
    bo_overrides: { Finals: 5 },
    is_doubles: false,
    team_visibility: 'always_public',
    status: 'upcoming',
    current_round: 0,
    stage_order: order,
    advancement_rule: { type: 'top_n', count: 2, per_group: true },
    enrollment_source: null,
    archived: false,
    legacy: false,
    bracket_reset_enabled: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    rulesets: { name: 'Ruleset One' },
    seasons: { name: 'League' },
    tournament_participants: [{ count: 8 }],
  };
}

const stepsOf = (call: Call, name: string) => call.steps.filter(([step]) => step === name);
const ids = (n: number, prefix = 's') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

beforeEach(() => {
  state.calls.length = 0;
  state.respond = null;
});

describe('getStagesBySeasonIds', () => {
  it('makes no request for an empty id list', async () => {
    const result = await getStagesBySeasonIds([]);
    expect(result.size).toBe(0);
    expect(state.calls).toHaveLength(0);
  });

  it('reads 120 ids in chunks of 50, 50 and 20 with .in(season_id, chunk)', async () => {
    await getStagesBySeasonIds(ids(120));
    expect(state.calls).toHaveLength(3);
    const sizes = state.calls.map((call) => (stepsOf(call, 'in')[0][2] as string[]).length);
    expect(sizes).toEqual([50, 50, 20]);
    for (const call of state.calls) {
      expect(call.table).toBe('tournaments');
      expect(stepsOf(call, 'in')[0][1]).toBe('season_id');
    }
  });

  it('reads a duplicated id once', async () => {
    const result = await getStagesBySeasonIds(['a', 'b', 'a']);
    expect(state.calls).toHaveLength(1);
    expect(stepsOf(state.calls[0], 'in')[0][2]).toEqual(['a', 'b']);
    expect([...result.keys()]).toEqual(['a', 'b']);
  });

  it('orders by league, phase order, creation and id, with the same select as the single-league read', async () => {
    await getStagesBySeasonIds(['a']);
    const call = state.calls[0];
    expect(stepsOf(call, 'order').map(([, column]) => column)).toEqual(['season_id', 'stage_order', 'created_at', 'id']);
    const select = String(stepsOf(call, 'select')[0][1]);
    expect(select).toContain('rulesets:ruleset_definition_versions ( name:name_text )');
    expect(select).toContain('seasons ( name )');
    expect(select).toContain('tournament_participants ( count )');
  });

  it('builds no or() or ilike() filter and no string from the ids', async () => {
    await getStagesBySeasonIds(['a']);
    const used = state.calls.flatMap((call) => call.steps.map(([step]) => step));
    expect(used).not.toContain('or');
    expect(used).not.toContain('ilike');
    expect(JSON.stringify(state.calls[0].steps)).not.toContain('season_id.in.');
  });

  it('pages past 1000 rows until a short page', async () => {
    state.respond = (call) => {
      const [from] = stepsOf(call, 'range')[0].slice(1) as [number, number];
      if (from === 0) return { data: Array.from({ length: 1000 }, (_, i) => stageRow(`t${i}`, 'a')), error: null };
      if (from === 1000) return { data: Array.from({ length: 1000 }, (_, i) => stageRow(`u${i}`, 'a')), error: null };
      return { data: [stageRow('last', 'a')], error: null };
    };
    const result = await getStagesBySeasonIds(['a']);
    expect(state.calls.map((call) => stepsOf(call, 'range')[0].slice(1))).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(result.get('a')).toHaveLength(2001);
  });

  it('stops after one request when the first page is short', async () => {
    state.respond = () => ({ data: [stageRow('t1', 'a')], error: null });
    await getStagesBySeasonIds(['a']);
    expect(state.calls).toHaveLength(1);
  });

  it('groups the phases by league in read order and maps them like getStagesBySeasonId', async () => {
    state.respond = () => ({
      data: [stageRow('t1', 'a', 0), stageRow('t2', 'a', 1), stageRow('t3', 'b', 0)],
      error: null,
    });
    const result = await getStagesBySeasonIds(['a', 'b', 'empty']);
    expect(result.get('a')?.map((s) => s.id)).toEqual(['t1', 't2']);
    expect(result.get('b')?.map((s) => s.id)).toEqual(['t3']);
    expect(result.get('empty')).toEqual([]);
    expect(result.get('a')?.[0]).toMatchObject({
      bracket_type: 'round_robin',
      bo_overrides: { Finals: 5 },
      advancement_rule: { type: 'top_n', count: 2, per_group: true },
      ruleset_name: 'Ruleset One',
      season_name: 'League',
      participant_count: 8,
    });
  });

  it('rethrows a read error', async () => {
    const failure = { message: 'boom' };
    state.respond = () => ({ data: null, error: failure });
    await expect(getStagesBySeasonIds(['a'])).rejects.toBe(failure);
  });

  it('rethrows an error of a later chunk instead of returning a partial map', async () => {
    const failure = { message: 'second chunk' };
    state.respond = (call) => (stepsOf(call, 'in')[0][2] as string[]).includes('s60') ? { data: null, error: failure } : { data: [], error: null };
    await expect(getStagesBySeasonIds(ids(70))).rejects.toBe(failure);
  });
});
