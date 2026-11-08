/**
 * The format runtime queries: one read wave over the nine tables (each paged and ordered by a total order), the six
 * RPC wrappers with their exact arguments, and the database signals mapped to typed errors.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Step = [string, ...unknown[]];

const state = vi.hoisted(() => ({
  calls: [] as { table: string; steps: [string, ...unknown[]][] }[],
  rpcCalls: [] as { name: string; args: unknown }[],
  respond: null as null | ((call: { table: string; steps: [string, ...unknown[]][] }) => { data?: unknown; error?: unknown }),
  rpcReply: null as null | { data?: unknown; error?: unknown },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, steps: [] as [string, ...unknown[]][] };
      state.calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'order', 'range']) {
        chain[name] = (...args: unknown[]) => {
          call.steps.push([name, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null, ...(state.respond?.(call) ?? {}) });
      return chain;
    },
    rpc: (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null, ...(state.rpcReply ?? {}) });
    },
  },
}));

import {
  FormatActionAlreadySubmittedError,
  FormatAdjustmentRefusedError,
  FormatRuntimeError,
  applyFormatAdjustment,
  fireFormatEvent,
  getFormatRuntime,
  mapFormatRuntimeDbError,
  openFormatCheck,
  resolveFormatCheck,
  saveFormatAction,
  submitFormatAction,
  type FormatOp,
} from '../format-runtime';
import { FormatStudioError } from '@/lib/format-studio/errors';
import { UserFacingError } from '@/lib/api/user-facing-error';

const SEASON = '3f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5b';
const P1 = '4f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5c';
const P2 = '5f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5d';
const stepsOf = (call: { steps: Step[] }, name: string) => call.steps.filter(([step]) => step === name);

beforeEach(() => {
  state.calls.length = 0;
  state.rpcCalls.length = 0;
  state.respond = null;
  state.rpcReply = null;
});

describe('getFormatRuntime', () => {
  it('reads the nine tables of the league in one wave, each with an order and a first page', async () => {
    const flag = { season_id: SEASON, key: 'action:pick', value: 'open', updated_at: 't' };
    state.respond = (call) => (call.table === 'format_flags' ? { data: [flag] } : {});

    const runtime = await getFormatRuntime(SEASON);

    expect(state.calls.map((c) => c.table).sort()).toEqual([
      'format_action_submissions',
      'format_adjustments',
      'format_checks',
      'format_event_log',
      'format_flags',
      'format_player_attrs',
      'format_relation_links',
      'format_resource_items',
      'format_track_progress',
    ]);
    for (const call of state.calls) {
      expect(stepsOf(call, 'eq'), call.table).toEqual([['eq', 'season_id', SEASON]]);
      expect(stepsOf(call, 'order').length, call.table).toBeGreaterThan(0);
      expect(stepsOf(call, 'range'), call.table).toEqual([['range', 0, 999]]);
    }
    expect(runtime.flags).toEqual([flag]);
    expect(runtime.relationLinks).toEqual([]);
  });

  it('pages a table past 1,000 rows until a short page', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: String(i) }));
    let served = 0;
    state.respond = (call) => {
      if (call.table !== 'format_adjustments') return {};
      served += 1;
      return { data: served === 1 ? full : [{ id: 'last' }] };
    };

    const runtime = await getFormatRuntime(SEASON);

    expect(runtime.adjustments).toHaveLength(1001);
    const ranges = state.calls.filter((c) => c.table === 'format_adjustments').map((c) => stepsOf(c, 'range')[0]);
    expect(ranges).toEqual([['range', 0, 999], ['range', 1000, 1999]]);
  });

  it('returns an empty runtime for an id that is not a uuid, without a request', async () => {
    const runtime = await getFormatRuntime('nope');
    expect(state.calls).toEqual([]);
    expect(runtime.eventLog).toEqual([]);
  });

  it('throws a failed read', async () => {
    state.respond = (call) => (call.table === 'format_checks' ? { error: { message: 'boom' } } : {});
    await expect(getFormatRuntime(SEASON)).rejects.toEqual({ message: 'boom' });
  });
});

describe('the RPC wrappers', () => {
  const ops: FormatOp[] = [
    { op: 'set_flag', key: 'domain:gifts', value: 'unlocked' },
    { op: 'grant_item', resource: 'gift', player_id: P1, item_id: 'pikachu', amount: 1, exclusive: true, source: 'event', source_ref: null },
  ];

  it('fireFormatEvent passes the key, the ops, a NULL actor and the revision it was planned from, and returns the boolean', async () => {
    state.rpcReply = { data: true };
    await expect(
      fireFormatEvent({ seasonId: SEASON, eventKey: 'stage_start:main', event: 'stage_start', payload: { stage: 'main' }, ops, firedBy: null, revision: 41 }),
    ).resolves.toBe(true);
    expect(state.rpcCalls).toEqual([
      {
        name: 'format_fire_event_notify',
        args: {
          p_season_id: SEASON, p_event_key: 'stage_start:main', p_event: 'stage_start', p_payload: { stage: 'main' }, p_ops: ops,
          p_fired_by: null, p_expected_revision: 41, p_notifications: [],
        },
      },
    ]);

    state.rpcReply = { data: false };
    await expect(
      fireFormatEvent({ seasonId: SEASON, eventKey: 'stage_start:main', event: 'stage_start', payload: {}, ops: [], firedBy: P1, revision: 41 }),
    ).resolves.toBe(false);
  });

  it('fireFormatEvent hands the planned notices over and drops the ones without a recipient', async () => {
    state.rpcReply = { data: true };
    const message = { base: 'en' as const, en: { v: 'Hi', s: 'human' as const } };
    const told = { message, players: [P1], rule: 'r', effect: 2 };
    await fireFormatEvent({
      seasonId: SEASON, eventKey: 'stage_start:main', event: 'stage_start', payload: {}, ops: [], firedBy: null, revision: 3,
      notifications: [told, { message, players: [], rule: 'r', effect: 3 }],
    });
    expect((state.rpcCalls.at(-1) as { args: { p_notifications: unknown } }).args.p_notifications).toEqual([told]);
  });

  it('fireFormatEvent and applyFormatAdjustment raise format_context_stale as a typed 409 error', async () => {
    state.rpcReply = { error: { code: 'P0001', message: 'format_context_stale', details: null } };
    await expect(
      fireFormatEvent({ seasonId: SEASON, eventKey: 'stage_start:main', event: 'stage_start', payload: {}, ops: [], firedBy: null, revision: 1 }),
    ).rejects.toMatchObject({ name: 'FormatRuntimeError', code: 'format_context_stale', statusCode: 409 });
    await expect(
      applyFormatAdjustment({ seasonId: SEASON, kind: 'points', target: {}, delta: {}, reason: 'r', adminId: P1, ops: [], guardActions: [], revision: 1 }),
    ).rejects.toMatchObject({ name: 'FormatRuntimeError', code: 'format_context_stale', statusCode: 409 });
  });

  it('saveFormatAction and submitFormatAction return the submission row', async () => {
    const row = { id: 'sub', status: 'draft' };
    state.rpcReply = { data: row };
    await expect(saveFormatAction({ seasonId: SEASON, actionKey: 'pick', actorId: P1, targetId: P2, picks: [{ item_id: 'x' }], revision: 41 })).resolves.toBe(row);
    await expect(
      submitFormatAction({
        seasonId: SEASON, actionKey: 'pick', actorId: P1, targetId: null, picks: [], lock: true, revision: 41,
        items: [{ resource: 'gift', item_id: 'x', exclusive: true }],
      }),
    ).resolves.toBe(row);
    expect(state.rpcCalls).toEqual([
      { name: 'format_action_save', args: { p_season_id: SEASON, p_action_key: 'pick', p_actor: P1, p_target: P2, p_picks: [{ item_id: 'x' }], p_expected_revision: 41 } },
      {
        name: 'format_action_submit',
        args: {
          p_season_id: SEASON, p_action_key: 'pick', p_actor: P1, p_target: null, p_picks: [],
          p_items: [{ resource: 'gift', item_id: 'x', exclusive: true }], p_lock: true, p_expected_revision: 41,
        },
      },
    ]);
  });

  it('submitFormatAction asks the database to write only over a draft when told to, and leaves the argument out otherwise', async () => {
    state.rpcReply = { data: { id: 'sub' } };
    const base = { seasonId: SEASON, actionKey: 'pick', actorId: P1, targetId: null, picks: [], lock: false, items: [], revision: 7 };
    await submitFormatAction({ ...base, onlyIfUnsubmitted: true });
    await submitFormatAction({ ...base, onlyIfUnsubmitted: false });
    expect(state.rpcCalls[0].args).toMatchObject({ p_only_if_unsubmitted: true });
    expect(state.rpcCalls[1].args).not.toHaveProperty('p_only_if_unsubmitted');
  });

  it('submitFormatAction turns the database refusal action_already_submitted into a FormatActionAlreadySubmittedError', async () => {
    state.rpcReply = { error: { code: 'P0001', message: 'action_already_submitted', details: '{"action":"pick"}' } };
    const error = await submitFormatAction({
      seasonId: SEASON, actionKey: 'pick', actorId: P1, targetId: null, picks: [], lock: false, items: [], onlyIfUnsubmitted: true, revision: 7,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FormatActionAlreadySubmittedError);
    // The other signals still map, and a look-alike with another SQLSTATE is left alone.
    state.rpcReply = { error: { code: 'P0001', message: 'action_locked', details: '{}' } };
    await expect(
      submitFormatAction({ seasonId: SEASON, actionKey: 'pick', actorId: P1, targetId: null, picks: [], lock: false, items: [], revision: 7 }),
    ).rejects.toMatchObject({ code: 'action_locked' });
    const lookAlike = { code: '23505', message: 'action_already_submitted' };
    state.rpcReply = { error: lookAlike };
    await expect(
      submitFormatAction({ seasonId: SEASON, actionKey: 'pick', actorId: P1, targetId: null, picks: [], lock: false, items: [], revision: 7 }),
    ).rejects.toBe(lookAlike);
  });

  it('applyFormatAdjustment passes the guard actions and returns the id', async () => {
    state.rpcReply = { data: 'adj-1' };
    await expect(
      applyFormatAdjustment({
        seasonId: SEASON, kind: 'domain', target: { domain: 'gifts' }, delta: { add: ['x'] }, reason: 'typo', adminId: P1, ops, guardActions: ['pick'],
        revision: 41,
      }),
    ).resolves.toBe('adj-1');
    expect(state.rpcCalls[0]).toEqual({
      name: 'format_apply_adjustment',
      args: {
        p_season_id: SEASON, p_kind: 'domain', p_target: { domain: 'gifts' }, p_delta: { add: ['x'] }, p_reason: 'typo',
        p_admin: P1, p_ops: ops, p_guard_actions: ['pick'], p_expected_revision: 41,
      },
    });
  });

  it.each(['relation_has_links', 'insufficient_holding'] as const)('applyFormatAdjustment turns the database refusal %s into a FormatAdjustmentRefusedError', async (code) => {
    state.rpcReply = { error: { code: 'P0001', message: code, details: '{}' } };
    const error = await applyFormatAdjustment({
      seasonId: SEASON, kind: 'relation', target: {}, delta: {}, reason: 'draw', adminId: P1, ops, guardActions: [], revision: 41,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FormatAdjustmentRefusedError);
    expect(error).toMatchObject({ refusal: code });
  });

  it('applyFormatAdjustment still maps the other signals, and leaves a look-alike with another SQLSTATE alone', async () => {
    state.rpcReply = { error: { code: 'P0001', message: 'domain_amendment_locked', details: '{}' } };
    await expect(
      applyFormatAdjustment({ seasonId: SEASON, kind: 'domain', target: {}, delta: {}, reason: 'r', adminId: P1, ops, guardActions: ['pick'], revision: 41 }),
    ).rejects.toMatchObject({ code: 'domain_amendment_locked' });
    const lookAlike = { code: '23505', message: 'relation_has_links' };
    state.rpcReply = { error: lookAlike };
    await expect(
      applyFormatAdjustment({ seasonId: SEASON, kind: 'relation', target: {}, delta: {}, reason: 'r', adminId: P1, ops, guardActions: [], revision: 41 }),
    ).rejects.toBe(lookAlike);
  });

  it('openFormatCheck returns null for a duplicate, resolveFormatCheck the boolean', async () => {
    state.rpcReply = { data: null };
    await expect(openFormatCheck({ seasonId: SEASON, source: 'standings_tie', ruleId: 'tie', dedupeKey: 'tie:1', subject: {}, revision: 4 })).resolves.toBeNull();
    state.rpcReply = { data: 'chk-1' };
    await expect(openFormatCheck({ seasonId: SEASON, source: 'expr', ruleId: 'r', dedupeKey: 'r:1', subject: { a: 1 }, revision: 4 })).resolves.toBe('chk-1');
    state.rpcReply = { data: true };
    await expect(resolveFormatCheck({ seasonId: SEASON, checkId: 'chk-1', status: 'confirmed', adminId: null, note: null })).resolves.toBe(true);
    expect(state.rpcCalls.map((c) => c.name)).toEqual(['format_check_open', 'format_check_open', 'format_check_resolve']);
    // The league is part of the call: a check id of another league resolves nothing.
    expect(state.rpcCalls[2].args).toEqual({ p_season_id: SEASON, p_check_id: 'chk-1', p_status: 'confirmed', p_admin: null, p_note: null });
  });
});

describe('error mapping', () => {
  const signal = (message: string, code = 'P0001') => ({ code, message, details: JSON.stringify({ item_id: 'pikachu' }) });

  it.each([
    ['action_locked', 409],
    ['resource_item_taken', 409],
    ['resource_capacity_reached', 409],
    ['format_context_stale', 409],
    ['domain_amendment_locked', 409],
    ['reason_required', 400],
    ['reason_too_long', 400],
  ] as const)('maps %s to a FormatRuntimeError with that code', (code, status) => {
    const mapped = mapFormatRuntimeDbError(signal(code));
    expect(mapped).toBeInstanceOf(FormatRuntimeError);
    expect(mapped).toBeInstanceOf(UserFacingError);
    expect(mapped).toMatchObject({ code, statusCode: status });
    expect((mapped as Error).message.length).toBeGreaterThan(0);
  });

  it('maps the reason length constraint to reason_too_long (an op whose reason the planner did not measure)', () => {
    const violation = { code: '23514', message: 'new row for relation "format_adjustments" violates check constraint "format_adjustments_reason_length"' };
    expect(mapFormatRuntimeDbError(violation)).toMatchObject({ name: 'FormatRuntimeError', code: 'reason_too_long', statusCode: 400 });
    const other = { code: '23514', message: 'new row violates check constraint "format_checks_status_check"' };
    expect(mapFormatRuntimeDbError(other)).toBe(other);
  });

  it('throws the mapped error out of every wrapper', async () => {
    state.rpcReply = { error: signal('resource_item_taken') };
    await expect(
      submitFormatAction({ seasonId: SEASON, actionKey: 'pick', actorId: P1, targetId: null, picks: [], items: [], lock: false, revision: 7 }),
    ).rejects.toMatchObject({ code: 'resource_item_taken' });
    state.rpcReply = { error: signal('resource_capacity_reached') };
    await expect(
      submitFormatAction({ seasonId: SEASON, actionKey: 'pick', actorId: P1, targetId: null, picks: [], items: [], lock: false, revision: 7 }),
    ).rejects.toMatchObject({ code: 'resource_capacity_reached', statusCode: 409 });
    state.rpcReply = { error: signal('format_context_stale') };
    await expect(
      submitFormatAction({ seasonId: SEASON, actionKey: 'pick', actorId: P1, targetId: null, picks: [], items: [], lock: false, revision: 7 }),
    ).rejects.toMatchObject({ code: 'format_context_stale', statusCode: 409 });
    await expect(saveFormatAction({ seasonId: SEASON, actionKey: 'pick', actorId: P1, targetId: null, picks: [], revision: 7 })).rejects.toMatchObject({
      code: 'format_context_stale',
    });
    state.rpcReply = { error: signal('action_locked') };
    await expect(saveFormatAction({ seasonId: SEASON, actionKey: 'pick', actorId: P1, targetId: null, picks: [], revision: 7 })).rejects.toMatchObject({ code: 'action_locked' });
  });

  it('leaves other errors alone, and still maps the format-studio signals', () => {
    const other = signal('invalid_op');
    expect(mapFormatRuntimeDbError(other)).toBe(other);
    const plain = { code: '23505', message: 'duplicate key value violates unique constraint "x"' };
    expect(mapFormatRuntimeDbError(plain)).toBe(plain);
    expect(mapFormatRuntimeDbError(signal('action_locked', '23505'))).not.toBeInstanceOf(FormatRuntimeError);
    expect(mapFormatRuntimeDbError(signal('FORMAT_NOT_ATTACHED'))).toBeInstanceOf(FormatStudioError);
    expect(mapFormatRuntimeDbError('boom')).toBe('boom');
  });
});
