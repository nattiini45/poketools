import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `deleteMatchesByIds` releases the matches' team rows BEFORE the hard delete:
 * the FK's `ON DELETE SET NULL` would otherwise leave a released match-prep row
 * as a second planned row of its player (teambuilder 500).
 */

const { calls, deleteResult } = vi.hoisted(() => ({
  calls: [] as string[],
  deleteResult: { error: null as unknown },
}));

vi.mock('../teams', () => ({
  releaseTeamsFromMatches: vi.fn(async (ids: readonly string[]) => {
    calls.push(`release:${ids.join(',')}`);
  }),
}));

vi.mock('@/lib/supabase/client', () => {
  const builder: Record<string, unknown> = {};
  builder.from = (table: string) => {
    calls.push(`from:${table}`);
    return builder;
  };
  builder.delete = () => {
    calls.push('delete');
    return builder;
  };
  builder.in = (col: string, ids: string[]) => {
    calls.push(`in:${col}:${ids.join(',')}`);
    return Promise.resolve(deleteResult);
  };
  return { supabase: builder };
});

import { deleteMatchesByIds } from '../matches';
import { releaseTeamsFromMatches } from '../teams';

beforeEach(() => {
  calls.length = 0;
  deleteResult.error = null;
  vi.mocked(releaseTeamsFromMatches).mockClear();
});

describe('deleteMatchesByIds — team rows are released before the hard delete', () => {
  it('releases first, then deletes the matches', async () => {
    await deleteMatchesByIds(['m1', 'm2']);
    expect(calls).toEqual(['release:m1,m2', 'from:matches', 'delete', 'in:id:m1,m2']);
  });

  it('does not delete when the release fails (the error propagates)', async () => {
    vi.mocked(releaseTeamsFromMatches).mockRejectedValueOnce(new Error('release failed'));
    await expect(deleteMatchesByIds(['m1'])).rejects.toThrow('release failed');
    expect(calls).not.toContain('delete');
  });

  it('propagates the delete error', async () => {
    deleteResult.error = { message: 'boom' };
    await expect(deleteMatchesByIds(['m1'])).rejects.toEqual({ message: 'boom' });
  });

  it('does nothing for no ids', async () => {
    await deleteMatchesByIds([]);
    expect(calls).toEqual([]);
  });
});
