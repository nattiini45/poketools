import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/epb-animation-views', () => ({
  hasViewedEpbReplay: vi.fn(),
  markEpbReplayViewed: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

import { GET, POST } from '@/app/api/matches/[id]/epb-replay-viewed/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { hasViewedEpbReplay, markEpbReplayViewed } from '@/lib/supabase/queries/epb-animation-views';
import { getMatchById } from '@/lib/supabase/queries/matches';

const MATCH_ID = '12345678-1234-4123-8123-123456789abc';
const routeParams = { params: Promise.resolve({ id: MATCH_ID }) };

describe('/api/matches/[id]/epb-replay-viewed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'p1', name: 'Alice' } as never);
  });

  it('GET reports whether the player has viewed the replay', async () => {
    vi.mocked(hasViewedEpbReplay).mockResolvedValue(true);

    const res = await GET({} as NextRequest, routeParams);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { viewed: true } });
    expect(hasViewedEpbReplay).toHaveBeenCalledWith('p1', MATCH_ID);
  });

  it('POST marks the replay viewed for an existing match', async () => {
    vi.mocked(getMatchById).mockResolvedValue({ id: MATCH_ID } as never);

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { viewed: true } });
    expect(markEpbReplayViewed).toHaveBeenCalledWith('p1', MATCH_ID);
  });

  it('POST answers 404 match_not_found for an unknown match and marks nothing', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null as never);

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Match not found', code: 'match_not_found' });
    expect(markEpbReplayViewed).not.toHaveBeenCalled();
  });
});
