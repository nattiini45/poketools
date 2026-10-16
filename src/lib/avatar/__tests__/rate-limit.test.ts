import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  supabase: createMockSupabase(),
}));

import { createMockSupabase } from '@/lib/__tests__/helpers/supabase-mock';
import { supabase } from '@/lib/supabase/client';
import { checkAndRecordGeneration, checkGenerationLimit } from '../rate-limit';

const mock = supabase as unknown as ReturnType<typeof createMockSupabase>;

// Mock the rpc method separately since createMockSupabase doesn't include it
const rpcMock = vi.fn();
(mock as Record<string, unknown>).rpc = rpcMock;

describe('checkAndRecordGeneration', () => {
  beforeEach(() => {
    (mock as unknown as { __reset: () => void }).__reset();
    rpcMock.mockReset();
  });

  it('calls the correct RPC and returns the result when allowed', async () => {
    rpcMock.mockResolvedValue({
      data: { allowed: true, remaining: 7, used: 3, limit: 10 },
      error: null,
    });

    const result = await checkAndRecordGeneration('player-1');

    expect(rpcMock).toHaveBeenCalledWith('check_and_record_avatar_generation', {
      p_player_id: 'player-1',
      p_daily_limit: 10,
    });
    expect(result).toEqual({
      allowed: true,
      remaining: 7,
      used: 3,
      limit: 10,
    });
  });

  it('returns disallowed result when limit is reached', async () => {
    rpcMock.mockResolvedValue({
      data: { allowed: false, remaining: 0, used: 10, limit: 10 },
      error: null,
    });

    const result = await checkAndRecordGeneration('player-1');

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.used).toBe(10);
  });

  it('throws when RPC returns an error', async () => {
    const dbError = new Error('DB connection failed');
    rpcMock.mockResolvedValue({ data: null, error: dbError });

    await expect(checkAndRecordGeneration('player-1')).rejects.toThrow(
      'DB connection failed',
    );
  });

  it('throws when RPC returns null data', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await expect(checkAndRecordGeneration('player-1')).rejects.toThrow(
      'No data returned from rate limit RPC',
    );
  });
});

describe('checkGenerationLimit', () => {
  beforeEach(() => {
    (mock as unknown as { __reset: () => void }).__reset();
  });

  it('returns allowed=true when under limit', async () => {
    // Mock the select query chain to return count
    (mock as unknown as { __setResult: (v: unknown[]) => void }).__setResult([]);
    // Override 'then' to simulate the count response
    (mock.select as ReturnType<typeof vi.fn>).mockReturnValue({
      ...mock,
      eq: vi.fn().mockReturnValue({
        ...mock,
        gte: vi.fn().mockResolvedValue({ count: 3, error: null }),
      }),
    });
    (mock.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: (mock.select as ReturnType<typeof vi.fn>),
    });

    const result = await checkGenerationLimit('player-1');

    expect(result).toEqual({
      allowed: true,
      remaining: 7,
      used: 3,
      limit: 10,
    });
  });

  it('returns allowed=false when at limit', async () => {
    (mock.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockResolvedValue({ count: 10, error: null }),
        }),
      }),
    });

    const result = await checkGenerationLimit('player-1');

    expect(result).toEqual({
      allowed: false,
      remaining: 0,
      used: 10,
      limit: 10,
    });
  });

  it('returns remaining=0 when over limit (defensive)', async () => {
    (mock.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockResolvedValue({ count: 15, error: null }),
        }),
      }),
    });

    const result = await checkGenerationLimit('player-1');

    expect(result.remaining).toBe(0);
    expect(result.allowed).toBe(false);
  });

  it('treats null count as 0', async () => {
    (mock.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockResolvedValue({ count: null, error: null }),
        }),
      }),
    });

    const result = await checkGenerationLimit('player-1');

    expect(result.used).toBe(0);
    expect(result.remaining).toBe(10);
    expect(result.allowed).toBe(true);
  });

  it('throws when query returns an error', async () => {
    (mock.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockResolvedValue({
            count: null,
            error: new Error('Query failed'),
          }),
        }),
      }),
    });

    await expect(checkGenerationLimit('player-1')).rejects.toThrow('Query failed');
  });
});
