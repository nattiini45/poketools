/**
 * The live-format reads: every one is scoped to the league (a check id of another league is null), a malformed id answers
 * empty without a request, lists page and report the total, and the play state names the two flags a write gate reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Step = [string, ...unknown[]];

const state = vi.hoisted(() => ({
  calls: [] as { table: string; steps: Step[] }[],
  respond: null as null | ((call: { table: string; steps: Step[] }) => { data?: unknown; error?: unknown; count?: number | null }),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, steps: [] as Step[] };
      state.calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'neq', 'order', 'range', 'maybeSingle']) {
        chain[name] = (...args: unknown[]) => {
          call.steps.push([name, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null, count: null, ...(state.respond?.(call) ?? {}) });
      return chain;
    },
  },
}));

import { getFormatCheck, getSeasonPlayState, listFiredFormatEvents, listFormatAdjustments, listFormatChecks } from '../format-runtime-reads';

const SEASON = '3f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5b';
const CHECK = '7f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5f';
const stepsOf = (call: { steps: Step[] }, name: string) => call.steps.filter(([step]) => step === name);

beforeEach(() => {
  state.calls.length = 0;
  state.respond = null;
});

describe('listFiredFormatEvents', () => {
  it('reads the league event log without the per-match events, oldest first, in one paged request', async () => {
    const rows = [{ event_key: 'stage_start:swiss', event: 'stage_start', payload: {}, ops: [] }];
    state.respond = () => ({ data: rows });

    await expect(listFiredFormatEvents(SEASON)).resolves.toEqual(rows);

    expect(state.calls).toHaveLength(1);
    const [call] = state.calls;
    expect(call.table).toBe('format_event_log');
    expect(stepsOf(call, 'select')).toEqual([['select', 'event_key, event, payload, ops']]);
    expect(stepsOf(call, 'eq')).toEqual([['eq', 'season_id', SEASON]]);
    expect(stepsOf(call, 'neq')).toEqual([['neq', 'event', 'match_completed']]);
    expect(stepsOf(call, 'order')).toEqual([['order', 'fired_at'], ['order', 'event_key']]);
    expect(stepsOf(call, 'range')).toEqual([['range', 0, 999]]);
  });

  it('answers empty for a malformed league id without a request', async () => {
    await expect(listFiredFormatEvents('not-a-uuid')).resolves.toEqual([]);
    expect(state.calls).toHaveLength(0);
  });

  it('rethrows a failed read', async () => {
    state.respond = () => ({ data: null, error: { message: 'boom' } });
    await expect(listFiredFormatEvents(SEASON)).rejects.toMatchObject({ message: 'boom' });
  });
});

describe('getFormatCheck', () => {
  it('reads one check of the league, filtered by both ids', async () => {
    state.respond = () => ({ data: { id: CHECK, season_id: SEASON } });
    await expect(getFormatCheck(SEASON, CHECK)).resolves.toMatchObject({ id: CHECK });
    const [call] = state.calls;
    expect(call.table).toBe('format_checks');
    expect(stepsOf(call, 'eq')).toEqual([
      ['eq', 'season_id', SEASON],
      ['eq', 'id', CHECK],
    ]);
  });

  it('is null for a check of another league (the season filter matches nothing)', async () => {
    state.respond = () => ({ data: null });
    await expect(getFormatCheck('4f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5c', CHECK)).resolves.toBeNull();
  });

  it('answers null for a malformed id, without a request, and throws a failed read', async () => {
    await expect(getFormatCheck('nope', CHECK)).resolves.toBeNull();
    await expect(getFormatCheck(SEASON, 'nope')).resolves.toBeNull();
    expect(state.calls).toEqual([]);
    state.respond = () => ({ data: null, error: new Error('boom') });
    await expect(getFormatCheck(SEASON, CHECK)).rejects.toThrow('boom');
  });
});

describe('listFormatChecks', () => {
  it('pages the open checks of the league newest first and reports the total', async () => {
    state.respond = () => ({ data: [{ id: 'a' }, { id: 'b' }], count: 7 });
    const page = await listFormatChecks(SEASON, { status: 'open', limit: 2, offset: 4 });
    expect(page).toEqual({ rows: [{ id: 'a' }, { id: 'b' }], total: 7 });
    const [call] = state.calls;
    expect(call.table).toBe('format_checks');
    expect(stepsOf(call, 'select')).toEqual([['select', '*', { count: 'exact' }]]);
    expect(stepsOf(call, 'eq')).toEqual([
      ['eq', 'season_id', SEASON],
      ['eq', 'status', 'open'],
    ]);
    expect(stepsOf(call, 'order')).toEqual([
      ['order', 'opened_at', { ascending: false }],
      ['order', 'id'],
    ]);
    expect(stepsOf(call, 'range')).toEqual([['range', 4, 5]]);
  });

  it('does not filter on the state for "all"', async () => {
    await listFormatChecks(SEASON, { status: 'all', limit: 50, offset: 0 });
    expect(stepsOf(state.calls[0], 'eq')).toEqual([['eq', 'season_id', SEASON]]);
  });

  it('clamps an out-of-range page', async () => {
    await listFormatChecks(SEASON, { status: 'all', limit: 5000, offset: -3 });
    await listFormatChecks(SEASON, { status: 'all', limit: 0, offset: 2.9 });
    expect(stepsOf(state.calls[0], 'range')).toEqual([['range', 0, 99]]);
    expect(stepsOf(state.calls[1], 'range')).toEqual([['range', 2, 2]]);
  });

  it('answers an empty page for a malformed league id, without a request', async () => {
    await expect(listFormatChecks('nope', { status: 'open', limit: 10, offset: 0 })).resolves.toEqual({ rows: [], total: 0 });
    expect(state.calls).toEqual([]);
  });

  it('answers an empty page with the real total when the offset is past the last row (PGRST103)', async () => {
    state.respond = (call) =>
      stepsOf(call, 'range').length > 0
        ? { data: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' } }
        : { data: null, count: 3 };
    await expect(listFormatChecks(SEASON, { status: 'open', limit: 20, offset: 20 })).resolves.toEqual({ rows: [], total: 3 });
    expect(state.calls).toHaveLength(2);
    const recount = state.calls[1];
    expect(recount.table).toBe('format_checks');
    expect(stepsOf(recount, 'select')).toEqual([['select', 'id', { count: 'exact', head: true }]]);
    expect(stepsOf(recount, 'eq')).toEqual([
      ['eq', 'season_id', SEASON],
      ['eq', 'status', 'open'],
    ]);
    expect(stepsOf(recount, 'range')).toHaveLength(0);
  });

  it('rethrows an error from the recount, and any other error of the page read', async () => {
    const boom = { message: 'count failed' };
    state.respond = (call) =>
      stepsOf(call, 'range').length > 0 ? { data: null, error: { code: 'PGRST103', message: 'range' } } : { data: null, error: boom };
    await expect(listFormatChecks(SEASON, { status: 'all', limit: 10, offset: 5000 })).rejects.toBe(boom);
    state.calls.length = 0;
    const other = { code: '57014', message: 'timeout' };
    state.respond = () => ({ data: null, error: other });
    await expect(listFormatChecks(SEASON, { status: 'all', limit: 10, offset: 0 })).rejects.toBe(other);
    expect(state.calls).toHaveLength(1);
  });

  it('falls back to the page length when the count is missing, and throws a failed read', async () => {
    state.respond = () => ({ data: [{ id: 'a' }], count: null });
    await expect(listFormatChecks(SEASON, { status: 'all', limit: 10, offset: 0 })).resolves.toMatchObject({ total: 1 });
    state.respond = () => ({ data: null, error: new Error('boom') });
    await expect(listFormatChecks(SEASON, { status: 'all', limit: 10, offset: 0 })).rejects.toThrow('boom');
  });
});

describe('listFormatAdjustments', () => {
  it('pages the league’s history newest first', async () => {
    state.respond = () => ({ data: [{ id: 'a' }], count: 31 });
    await expect(listFormatAdjustments(SEASON, { limit: 25, offset: 25 })).resolves.toEqual({ rows: [{ id: 'a' }], total: 31 });
    const [call] = state.calls;
    expect(call.table).toBe('format_adjustments');
    expect(stepsOf(call, 'eq')).toEqual([['eq', 'season_id', SEASON]]);
    expect(stepsOf(call, 'order')).toEqual([
      ['order', 'created_at', { ascending: false }],
      ['order', 'id'],
    ]);
    expect(stepsOf(call, 'range')).toEqual([['range', 25, 49]]);
  });

  it('answers an empty page with the real total when the offset is past the last row (PGRST103)', async () => {
    state.respond = (call) =>
      stepsOf(call, 'range').length > 0
        ? { data: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' } }
        : { data: null, count: 3 };
    await expect(listFormatAdjustments(SEASON, { limit: 25, offset: 50 })).resolves.toEqual({ rows: [], total: 3 });
    expect(state.calls).toHaveLength(2);
    const recount = state.calls[1];
    expect(recount.table).toBe('format_adjustments');
    expect(stepsOf(recount, 'select')).toEqual([['select', 'id', { count: 'exact', head: true }]]);
    expect(stepsOf(recount, 'eq')).toEqual([['eq', 'season_id', SEASON]]);
    expect(stepsOf(recount, 'range')).toHaveLength(0);
  });

  it('rethrows an error from the recount, and any other error of the page read', async () => {
    const boom = { message: 'count failed' };
    state.respond = (call) =>
      stepsOf(call, 'range').length > 0 ? { data: null, error: { code: 'PGRST103', message: 'range' } } : { data: null, error: boom };
    await expect(listFormatAdjustments(SEASON, { limit: 25, offset: 5000 })).rejects.toBe(boom);
    state.calls.length = 0;
    const other = { code: '57014', message: 'timeout' };
    state.respond = () => ({ data: null, error: other });
    await expect(listFormatAdjustments(SEASON, { limit: 25, offset: 0 })).rejects.toBe(other);
    expect(state.calls).toHaveLength(1);
  });

  it('answers an empty page for a malformed league id', async () => {
    await expect(listFormatAdjustments('nope', { limit: 25, offset: 0 })).resolves.toEqual({ rows: [], total: 0 });
    expect(state.calls).toEqual([]);
  });
});

describe('getSeasonPlayState', () => {
  it('names the status and the archive flag of the league', async () => {
    state.respond = () => ({ data: { status: 'active', archived: false, name: 'ignored' } });
    await expect(getSeasonPlayState(SEASON)).resolves.toEqual({ status: 'active', archived: false });
    const [call] = state.calls;
    expect(call.table).toBe('seasons');
    expect(stepsOf(call, 'select')).toEqual([['select', 'status, archived']]);
    expect(stepsOf(call, 'eq')).toEqual([['eq', 'id', SEASON]]);
  });

  it('is null for an unknown league and for a malformed id (no request)', async () => {
    state.respond = () => ({ data: null });
    await expect(getSeasonPlayState(SEASON)).resolves.toBeNull();
    state.calls.length = 0;
    await expect(getSeasonPlayState('nope')).resolves.toBeNull();
    expect(state.calls).toEqual([]);
  });
});
