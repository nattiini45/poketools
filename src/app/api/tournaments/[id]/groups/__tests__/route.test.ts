import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: vi.fn(),
}));

import { GET } from '../route';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

// ── Test data ─────────────────────────────────────────────────────────

const mockGroups = [
  { id: 'g1', name: 'Group A', tournament_id: '22222222-2222-4222-8222-222222222222', group_number: 1, members: [] },
  { id: 'g2', name: 'Group B', tournament_id: '22222222-2222-4222-8222-222222222222', group_number: 2, members: [] },
];

describe('GET /api/tournaments/[id]/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns groups for the tournament', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue(mockGroups as never);

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ id: '22222222-2222-4222-8222-222222222222' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(mockGroups);
    expect(getGroupsByTournament).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
  });

  it('returns 500 when query fails', async () => {
    vi.mocked(getGroupsByTournament).mockRejectedValue(new Error('DB error'));

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ id: '22222222-2222-4222-8222-222222222222' }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch groups');
  });
});
