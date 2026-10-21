/**
 * `getTokenGrants` reads the only grant type the database stores (draft_token). A row of any other
 * type breaks the CHECK epb_token_grants_no_kill_token invariant: the read fails loudly instead of
 * casting it into the result. No DB: a chain mock records the filters.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const state = { ops: [] as [string, unknown[]][], result: { data: [] as unknown[], error: null as unknown } };
  function from(table: string) {
    state.ops.push(['from', [table]]);
    const builder: Record<string, unknown> = {};
    for (const op of ['select', 'eq']) {
      builder[op] = (...args: unknown[]) => {
        state.ops.push([op, args]);
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(state.result).then(resolve, reject);
    return builder;
  }
  return { state, from };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: db.from } }));

import { getTokenGrants } from '../epb-token-grants';

const row = (grantType: string) => ({
  id: 'g1',
  season_id: 's1',
  player_id: 'p1',
  grant_type: grantType,
  token_count: 2,
  created_by: null,
  created_at: '2026-09-01T00:00:00Z',
});

beforeEach(() => {
  db.state.ops = [];
  db.state.result = { data: [], error: null };
});

describe('getTokenGrants', () => {
  it('maps draft_token rows through the allowlist and filters by type', async () => {
    db.state.result = { data: [row('draft_token')], error: null };

    await expect(getTokenGrants('s1', 'draft_token')).resolves.toEqual([
      {
        season_id: 's1',
        player_id: 'p1',
        grant_type: 'draft_token',
        token_count: 2,
        created_by: null,
        created_at: '2026-09-01T00:00:00Z',
      },
    ]);
    expect(db.state.ops).toContainEqual(['eq', ['grant_type', 'draft_token']]);
  });

  it('fails on a stored kill_token row instead of casting it', async () => {
    db.state.result = { data: [row('kill_token')], error: null };

    await expect(getTokenGrants('s1')).rejects.toThrow(/unexpected grant_type 'kill_token'/);
  });

  it('propagates a database error', async () => {
    const boom = { code: '57014', message: 'canceling statement' };
    db.state.result = { data: null as never, error: boom };

    await expect(getTokenGrants('s1', 'draft_token')).rejects.toBe(boom);
  });
});
