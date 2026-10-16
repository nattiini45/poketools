import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';
import type { SeasonWithDetails } from '@/types/season';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonWithDetails: vi.fn(),
  updateSeason: vi.fn(),
  deleteSeason: vi.fn(),
  getSeasonById: vi.fn(),
  getSeasonParticipants: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  archiveTournamentsBySeason: vi.fn(),
}));

vi.mock('@/lib/reconcile/entity-delete-rebuild', () => ({
  rebuildAfterSeasonDelete: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { GET, PATCH, DELETE } from '@/app/api/seasons/[id]/route';
import { requireAdmin, requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import {
  getSeasonWithDetails,
  updateSeason,
  deleteSeason,
  getSeasonById,
  getSeasonParticipants,
} from '@/lib/supabase/queries/seasons';
import { rebuildAfterSeasonDelete } from '@/lib/reconcile/entity-delete-rebuild';
import { logAuditEvent } from '@/lib/audit/log';
import { archiveTournamentsBySeason } from '@/lib/supabase/queries/tournaments';
import { revalidateTag } from 'next/cache';

const mockSeason: SeasonWithDetails = {
  id: 'season-1',
  name: 'Season One',
  description: 'First season',
  format_type: 'singles',
  status: 'active',
  archived: false,
  legacy: false,
  is_test_season: false,
  start_date: '2026-01-01',
  end_date: '2026-06-30',
  ruleset_id: null,
  core_pool: null,
  point_buy_list_id: null,
  language: 'de',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ruleset_name: null,
  participant_count: 0,
  tournament_count: 0,
};

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

const makeRouteArgs = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /api/seasons/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns season by id (public)', async () => {
    vi.mocked(getSeasonWithDetails).mockResolvedValue(mockSeason);

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('season-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(mockSeason);
  });

  it('returns 404 when season not found', async () => {
    vi.mocked(getSeasonWithDetails).mockResolvedValue(null);

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('nonexistent'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe('League not found');
    expect(body.code).toBe('SEASON_NOT_FOUND');
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getSeasonWithDetails).mockRejectedValue(new Error('DB error'));

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('season-1'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to fetch league');
  });
});

describe('PATCH /api/seasons/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when not resource admin', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required', 403),
    );

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Updated' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('season-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
  });

  it('updates season successfully', async () => {
    const updated = { ...mockSeason, name: 'Updated Season' };
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(updateSeason).mockResolvedValue(updated);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Updated Season' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('season-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(updated);
    expect(vi.mocked(requireResourceAdmin)).toHaveBeenCalledWith('season', 'season-1');
    // D37: settings and status show on the next view.
    expect(revalidateTag).toHaveBeenCalledWith('season:season-1', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith('seasons', { expire: 0 });
  });

  it('archives tournaments when archived flag is set', async () => {
    const updated = { ...mockSeason, archived: true };
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(updateSeason).mockResolvedValue(updated);
    vi.mocked(archiveTournamentsBySeason).mockResolvedValue(undefined);

    const request = {
      json: vi.fn().mockResolvedValue({ archived: true }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('season-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(vi.mocked(archiveTournamentsBySeason)).toHaveBeenCalledWith('season-1', true);
  });

  it.each(['de', 'en'] as const)('passes the content language %s through to updateSeason', async (language) => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(updateSeason).mockResolvedValue({ ...mockSeason, language });

    const request = {
      json: vi.fn().mockResolvedValue({ language }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('season-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateSeason).toHaveBeenCalledWith('season-1', { language });
    expect(body.data.language).toBe(language);
  });

  it('rejects an unknown content language with 400 validation_failed before any write', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);

    const request = {
      json: vi.fn().mockResolvedValue({ language: 'fr' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('season-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
    expect(body.error).toContain('language');
    expect(updateSeason).not.toHaveBeenCalled();
  });

  it('does not archive tournaments when archived is not in body', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(updateSeason).mockResolvedValue(mockSeason);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'No Archive' }),
    } as unknown as NextRequest;

    await PATCH(request, makeRouteArgs('season-1'));

    expect(vi.mocked(archiveTournamentsBySeason)).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(updateSeason).mockRejectedValue(new Error('DB error'));

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Fail' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('season-1'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to update league');
  });
});

describe('PATCH /api/seasons/[id] — test-league flag', () => {
  const leagueAdmin = { ...adminPlayer, playerId: 'league-admin-1', isAdmin: false, isResourceAdmin: true };
  const patch = (body: unknown) =>
    PATCH({ json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest, makeRouteArgs('season-1'));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets a site admin set the flag: one update, audited, season reads expired', async () => {
    const updated = { ...mockSeason, is_test_season: true };
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(updateSeason).mockResolvedValue(updated);

    const response = await patch({ is_test_season: true });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.is_test_season).toBe(true);
    expect(updateSeason).toHaveBeenCalledWith('season-1', { is_test_season: true });
    expect(logAuditEvent).toHaveBeenCalledWith({
      actor_id: 'admin-1',
      actor_name: 'Admin',
      action: 'season.set_test_flag',
      resource_type: 'season',
      resource_id: 'season-1',
      resource_name: 'Season One',
      metadata: { is_test_season: true },
    });
    // The league's own reads and the public season list it leaves (or rejoins).
    expect(revalidateTag).toHaveBeenCalledWith('season:season-1', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith('seasons', { expire: 0 });
  });

  it('lets a site admin clear the flag', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(updateSeason).mockResolvedValue(mockSeason);

    const response = await patch({ is_test_season: false });

    expect(response.status).toBe(200);
    expect(updateSeason).toHaveBeenCalledWith('season-1', { is_test_season: false });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'season.set_test_flag', metadata: { is_test_season: false } }),
    );
  });

  it('refuses a league (resource) admin with 403 before any write', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(leagueAdmin);

    const response = await patch({ is_test_season: true, name: 'Renamed' });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Only site admins can change the test-league flag');
    expect(body.code).toBe('season_test_flag_site_admin_only');
    expect(updateSeason).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('still lets a league admin edit other settings (no test-flag audit)', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(leagueAdmin);
    vi.mocked(updateSeason).mockResolvedValue(mockSeason);

    const response = await patch({ name: 'Renamed' });

    expect(response.status).toBe(200);
    expect(updateSeason).toHaveBeenCalledWith('season-1', { name: 'Renamed' });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean flag with 400 before any write', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);

    const response = await patch({ is_test_season: 'yes' });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('is_test_season');
    expect(updateSeason).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/seasons/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue([] as never);
    vi.mocked(rebuildAfterSeasonDelete).mockResolvedValue({
      scope: 'season',
      playerIds: [],
      ratingsRebuilt: 0,
      streaksRebuilt: 0,
      tournamentScopeCleared: null,
      leagueScope: null,
      allTime: { gamesProcessed: 0, aggregatesDeleted: 0, playerAggregatesDeleted: 0 },
      evolutionRepair: null,
    } as never);
  });

  it('returns 403 when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required', 403),
    );

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('season-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
  });

  it('deletes season and returns null data', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(deleteSeason).mockResolvedValue(undefined);

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('season-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
    expect(vi.mocked(deleteSeason)).toHaveBeenCalledWith('season-1');
    expect(revalidateTag).toHaveBeenCalledWith('season:season-1', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith('seasons', { expire: 0 });
  });

  it('captures participants before the delete, rebuilds derived data, and audit-logs the deletion', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(deleteSeason).mockResolvedValue(undefined);
    vi.mocked(getSeasonParticipants).mockResolvedValue([
      { id: 'p1', name: 'One' },
      { id: 'p2', name: 'Two' },
    ] as never);

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('season-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    // Participants captured BEFORE the cascade removes the rows.
    expect(getSeasonParticipants).toHaveBeenCalledWith('season-1');
    expect(vi.mocked(getSeasonParticipants).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deleteSeason).mock.invocationCallOrder[0]
    );

    // Rebuild runs after the delete committed, with the captured players.
    expect(rebuildAfterSeasonDelete).toHaveBeenCalledWith({
      seasonId: 'season-1',
      playerIds: ['p1', 'p2'],
    });
    expect(vi.mocked(rebuildAfterSeasonDelete).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(deleteSeason).mock.invocationCallOrder[0]
    );

    // Season deletion is audit-logged (previously it was not) with the summary.
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'season.delete',
        resource_type: 'season',
        resource_id: 'season-1',
        metadata: expect.objectContaining({
          rebuild: expect.objectContaining({ scope: 'season' }),
          rebuild_error: null,
        }),
      })
    );
  });

  it('still returns success when the derived-data rebuild fails (the delete already committed)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(deleteSeason).mockResolvedValue(undefined);
    vi.mocked(rebuildAfterSeasonDelete).mockRejectedValue(new Error('rebuild blew up'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const request = {} as unknown as NextRequest;
      const response = await DELETE(request, makeRouteArgs('season-1'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      // The original error is logged server-side, never masked.
      expect(errorSpy).toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'season.delete',
          metadata: expect.objectContaining({ rebuild_error: 'derived_data_rebuild_failed' }),
        })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(deleteSeason).mockRejectedValue(new Error('FK constraint'));

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('season-1'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to delete league');
  });
});
