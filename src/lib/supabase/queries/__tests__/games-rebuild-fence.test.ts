import { describe, it, expect, vi, beforeEach } from 'vitest';

const { calls, result } = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  result: { data: [] as unknown[] | null, error: null as unknown },
}));

vi.mock('@/lib/supabase/client', () => {
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'neq', 'lte', 'order', 'range', 'eq']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return { supabase: builder };
});

vi.mock('@/lib/utils/uuid', () => ({ assertValidUuid: vi.fn() }));

import { isLiveIncrementJob, listGamesForAggregateRebuild } from '../games';

describe('isLiveIncrementJob — which jobs the queue can still apply', () => {
  const job = (status: string, attempts = 0, max_attempts = 3, operation = 'increment') => ({
    operation,
    status,
    attempts,
    max_attempts,
  });

  it('a claimable pending increment is live', () => {
    expect(isLiveIncrementJob(job('pending', 2, 3))).toBe(true);
  });

  it('a processing increment is live, on its last attempt too', () => {
    expect(isLiveIncrementJob(job('processing', 3, 3))).toBe(true);
  });

  it('a stranded pending row (attempts exhausted) can never be claimed: not live', () => {
    expect(isLiveIncrementJob(job('pending', 3, 3))).toBe(false);
  });

  it.each(['completed', 'failed', 'cancelled'])('a %s job is not live', (status) => {
    expect(isLiveIncrementJob(job(status))).toBe(false);
  });

  it('a decrement job is not an increment the rebuild must leave to the queue', () => {
    expect(isLiveIncrementJob(job('pending', 0, 3, 'decrement'))).toBe(false);
  });
});

describe('listGamesForAggregateRebuild — query shape', () => {
  beforeEach(() => {
    calls.length = 0;
    result.data = [];
    result.error = null;
  });

  const selectArg = () => String(calls.find(([m]) => m === 'select')?.[1] ?? '').replace(/\s+/g, ' ');

  it('embeds the aggregate jobs, bounds created_at and filters the tournament scope', async () => {
    await listGamesForAggregateRebuild('tournament', 't1', 100, 100, '2026-10-19T00:00:00Z');

    expect(selectArg()).toContain('aggregate_jobs ( operation, status, attempts, max_attempts )');
    expect(selectArg()).toContain('matches!inner (');
    expect(calls).toContainEqual(['from', 'games']);
    expect(calls).toContainEqual(['neq', 'matches.status', 'scheduled']);
    expect(calls).toContainEqual(['lte', 'created_at', '2026-10-19T00:00:00Z']);
    expect(calls).toContainEqual(['order', 'id']);
    expect(calls).toContainEqual(['range', 100, 199]);
    expect(calls).toContainEqual(['eq', 'matches.tournament_id', 't1']);
  });

  it('filters a league scope through the season', async () => {
    await listGamesForAggregateRebuild('league', 's1', 0, 50, '2026-10-19T00:00:00Z');
    expect(calls).toContainEqual(['eq', 'matches.tournaments.season_id', 's1']);
  });

  it('lists nothing and sends no query when no game existed at the fence', async () => {
    expect(await listGamesForAggregateRebuild('all_time', null, 0, 50, null)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('marks a game with a live increment job and maps the scope ids', async () => {
    result.data = [
      {
        id: 'g1',
        exclude_all_time: false,
        matches: { status: 'completed', tournament_id: 't1', tournaments: { season_id: 's1' } },
        aggregate_jobs: [{ operation: 'increment', status: 'pending', attempts: 0, max_attempts: 3 }],
      },
      {
        id: 'g2',
        exclude_all_time: true,
        matches: { status: 'completed', tournament_id: 't1', tournaments: { season_id: null } },
        aggregate_jobs: [{ operation: 'increment', status: 'failed', attempts: 3, max_attempts: 3 }],
      },
    ];

    expect(await listGamesForAggregateRebuild('all_time', null, 0, 50, '2026-10-19T00:00:00Z')).toEqual([
      { game_id: 'g1', tournament_id: 't1', season_id: 's1', exclude_all_time: false, live_increment_job: true },
      { game_id: 'g2', tournament_id: 't1', season_id: null, exclude_all_time: true, live_increment_job: false },
    ]);
  });

  it('propagates the query error', async () => {
    result.error = { message: 'boom' };
    await expect(listGamesForAggregateRebuild('all_time', null, 0, 50, '2026-10-19T00:00:00Z')).rejects.toEqual({
      message: 'boom',
    });
  });
});
