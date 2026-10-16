import { beforeEach, describe, expect, it, vi } from 'vitest';

// Each from() gets its own builder so per-status head counts can differ.
const { calls, countsByStatus, fromMock } = vi.hoisted(() => {
  const calls: Array<{ table: string; select?: [string, unknown]; eq?: [string, unknown] }> = [];
  const countsByStatus: Record<string, number | null> = {};
  const fromMock = vi.fn((table: string) => {
    const call: (typeof calls)[number] = { table };
    calls.push(call);
    const builder = {
      select: vi.fn((columns: string, options: unknown) => {
        call.select = [columns, options];
        return builder;
      }),
      eq: vi.fn((column: string, value: unknown) => {
        call.eq = [column, value];
        return builder;
      }),
      then: (resolve: (value: unknown) => void) =>
        resolve({ data: null, error: null, count: countsByStatus[String(call.eq?.[1])] ?? null }),
    };
    return builder;
  });
  return { calls, countsByStatus, fromMock };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: fromMock, rpc: vi.fn() } }));
vi.mock('@/lib/supabase/queries/games', () => ({
  getGameById: vi.fn(),
  getBattleStatsByGame: vi.fn(),
  markGameAggregatesApplied: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/aggregates', () => ({ updateAggregates: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ revalidateMatchPages: vi.fn() }));

import { getAggregateJobStats } from '../aggregate-queue';

describe('getAggregateJobStats (head counts)', () => {
  beforeEach(() => {
    calls.length = 0;
    for (const key of Object.keys(countsByStatus)) delete countsByStatus[key];
    fromMock.mockClear();
  });

  it('issues one head-only exact count per status and downloads no rows', async () => {
    Object.assign(countsByStatus, {
      pending: 3,
      processing: 1,
      completed: 4200, // past max_rows: the old select('status') stopped counting at 1000
      failed: 2,
      cancelled: 0,
    });

    const stats = await getAggregateJobStats();

    expect(stats).toEqual({ pending: 3, processing: 1, completed: 4200, failed: 2, cancelled: 0 });
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.table).toBe('aggregate_jobs');
      expect(call.select).toEqual(['id', { count: 'exact', head: true }]);
      expect(call.eq?.[0]).toBe('status');
    }
    expect(calls.map((c) => c.eq?.[1]).sort()).toEqual(
      ['cancelled', 'completed', 'failed', 'pending', 'processing'],
    );
  });

  it('reads a missing count as zero', async () => {
    countsByStatus.pending = 7;

    const stats = await getAggregateJobStats();

    expect(stats).toEqual({ pending: 7, processing: 0, completed: 0, failed: 0, cancelled: 0 });
  });
});
