/**
 * `toDraftRuleError` / `callDraftRpc` (draft-backend §7.8, §14.1; B-SNAP). No DB:
 * the Supabase client is a stub whose `rpc` answers what each test sets.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown }, calls: [] as unknown[][] }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc(this: unknown, fn: string, args: Record<string, unknown>) {
      rpc.calls.push([fn, args, this]);
      return Promise.resolve(rpc.result);
    },
  },
}));

import { supabase } from '@/lib/supabase/client';
import { callDraftRpc, toDraftRuleError } from '@/lib/draft/rpc-errors';
import { DraftRuleError, draftErrorMessage } from '@/lib/draft/errors';

const pgError = (message: string, details: unknown = null, code = 'P0001') => ({ code, message, details, hint: null });

beforeEach(() => {
  rpc.result = { data: null, error: null };
  rpc.calls = [];
});

describe('toDraftRuleError', () => {
  it('maps P0001 + DETAIL: placeholder keys become params, the rest detail', () => {
    const err = toDraftRuleError(
      pgError('BUDGET_INFEASIBLE', JSON.stringify({ shortfall: 2, slots: 1, remaining_after: 8, min_cost: 10 })),
    );
    expect(err).toBeInstanceOf(DraftRuleError);
    expect(err?.code).toBe('BUDGET_INFEASIBLE');
    expect(err?.params).toEqual({ shortfall: 2, slots: 1 });
    expect(err?.detail).toEqual({ remaining_after: 8, min_cost: 10 });
    expect(err?.statusCode).toBe(422);
    expect(err?.message).toBe(draftErrorMessage('BUDGET_INFEASIBLE', { shortfall: 2, slots: 1 }));
  });

  it('keeps machine data out of params (STALE_SLOT has no placeholders)', () => {
    const err = toDraftRuleError(
      pgError('STALE_SLOT', JSON.stringify({ current_slot_id: 'slot-9', current_player_id: 'p2' })),
    );
    expect(err?.code).toBe('STALE_SLOT');
    expect(err?.params).toBeUndefined();
    expect(err?.detail).toEqual({ current_slot_id: 'slot-9', current_player_id: 'p2' });
    expect(err?.statusCode).toBe(409);
  });

  it('accepts a code without DETAIL and drops non-scalar detail values', () => {
    expect(toDraftRuleError(pgError('NOT_YOUR_TURN'))?.detail).toBeUndefined();
    const err = toDraftRuleError(pgError('DRAFT_PAUSED', JSON.stringify({ reason: 'admin', nested: { a: 1 }, n: null })));
    expect(err?.detail).toEqual({ reason: 'admin' });
  });

  it('tolerates DETAIL that is not a JSON object', () => {
    expect(toDraftRuleError(pgError('NOT_IN_LIST', 'not json'))?.code).toBe('NOT_IN_LIST');
    expect(toDraftRuleError(pgError('NOT_IN_LIST', '[1,2]'))?.detail).toBeUndefined();
  });

  it('returns null for internal invariant codes and unknown messages', () => {
    expect(toDraftRuleError(pgError('THRESHOLDS_REQUIRED'))).toBeNull();
    expect(toDraftRuleError(pgError('ACTIVE_SLOT_EXISTS'))).toBeNull();
    expect(toDraftRuleError(pgError('SOMETHING_ELSE'))).toBeNull();
  });

  it('returns null for other SQLSTATEs and non-errors', () => {
    expect(toDraftRuleError(pgError('NOT_IN_LIST', null, '23505'))).toBeNull();
    expect(toDraftRuleError(new Error('NOT_IN_LIST'))).toBeNull();
    expect(toDraftRuleError(null)).toBeNull();
    expect(toDraftRuleError('NOT_IN_LIST')).toBeNull();
  });
});

describe('callDraftRpc', () => {
  it('calls supabase.rpc on the client and returns the data', async () => {
    rpc.result = { data: { ok: true }, error: null };
    await expect(callDraftRpc('draft_tick', { p_pool_id: 'pool-1' })).resolves.toEqual({ ok: true });
    expect(rpc.calls).toEqual([['draft_tick', { p_pool_id: 'pool-1' }, supabase]]);
  });

  it('throws a DraftRuleError for a rule violation', async () => {
    rpc.result = { data: null, error: pgError('LINE_TAKEN', JSON.stringify({ line_id: 'a--b', player_id: 'p2' })) };
    const err = await callDraftRpc('draft_confirm_pick', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DraftRuleError);
    expect((err as DraftRuleError).detail).toEqual({ line_id: 'a--b', player_id: 'p2' });
  });

  it('rethrows non-P0001 and internal errors unchanged', async () => {
    const unique = pgError('duplicate key', null, '23505');
    rpc.result = { data: null, error: unique };
    await expect(callDraftRpc('draft_confirm_pick', {})).rejects.toBe(unique);

    const internal = pgError('THRESHOLDS_REQUIRED');
    rpc.result = { data: null, error: internal };
    await expect(callDraftRpc('draft_confirm_pick', {})).rejects.toBe(internal);
  });
});
