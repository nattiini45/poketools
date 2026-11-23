import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc } }));

import {
  AggregateRebuildInProgressError,
  assertNoAggregateRebuild,
  claimAggregateRebuildLock,
  heartbeatAggregateRebuildLock,
  isAggregateRebuildActive,
  isAggregateRebuildFence,
  releaseAggregateRebuildLock,
} from '@/lib/supabase/queries/aggregate-rebuild-lock';

describe('aggregate-rebuild-lock', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('detects the PT409 fence code and nothing else', () => {
    expect(isAggregateRebuildFence({ code: 'PT409' })).toBe(true);
    expect(isAggregateRebuildFence({ code: '40001' })).toBe(false);
    expect(isAggregateRebuildFence(null)).toBe(false);
    expect(isAggregateRebuildFence('PT409')).toBe(false);
  });

  it('assertNoAggregateRebuild passes through while no lock is held', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(assertNoAggregateRebuild()).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('assert_no_aggregate_rebuild');
  });

  it('assertNoAggregateRebuild maps the fence to a 409 user-facing error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'aggregate rebuild in progress' } });
    await expect(assertNoAggregateRebuild()).rejects.toBeInstanceOf(AggregateRebuildInProgressError);
    await expect(assertNoAggregateRebuild()).rejects.toMatchObject({ statusCode: 409 });
  });

  it('claimAggregateRebuildLock returns the holder token and refuses while held', async () => {
    rpc.mockResolvedValue({ data: 'holder-abc', error: null });
    await expect(claimAggregateRebuildLock('tournament', 't1', 120)).resolves.toBe('holder-abc');
    rpc.mockResolvedValue({ data: null, error: { code: 'PT409' } });
    await expect(claimAggregateRebuildLock('tournament', 't1', 120)).rejects.toBeInstanceOf(
      AggregateRebuildInProgressError
    );
  });

  it('heartbeat throws when the lock was lost; release never throws', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PT409' } });
    await expect(heartbeatAggregateRebuildLock('h1', 120)).rejects.toBeInstanceOf(
      AggregateRebuildInProgressError
    );
    await expect(releaseAggregateRebuildLock('h1')).resolves.toBeUndefined();
  });

  it('isAggregateRebuildActive reports the probe result', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(isAggregateRebuildActive()).resolves.toBe(true);
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(isAggregateRebuildActive()).resolves.toBe(false);
  });
});
