import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `deleteMatchesByRound` reads the round's match ids in pages (no 1000-row cap), releases their team rows, then deletes on
 * the `round_id` predicate. A round too large for one bounded read is refused before anything is released or deleted.
 */

const ROUND = '0b4f2a8e-1111-4222-8333-444455556666';

const { calls, state } = vi.hoisted(() => ({
  calls: [] as string[],
  state: { total: 0, deleteError: null as unknown },
}));

vi.mock('../teams', () => ({
  releaseTeamsFromMatches: vi.fn(async (ids: readonly string[]) => {
    calls.push(`release:${ids.length}`);
  }),
}));

vi.mock('@/lib/supabase/client', () => {
  const from = () => {
    const builder: Record<string, unknown> = {};
    let deleting = false;
    builder.select = () => builder;
    builder.order = () => builder;
    builder.delete = () => {
      deleting = true;
      return builder;
    };
    builder.eq = (column: string, value: string) => {
      if (deleting) {
        calls.push(`delete:${column}=${value}`);
        return Promise.resolve({ error: state.deleteError });
      }
      return builder;
    };
    builder.range = (fromRow: number, toRow: number) => {
      calls.push(`range:${fromRow}`);
      const count = Math.max(0, Math.min(toRow + 1, state.total) - fromRow);
      return Promise.resolve({ data: Array.from({ length: count }, (_, i) => ({ id: `m${fromRow + i}` })), error: null });
    };
    return builder;
  };
  return { supabase: { from } };
});

import { deleteMatchesByRound } from '../matches';

beforeEach(() => {
  calls.length = 0;
  state.total = 0;
  state.deleteError = null;
});

describe('deleteMatchesByRound', () => {
  it('releases every match of a round larger than one page, then deletes on the round id', async () => {
    state.total = 2345;
    await deleteMatchesByRound(ROUND);
    expect(calls).toEqual(['range:0', 'range:1000', 'range:2000', 'release:2345', `delete:round_id=${ROUND}`]);
  });

  it('does nothing for an empty round', async () => {
    await deleteMatchesByRound(ROUND);
    expect(calls).toEqual(['range:0']);
  });

  it('refuses a round too large to read whole, before releasing or deleting anything', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.total = 50_000;
    await expect(deleteMatchesByRound(ROUND)).rejects.toThrow('more matches than one bounded read holds');
    expect(calls.some((call) => call.startsWith('release') || call.startsWith('delete'))).toBe(false);
  });

  it('propagates a failed delete', async () => {
    state.total = 2;
    state.deleteError = { message: 'denied' };
    await expect(deleteMatchesByRound(ROUND)).rejects.toEqual({ message: 'denied' });
  });

  it('refuses an id that is not a UUID', async () => {
    await expect(deleteMatchesByRound('nope')).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
