import { beforeEach, describe, expect, it, vi } from 'vitest';

// A chainable, awaitable query builder: every call is recorded and awaiting the
// chain resolves with the next queued result.
const h = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const results: { data: unknown; error: unknown }[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'in', 'eq', 'neq', 'order', 'limit', 'range', 'insert']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(results.shift() ?? { data: [], error: null }).then(resolve, reject);
  return { calls, results, builder };
});

vi.mock('../../client', () => ({ supabase: h.builder }));

import {
  addSeasonParticipants,
  listCloneSourceOptions,
  listSeasonParticipantIds,
  CLONE_SOURCE_LIMIT,
} from '../season-clone';

const called = (method: string) => h.calls.filter((c) => c.method === method);

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `League ${id}`,
    format_type: 'singles',
    status: 'completed',
    archived: true,
    is_test_season: false,
    ruleset_id: null,
    route_theme: 'auto',
    language: 'de',
    description: '',
    tournaments: [{ count: 3 }],
    season_participants: [{ count: 8 }],
    ...extra,
  };
}

beforeEach(() => {
  h.calls.length = 0;
  h.results.length = 0;
});

describe('listCloneSourceOptions', () => {
  it('reads newest first, bounded to 100, with embedded counts and no scope filter for null', async () => {
    h.results.push({ data: [row('a'), row('b')], error: null });

    const options = await listCloneSourceOptions(null);

    expect(called('from')[0].args).toEqual(['seasons']);
    expect(called('in')).toEqual([]);
    expect(called('order')[0].args).toEqual(['created_at', { ascending: false }]);
    expect(called('limit')[0].args).toEqual([CLONE_SOURCE_LIMIT]);
    expect(CLONE_SOURCE_LIMIT).toBe(100);
    const select = called('select')[0].args[0] as string;
    expect(select).toContain('tournaments ( count )');
    expect(select).toContain('season_participants ( count )');
    expect(select).not.toContain('players');
    expect(options.map((o) => [o.id, o.phase_count, o.participant_count])).toEqual([
      ['a', 3, 8],
      ['b', 3, 8],
    ]);
  });

  it('leaves custom-format leagues out in the query, so they do not use up a bounded row', async () => {
    h.results.push({ data: [row('a')], error: null });

    await listCloneSourceOptions(null);

    expect(called('neq')).toHaveLength(1);
    expect(called('neq')[0].args).toEqual(['format_type', 'custom']);
  });

  it('scopes to the given ids with .in(id, ids)', async () => {
    h.results.push({ data: [row('a')], error: null });

    await listCloneSourceOptions(['a', 'z']);

    expect(called('in')).toHaveLength(1);
    expect(called('in')[0].args).toEqual(['id', ['a', 'z']]);
  });

  it('returns an empty list for an empty scope without a query', async () => {
    expect(await listCloneSourceOptions([])).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it('keeps archived and test leagues and falls back to the default language', async () => {
    h.results.push({
      data: [row('t', { is_test_season: true, language: 'fr', tournaments: [], season_participants: null })],
      error: null,
    });

    const [option] = await listCloneSourceOptions(null);

    expect(option).toMatchObject({
      archived: true,
      is_test_season: true,
      language: 'de',
      phase_count: 0,
      participant_count: 0,
    });
  });

  it('exposes only the lean option keys', async () => {
    h.results.push({ data: [row('a')], error: null });

    const [option] = await listCloneSourceOptions(null);

    expect(Object.keys(option).sort()).toEqual(
      [
        'archived',
        'description',
        'format_type',
        'id',
        'is_test_season',
        'language',
        'name',
        'participant_count',
        'phase_count',
        'route_theme',
        'ruleset_id',
        'status',
      ].sort(),
    );
  });

  it('rethrows a query error', async () => {
    const failure = new Error('db down');
    h.results.push({ data: null, error: failure });

    await expect(listCloneSourceOptions(null)).rejects.toBe(failure);
  });
});

describe('listSeasonParticipantIds', () => {
  it('pages with a stable order until a short page', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ player_id: `p${i}` }));
    h.results.push({ data: full, error: null }, { data: [{ player_id: 'last' }], error: null });

    const ids = await listSeasonParticipantIds('s1');

    expect(ids).toHaveLength(1001);
    expect(ids[1000]).toBe('last');
    expect(called('eq')[0].args).toEqual(['season_id', 's1']);
    expect(called('order')[0].args).toEqual(['player_id']);
    expect(called('range').map((c) => c.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('reads one page for a small roster', async () => {
    h.results.push({ data: [{ player_id: 'a' }], error: null });

    expect(await listSeasonParticipantIds('s1')).toEqual(['a']);
    expect(called('range')).toHaveLength(1);
  });

  it('throws the query error', async () => {
    const failure = new Error('db down');
    h.results.push({ data: null, error: failure });

    await expect(listSeasonParticipantIds('s1')).rejects.toBe(failure);
  });
});

describe('addSeasonParticipants', () => {
  it('writes nothing for an empty list', async () => {
    await addSeasonParticipants('s1', []);
    expect(h.calls).toEqual([]);
  });

  it('inserts membership rows only, in chunks of 500', async () => {
    const ids = Array.from({ length: 1201 }, (_, i) => `p${i}`);

    await addSeasonParticipants('s1', ids);

    const inserts = called('insert').map((c) => c.args[0] as { season_id: string; player_id: string }[]);
    expect(inserts.map((rows) => rows.length)).toEqual([500, 500, 201]);
    expect(inserts[0][0]).toEqual({ season_id: 's1', player_id: 'p0' });
    expect(inserts[2][200]).toEqual({ season_id: 's1', player_id: 'p1200' });
    expect(Object.keys(inserts[0][0]).sort()).toEqual(['player_id', 'season_id']);
    expect(called('from').every((c) => c.args[0] === 'season_participants')).toBe(true);
  });

  it('throws on an insert error and stops', async () => {
    const failure = new Error('insert failed');
    h.results.push({ data: null, error: null }, { data: null, error: failure });
    const ids = Array.from({ length: 1200 }, (_, i) => `p${i}`);

    await expect(addSeasonParticipants('s1', ids)).rejects.toBe(failure);
    expect(called('insert')).toHaveLength(2);
  });
});
