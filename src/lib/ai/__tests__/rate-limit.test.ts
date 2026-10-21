import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  supabase: createMockSupabase(),
}));

import { createMockSupabase } from '@/lib/__tests__/helpers/supabase-mock';
import { supabase } from '@/lib/supabase/client';
import { checkAndRecordAiGeneration } from '../rate-limit';
import type { AiEndpoint } from '../rate-limit';

const mock = supabase as unknown as ReturnType<typeof createMockSupabase>;

// Add rpc mock
const rpcMock = vi.fn();
(mock as Record<string, unknown>).rpc = rpcMock;

describe('checkAndRecordAiGeneration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    (mock as unknown as { __reset: () => void }).__reset();
    rpcMock.mockReset();
    process.env = { ...originalEnv };
  });

  it('calls the correct RPC with player ID and endpoint', async () => {
    rpcMock.mockResolvedValue({
      data: { allowed: true, remaining: 8, used: 2, limit: 10 },
      error: null,
    });

    await checkAndRecordAiGeneration('player-1', 'match-analysis');

    expect(rpcMock).toHaveBeenCalledWith('check_and_record_ai_generation', {
      p_player_id: 'player-1',
      p_endpoint: 'match-analysis',
      p_daily_limit: expect.any(Number),
    });
  });

  it('returns rate limit result when allowed', async () => {
    rpcMock.mockResolvedValue({
      data: { allowed: true, remaining: 5, used: 5, limit: 10 },
      error: null,
    });

    const result = await checkAndRecordAiGeneration('player-1', 'tournament-report');

    expect(result).toEqual({
      allowed: true,
      remaining: 5,
      used: 5,
      limit: 10,
    });
  });

  it('returns disallowed result when at limit', async () => {
    rpcMock.mockResolvedValue({
      data: { allowed: false, remaining: 0, used: 10, limit: 10 },
      error: null,
    });

    const result = await checkAndRecordAiGeneration('player-1', 'match-prep-analysis');

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('works with all valid endpoint types', async () => {
    const endpoints: AiEndpoint[] = ['match-analysis', 'match-prep-analysis', 'tournament-report'];

    for (const endpoint of endpoints) {
      rpcMock.mockResolvedValue({
        data: { allowed: true, remaining: 9, used: 1, limit: 10 },
        error: null,
      });

      const result = await checkAndRecordAiGeneration('player-1', endpoint);
      expect(result.allowed).toBe(true);
    }
  });

  it('throws when RPC returns an error', async () => {
    const dbError = new Error('RPC failed');
    rpcMock.mockResolvedValue({ data: null, error: dbError });

    await expect(
      checkAndRecordAiGeneration('player-1', 'match-analysis'),
    ).rejects.toThrow('RPC failed');
  });

  it('throws when RPC returns null data', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await expect(
      checkAndRecordAiGeneration('player-1', 'match-analysis'),
    ).rejects.toThrow('No data returned from AI rate limit RPC');
  });
});
