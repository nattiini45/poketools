import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    code?: string;
    constructor(message: string, statusCode: number, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }
  return { requireAnyAdmin: vi.fn(), AuthError };
});

vi.mock('@/lib/auth/admin-scope', () => ({ getAdminScope: vi.fn() }));

vi.mock('@/lib/supabase/queries/matches', () => ({ listAdminMatchFilterOptions: vi.fn() }));

import { GET } from '../route';
import { requireAnyAdmin, AuthError } from '@/lib/auth/helpers';
import { getAdminScope } from '@/lib/auth/admin-scope';
import { listAdminMatchFilterOptions } from '@/lib/supabase/queries/matches';

const PLAYER = { playerId: 'p1', isAdmin: false, isResourceAdmin: true };

const OPTIONS = {
  leagues: [
    {
      id: 'season-1',
      name: 'Summer League',
      status: 'active',
      archived: false,
      is_test_season: false,
      phases: [{ id: 'phase-1', name: 'Group stage', stage_order: 0, archived: false }],
    },
    {
      id: 'season-0',
      name: 'Spring League',
      status: 'completed',
      archived: true,
      is_test_season: false,
      phases: [],
    },
  ],
  tournaments: [{ id: 't-1', name: 'Weekly #1', status: 'active', archived: false }],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAnyAdmin).mockResolvedValue(PLAYER as never);
  vi.mocked(getAdminScope).mockResolvedValue({
    playerId: 'p1',
    isSiteAdmin: true,
    seasonIds: null,
    tournamentIds: null,
  });
  vi.mocked(listAdminMatchFilterOptions).mockResolvedValue(OPTIONS);
});

describe('GET /api/admin/matches/filter-options', () => {
  it('returns leagues with their phases and the standalone tournaments, archived ones flagged', async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, data: OPTIONS });
    expect(body.data.leagues[1]).toMatchObject({ archived: true });
    // `status` is the league / tournament status here, not a player's moderation status.
    expectNoPrivatePlayerData(body, { allowKeys: ['status'] });
  });

  it('is unrestricted for a site admin', async () => {
    await GET();
    expect(requireAnyAdmin).toHaveBeenCalledTimes(1);
    expect(getAdminScope).toHaveBeenCalledWith(PLAYER);
    expect(listAdminMatchFilterOptions).toHaveBeenCalledWith({ tournamentIds: null, seasonIds: null });
  });

  it('restricts a resource admin to their own scope', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({
      playerId: 'p1',
      isSiteAdmin: false,
      seasonIds: ['season-1'],
      tournamentIds: ['phase-1', 't-1'],
    });
    await GET();
    expect(listAdminMatchFilterOptions).toHaveBeenCalledWith({
      tournamentIds: ['phase-1', 't-1'],
      seasonIds: ['season-1'],
    });
  });

  it('denies a non-admin before reading anything', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: 'Admin access required', code: 'forbidden' });
    expect(getAdminScope).not.toHaveBeenCalled();
    expect(listAdminMatchFilterOptions).not.toHaveBeenCalled();
  });

  it('returns 500 with the fallback message on an unexpected error', async () => {
    vi.mocked(listAdminMatchFilterOptions).mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to load match filters' });
    spy.mockRestore();
  });
});
