import { beforeEach, describe, expect, it, vi } from 'vitest';

const q = vi.hoisted(() => {
  type Result = { data?: unknown; error: unknown; count?: number };
  const results: Result[] = [];
  const next = () => Promise.resolve(results.shift() ?? { data: null, error: null });
  const builder = {
    select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), update: vi.fn(), range: vi.fn(next),
    then: (resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) => next().then(resolve, reject),
  };
  for (const method of [builder.select, builder.eq, builder.in, builder.order, builder.update]) method.mockReturnValue(builder);
  return { results, builder, from: vi.fn(() => builder) };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: q.from } }));

import { getPhasePinStates, isVersionPhasePinned, listPhasePins, repinPhaseTarget, type PhasePinState } from '../phase-ruleset-pins';

const state: PhasePinState = {
  kind: 'phase', id: 'phase', season_id: 'league', ruleset_id: 'version', name: 'Native phase', status: 'active', archived: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  q.results.length = 0;
});

describe('native ruleset pin persistence', () => {
  it('does no read for empty phase/version lists', async () => {
    await expect(getPhasePinStates([])).resolves.toEqual([]);
    await expect(listPhasePins([])).resolves.toEqual([]);
    expect(q.from).not.toHaveBeenCalled();
  });

  it('reads complete native phase states without manufacturing tournament ownership', async () => {
    const { kind: _kind, ...row } = state;
    q.results.push({ data: [row], error: null }, { data: [], error: null });
    await expect(getPhasePinStates(['phase'])).resolves.toEqual([state]);
    expect(q.from).toHaveBeenCalledWith('league_phases');
    expect(q.builder.in).toHaveBeenCalledWith('id', ['phase']);
    expect(q.builder.range.mock.calls).toEqual([[0, 999], [1, 1000]]);
  });

  it('finds native pin usage by immutable version id', async () => {
    const { kind: _kind, ...row } = state;
    q.results.push({ data: [row], error: null }, { data: [], error: null });
    await expect(listPhasePins(['version'])).resolves.toEqual([state]);
    expect(q.builder.in).toHaveBeenCalledWith('ruleset_id', ['version']);
  });

  it('guards a native move by the captured version, phase status and archive state', async () => {
    q.results.push({ data: [{ id: state.id }], error: null });
    await expect(repinPhaseTarget(state, 'new-version')).resolves.toBe(true);
    expect(q.builder.update).toHaveBeenCalledWith({ ruleset_id: 'new-version' });
    for (const pair of [['id', state.id], ['ruleset_id', state.ruleset_id], ['status', state.status], ['archived', false]]) {
      expect(q.builder.eq).toHaveBeenCalledWith(...pair);
    }
    q.results.push({ data: [], error: null });
    await expect(repinPhaseTarget(state, 'new-version')).resolves.toBe(false);
  });

  it('does not swallow reads or compare-and-set errors', async () => {
    for (const operation of [() => getPhasePinStates(['phase']), () => listPhasePins(['version']), () => repinPhaseTarget(state, 'new')]) {
      q.results.push({ error: new Error('pin failed') });
      await expect(operation()).rejects.toThrow('pin failed');
    }
  });

  it('counts exposure without reading phase names and fails closed', async () => {
    q.results.push({ count: 1, error: null }, { count: 0, error: null }, { error: new Error('exposure failed') });
    await expect(isVersionPhasePinned('version')).resolves.toBe(true);
    await expect(isVersionPhasePinned('version')).resolves.toBe(false);
    await expect(isVersionPhasePinned('version')).rejects.toThrow('exposure failed');
    expect(q.builder.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
  });
});
