import { beforeEach, describe, expect, it, vi } from 'vitest';

const q = vi.hoisted(() => {
  type Result = { data?: unknown; error: unknown; count?: number | null };
  const results: Result[] = [];
  const next = () => Promise.resolve(results.shift() ?? { data: null, error: null });
  const builder = {
    select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), insert: vi.fn(), delete: vi.fn(),
    range: vi.fn(next), single: vi.fn(next), maybeSingle: vi.fn(next),
    then: (resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) => next().then(resolve, reject),
  };
  for (const method of [builder.select, builder.eq, builder.in, builder.order, builder.insert, builder.delete]) {
    method.mockReturnValue(builder);
  }
  return { results, builder, from: vi.fn(() => builder) };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: q.from } }));

import { addPhaseAdmin, getPhaseAdmins, getPhaseAdminScopeIds, hasPhaseAdminRole, isPhaseAdminFor, removePhaseAdmin } from '../phase-admins';

beforeEach(() => {
  vi.clearAllMocks();
  q.results.length = 0;
});

describe('phase administrator queries', () => {
  it('counts phase-only roles without selecting private player data and fails closed', async () => {
    q.results.push({ count: 1, error: null }, { count: 0, error: null }, { error: new Error('roles failed') });
    await expect(hasPhaseAdminRole('player')).resolves.toBe(true);
    await expect(hasPhaseAdminRole('player')).resolves.toBe(false);
    await expect(hasPhaseAdminRole('player')).rejects.toThrow('roles failed');
    expect(q.builder.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
  });
  it('denies an absent native phase without probing old tournament assignments', async () => {
    q.results.push({ data: null, error: null });
    await expect(isPhaseAdminFor('player', 'phase')).resolves.toBe(false);
    expect(q.from.mock.calls).toEqual([['league_phases']]);
  });

  it('accepts a direct assignment without reading legacy roles', async () => {
    q.results.push({ data: { season_id: 'league' }, error: null }, { count: 1, error: null });
    await expect(isPhaseAdminFor('player', 'phase')).resolves.toBe(true);
    expect(q.from.mock.calls).toEqual([['league_phases'], ['phase_admins']]);
    expect(q.builder.eq).toHaveBeenCalledWith('phase_id', 'phase');
    expect(q.builder.eq).toHaveBeenCalledWith('player_id', 'player');
  });

  it.each([0, 1])('cascades only the native parent league assignment (count %s)', async (count) => {
    q.results.push({ data: { season_id: 'league' }, error: null }, { count: 0, error: null }, { count, error: null });
    await expect(isPhaseAdminFor('player', 'phase')).resolves.toBe(count === 1);
    expect(q.builder.eq).toHaveBeenCalledWith('resource_type', 'season');
    expect(q.builder.eq).toHaveBeenCalledWith('resource_id', 'league');
    expect(q.from).not.toHaveBeenCalledWith('tournaments');
  });

  it.each([0, 1, 2])('propagates failure at authorization read %s', async (failedRead) => {
    const responses = [
      { data: { season_id: 'league' }, error: null }, { count: 0, error: null }, { count: 0, error: null },
    ];
    q.results.push(...responses.slice(0, failedRead), { error: new Error('roles failed') });
    await expect(isPhaseAdminFor('player', 'phase')).rejects.toThrow('roles failed');
  });

  it('pages complete assignments in a stable order', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `assignment-${i}`, phase_id: 'phase' }));
    q.results.push({ data: rows, error: null }, { data: [{ id: 'last', phase_id: 'phase' }], error: null });
    const result = await getPhaseAdmins('phase');
    expect(result).toHaveLength(1001);
    expect(q.builder.order).toHaveBeenCalledWith('id');
    expect(q.builder.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it('keeps phase assignments out of the legacy resource table', async () => {
    const assignment = { id: 'assignment', player_id: 'player', phase_id: 'phase', created_at: 'now' };
    q.results.push({ data: assignment, error: null }, { error: null });
    await expect(addPhaseAdmin('player', 'phase')).resolves.toEqual(assignment);
    await removePhaseAdmin('player', 'phase');
    expect(q.from.mock.calls).toEqual([['phase_admins'], ['phase_admins']]);
    expect(q.builder.insert).toHaveBeenCalledWith({ player_id: 'player', phase_id: 'phase' });
    expect(q.builder.delete).toHaveBeenCalledOnce();
  });

  it('returns empty native scope without a tournament lookup', async () => {
    q.results.push({ data: [], error: null }, { data: [], error: null });
    await expect(getPhaseAdminScopeIds('player')).resolves.toEqual({ seasonIds: [], phaseIds: [] });
    expect(q.from.mock.calls).toEqual([['phase_admins'], ['resource_admins']]);
  });

  it('unions direct and inherited phase ids without granting a phase admin its parent league', async () => {
    q.results.push(
      { data: [{ id: 'direct', phase_id: 'phase-1' }], error: null },
      { data: [{ id: 'league-admin', resource_id: 'league' }], error: null },
      { data: [], error: null }, { data: [], error: null },
      { data: [{ id: 'phase-1' }, { id: 'phase-2' }], error: null }, { data: [], error: null },
    );
    await expect(getPhaseAdminScopeIds('player')).resolves.toEqual({ seasonIds: ['league'], phaseIds: ['phase-1', 'phase-2'] });
    expect(q.builder.in).toHaveBeenCalledWith('season_id', ['league']);
    expect(q.from).not.toHaveBeenCalledWith('tournaments');
  });
});
