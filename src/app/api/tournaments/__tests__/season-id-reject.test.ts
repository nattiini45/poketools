import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireAnyAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  listTournaments: vi.fn(),
  listArchivedTournaments: vi.fn(),
  getStagesBySeasonId: vi.fn(),
  createTournament: vi.fn(),
}));

import { POST } from '@/app/api/tournaments/route';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { createTournament } from '@/lib/supabase/queries/tournaments';
import { makeRequest } from '@/lib/__tests__/helpers/api-request';

const adminPlayer = {
  playerId: 'admin-1',
  name: 'Admin',
  isAdmin: true,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active' as const,
};

describe('POST /api/tournaments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAnyAdmin).mockResolvedValue(adminPlayer);
  });

  it('rejects season_id with TOURNAMENT_SEASON_ID_DEPRECATED', async () => {
    const request = makeRequest({
      name: 'Playoffs',
      season_id: '00000000-0000-4000-8000-000000000001',
      bracket_type: 'single_elim',
      ruleset_id: '00000000-0000-4000-8000-000000000002',
    }) as NextRequest;

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.code).toBe('TOURNAMENT_SEASON_ID_DEPRECATED');
    expect(createTournament).not.toHaveBeenCalled();
  });
});
