import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/smogon/import-stats', () => ({
  importAllStats: vi.fn(),
}));

vi.mock('@/lib/smogon/import-sets', () => ({
  importAllSets: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { GET } from '../route';
import { revalidateTag } from 'next/cache';
import { importAllStats } from '@/lib/smogon/import-stats';
import { importAllSets } from '@/lib/smogon/import-sets';

const SECRET = 'test-cron-secret';

function makeRequest(authorization?: string): Request {
  return new Request('http://localhost/api/cron/refresh-usage-stats', {
    headers: authorization ? { authorization } : {},
  });
}

describe('GET /api/cron/refresh-usage-stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.mocked(importAllStats).mockResolvedValue([{ format: 'gen9ou', status: 'success', pokemonCount: 200 }]);
    vi.mocked(importAllSets).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refreshes the usage stats and expires the cached usage read (D37)', async () => {
    const res = await GET(makeRequest(`Bearer ${SECRET}`));
    const json = await res.json();

    expect(json.data.formats_imported).toBe(1);
    // /insights reads imported usage from the public read cache.
    expect(revalidateTag).toHaveBeenCalledWith('meta-usage', { expire: 0 });
    expect(vi.mocked(importAllStats).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(revalidateTag).mock.invocationCallOrder[0]);
  });

  it('expires the usage read even when the sample-set refresh then fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(importAllSets).mockRejectedValue(new Error('sets unreachable'));

    const res = await GET(makeRequest(`Bearer ${SECRET}`));

    expect(res.status).toBe(500);
    expect(revalidateTag).toHaveBeenCalledWith('meta-usage', { expire: 0 });
  });

  it('an unauthorized call imports and expires nothing', async () => {
    const res = await GET(makeRequest('Bearer wrong'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized', code: 'cron_unauthorized' });
    expect(importAllStats).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
