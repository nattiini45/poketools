import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/draft/rpc-errors', () => ({ callDraftRpc: vi.fn() }));

import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { listTickablePools } from '../drafts-queue';

describe('listTickablePools (the draft-ticks cron list)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks the database for the pools with work due, with the limit, and maps the rows', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue([
      { id: 'pool-30', season_id: 'season-30' },
      { id: 'pool-2', season_id: 'season-2', extra: 'ignored' },
    ]);

    await expect(listTickablePools(25)).resolves.toEqual([
      { id: 'pool-30', season_id: 'season-30' },
      { id: 'pool-2', season_id: 'season-2' },
    ]);
    expect(callDraftRpc).toHaveBeenCalledTimes(1);
    expect(callDraftRpc).toHaveBeenCalledWith('draft_list_due_pools', { p_limit: 25 });
  });

  it('an empty list is an empty array', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue(null);
    await expect(listTickablePools(25)).resolves.toEqual([]);
  });

  it('refuses a malformed row instead of ticking a made-up pool', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue([{ id: 'pool-1' }]);
    await expect(listTickablePools(25)).rejects.toThrow(/draft_list_due_pools/);
  });

  it('lets an RPC failure through (the cron answers it through safeErrorResponse)', async () => {
    const failure = new Error('function not found');
    vi.mocked(callDraftRpc).mockRejectedValue(failure);
    await expect(listTickablePools(25)).rejects.toBe(failure);
  });
});
