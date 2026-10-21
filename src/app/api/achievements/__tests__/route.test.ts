import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/queries/achievements', () => ({
  listAchievementDefinitions: vi.fn(),
}));

import { GET } from '../route';
import { listAchievementDefinitions } from '@/lib/supabase/queries/achievements';

const mockListDefinitions = listAchievementDefinitions as ReturnType<typeof vi.fn>;

describe('GET /api/achievements', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only non-hidden achievement definitions', async () => {
    const definitions = [
      { id: 'a-1', name: 'First Win', hidden: false },
      { id: 'a-2', name: 'Secret Badge', hidden: true },
      { id: 'a-3', name: 'Top Scorer', hidden: false },
    ];
    mockListDefinitions.mockResolvedValue(definitions);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual([
      { id: 'a-1', name: 'First Win', hidden: false },
      { id: 'a-3', name: 'Top Scorer', hidden: false },
    ]);
  });

  it('returns empty array when all are hidden', async () => {
    mockListDefinitions.mockResolvedValue([
      { id: 'a-1', name: 'Secret', hidden: true },
    ]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([]);
  });

  it('returns 500 when query throws', async () => {
    mockListDefinitions.mockRejectedValue(new Error('db fail'));

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch achievements');
  });
});
