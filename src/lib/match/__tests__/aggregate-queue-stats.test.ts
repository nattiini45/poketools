import { beforeEach, describe, expect, it, vi } from 'vitest';

// Each from() gets its own builder so per-status head counts can differ.
const { calls, countsByStatus, errorsByStatus, fromMock } = vi.hoisted(() => {
  const calls: Array<{ table: string; select?: [string, unknown]; eq?: [string, unknown] }> = [];
  const countsByStatus: Record<string, number | null> = {};
  const errorsByStatus: Record<string, unknown> = {};
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
        resolve({
          data: null,
          error: errorsByStatus[String(call.eq?.[1])] ?? null,
          count: countsByStatus[String(call.eq?.[1])] ?? null,
        }),
    };
    return builder;
  });
  return { calls, countsByStatus, errorsByStatus, fromMock };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: fromMock, rpc: vi.fn() } }));
vi.mock('@/lib/supabase/queries/games', () => ({
  getGameById: vi.fn(),
  getBattleStatsByGame: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/aggregates', () => ({
  applyAggregateJob: vi.fn(),
  buildGameAggregateDeltas: vi.fn(),
}));
vi.mock('@/lib/revalidation', () => ({ revalidateMatchPages: vi.fn() }));

import { countFailedAggregateJobs, getAggregateJobStats } from '../aggregate-queue';

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

describe('countFailedAggregateJobs (cron failedJobs)', () => {
  beforeEach(() => {
    calls.length = 0;
    for (const key of Object.keys(countsByStatus)) delete countsByStatus[key];
    for (const key of Object.keys(errorsByStatus)) delete errorsByStatus[key];
    fromMock.mockClear();
  });

  it('counts the jobs that ended failed with one head-only exact count', async () => {
    countsByStatus.failed = 7;

    await expect(countFailedAggregateJobs()).resolves.toBe(7);
    expect(calls).toEqual([
      { table: 'aggregate_jobs', select: ['id', { count: 'exact', head: true }], eq: ['status', 'failed'] },
    ]);
  });

  it('throws the read error instead of reading it as zero', async () => {
    const err = { message: 'count failed' };
    errorsByStatus.failed = err;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(countFailedAggregateJobs()).rejects.toBe(err);
    expect(spy).toHaveBeenCalledWith('[aggregate-queue] Failed-job count error:', err);
    spy.mockRestore();
  });

  it('throws when the response carries no count', async () => {
    await expect(countFailedAggregateJobs()).rejects.toThrow('returned no count');
  });
});
