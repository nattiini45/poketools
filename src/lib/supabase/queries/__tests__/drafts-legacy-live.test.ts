/**
 * seasonHasLiveLegacyDraft (src/lib/supabase/queries/drafts.ts): the route-side twin of the database predicate
 * season__legacy_draft_live (20261102140000), one head count of the league's legacy pools in progress.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { chain, calls, state } = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const state: { result: { data: unknown; error: unknown; count?: number | null } } = { result: { data: null, error: null } };
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq']) {
    chain[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    };
  }
  chain.then = (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(state.result).then(resolve, reject);
  return { chain, calls, state };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: chain }));

import { seasonHasLiveLegacyDraft } from '../drafts';

beforeEach(() => {
  calls.length = 0;
  state.result = { data: null, error: null, count: 0 };
});

describe('seasonHasLiveLegacyDraft', () => {
  it('counts only the league\'s legacy pools whose status is in_progress, in one head query', async () => {
    state.result = { data: null, error: null, count: 1 };
    expect(await seasonHasLiveLegacyDraft('s-1')).toBe(true);
    expect(calls.filter((c) => c.method === 'from')).toEqual([{ method: 'from', args: ['draft_pools'] }]);
    expect(calls.find((c) => c.method === 'select')?.args).toEqual(['id', { count: 'exact', head: true }]);
    const filters = calls.filter((c) => c.method === 'eq').map((c) => c.args);
    expect(filters).toEqual(
      expect.arrayContaining([
        ['season_id', 's-1'],
        ['engine', 'legacy'],
        ['status', 'in_progress'],
      ]),
    );
  });

  it('is false when no pool matches', async () => {
    expect(await seasonHasLiveLegacyDraft('s-1')).toBe(false);
    state.result = { data: null, error: null, count: null };
    expect(await seasonHasLiveLegacyDraft('s-1')).toBe(false);
  });

  it('propagates a read error', async () => {
    const failure = new Error('boom');
    state.result = { data: null, error: failure, count: null };
    await expect(seasonHasLiveLegacyDraft('s-1')).rejects.toBe(failure);
  });
});
