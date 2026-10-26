import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';

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

// The league-type guard reads the phases' start signals (settings-guards.test.ts covers it).
vi.mock('@/lib/supabase/queries/season-start', () => ({
  getSeasonPhaseStartSignals: vi.fn(),
}));

vi.mock('@/lib/reconcile/entity-delete-rebuild', () => ({
  rebuildAfterSeasonDelete: vi.fn(),
}));

// The custom league type guard reads the attached format and the start signals only for a change involving `custom`.
vi.mock('@/lib/supabase/queries/season-formats', () => ({
  getSeasonFormatSummary: vi.fn(),
  getSeasonStartSignals: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
  diffField: (changes: Record<string, { before: unknown; after: unknown }>, field: string, before: unknown, after: unknown) => {
    if (before !== after) changes[field] = { before, after };
  },
}));

// The rating rebuild after setting the test flag: test-flag-ratings.test.ts.
vi.mock('@/lib/rating/test-league-rebuild', () => ({
  rebuildRatingsAfterTestFlagChange: vi.fn(),
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
import { rebuildRatingsAfterTestFlagChange } from '@/lib/rating/test-league-rebuild';
import { getSeasonFormatSummary, getSeasonStartSignals } from '@/lib/supabase/queries/season-formats';
import { getSeasonPhaseStartSignals } from '@/lib/supabase/queries/season-start';
import { revalidateTag } from 'next/cache';

const mockSeason: SeasonWithDetails = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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
    const response = await GET(request, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(mockSeason);
  });

  it('returns 404 when season not found', async () => {
    vi.mocked(getSeasonWithDetails).mockResolvedValue(null);

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('99999999-9999-4999-8999-999999999999'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe('League not found');
    expect(body.code).toBe('SEASON_NOT_FOUND');
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getSeasonWithDetails).mockRejectedValue(new Error('DB error'));

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to fetch league');
  });
});

describe('PATCH /api/seasons/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason);
  });

  it('returns 403 when not resource admin', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required', 403),
    );

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Updated' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
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

    const response = await PATCH(request, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ ...updated, rating_rebuild: null, rebuild_warning: null });
    expect(vi.mocked(requireResourceAdmin)).toHaveBeenCalledWith('season', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    // D37: settings and status show on the next view.
    expect(revalidateTag).toHaveBeenCalledWith('season:cccccccc-cccc-4ccc-8ccc-cccccccccccc', { expire: 0 });
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

    const response = await PATCH(request, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(vi.mocked(archiveTournamentsBySeason)).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
  });

  it.each(['de', 'en'] as const)('passes the content language %s through to updateSeason', async (language) => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(updateSeason).mockResolvedValue({ ...mockSeason, language });

    const request = {
      json: vi.fn().mockResolvedValue({ language }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateSeason).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', { language });
    expect(body.data.language).toBe(language);
  });

  it('rejects an unknown content language with 400 validation_failed before any write', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);

    const request = {
      json: vi.fn().mockResolvedValue({ language: 'fr' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
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

    await PATCH(request, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));

    expect(vi.mocked(archiveTournamentsBySeason)).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(updateSeason).mockRejectedValue(new Error('DB error'));

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Fail' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to update league');
  });
});

describe('PATCH /api/seasons/[id] — test-league flag', () => {
  const leagueAdmin = { ...adminPlayer, playerId: 'league-admin-1', isAdmin: false, isResourceAdmin: true };
  const patch = (body: unknown) =>
    PATCH({ json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason);
  });

  it('lets a site admin set the flag: one update, ratings rebuilt, audited, season reads expired', async () => {
    const updated = { ...mockSeason, is_test_season: true };
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getSeasonById).mockResolvedValue({ ...mockSeason, is_test_season: false });
    vi.mocked(updateSeason).mockResolvedValue(updated);
    vi.mocked(rebuildRatingsAfterTestFlagChange).mockResolvedValue({
      seasonId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      isTestSeason: true,
      playerIds: [],
      rebuiltPlayerIds: [],
      passes: 0,
      settled: true,
      unratedMatches: 0,
    });

    const response = await patch({ is_test_season: true });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.is_test_season).toBe(true);
    expect(updateSeason).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', { is_test_season: true });
    // Every request that sends the flag rebuilds for the stored value.
    expect(rebuildRatingsAfterTestFlagChange).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
    expect(logAuditEvent).toHaveBeenCalledWith({
      actor_id: 'admin-1',
      actor_name: 'Admin',
      action: 'season.set_test_flag',
      resource_type: 'season',
      resource_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      resource_name: 'Season One',
      // The flag read before the write found it off, so the change is recorded.
      metadata: {
        is_test_season: true,
        changed: true,
        rating_rebuild: { players: 0, rebuilt: 0, passes: 0, settled: true, unrated_matches: 0 },
        rating_rebuild_error: null,
      },
    });
    // The league's own reads and the public season list it leaves (or rejoins).
    expect(revalidateTag).toHaveBeenCalledWith('season:cccccccc-cccc-4ccc-8ccc-cccccccccccc', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith('seasons', { expire: 0 });
  });

  it('lets a site admin clear the flag', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(updateSeason).mockResolvedValue(mockSeason);

    const response = await patch({ is_test_season: false });

    expect(response.status).toBe(200);
    expect(updateSeason).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', { is_test_season: false });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'season.set_test_flag', metadata: expect.objectContaining({ is_test_season: false }) }),
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
    expect(updateSeason).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', { name: 'Renamed' });
    // The general edit is audited, the test flag is not touched.
    expect(logAuditEvent).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'season.set_test_flag' }));
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

describe('PATCH /api/seasons/[id] — league type and the custom format', () => {
  const SEASON_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const attachedSummary = {
    season_id: SEASON_ID,
    definition_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    version_no: 1,
    spec_hash: 'a'.repeat(64),
    tunables: {},
    engine: 'kit' as const,
    frozen_at: '2026-10-05T00:00:00.000Z',
    amendments: [],
  };
  const patch = (body: Record<string, unknown>) =>
    PATCH({ json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest, makeRouteArgs(SEASON_ID));

  /** The league as it is stored before the PATCH: its current type. */
  const storedAs = (formatType: SeasonWithDetails['format_type']) =>
    vi.mocked(getSeasonById).mockResolvedValue({ ...mockSeason, format_type: formatType, status: 'upcoming' });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(updateSeason).mockImplementation(async (_id, input) => ({ ...mockSeason, ...input }) as never);
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(null);
    vi.mocked(getSeasonStartSignals).mockResolvedValue({ status: 'upcoming', phases: [] });
    // The settings guard (league type lock) reads the phases' start signals for any real change of the type.
    vi.mocked(getSeasonPhaseStartSignals).mockResolvedValue([]);
  });

  it('singles to doubles: allowed, and no format or start read happens', async () => {
    storedAs('singles');
    const response = await patch({ format_type: 'doubles' });
    expect(response.status).toBe(200);
    expect(updateSeason).toHaveBeenCalledWith(SEASON_ID, { format_type: 'doubles' });
    expect(getSeasonFormatSummary).not.toHaveBeenCalled();
    expect(getSeasonStartSignals).not.toHaveBeenCalled();
  });

  it('singles to draft: allowed, and the custom guard reads nothing', async () => {
    storedAs('singles');
    expect((await patch({ format_type: 'draft' })).status).toBe(200);
    expect(getSeasonFormatSummary).not.toHaveBeenCalled();
    expect(getSeasonStartSignals).not.toHaveBeenCalled();
  });

  it.each([
    ['draft', 'evolution_point_buy'],
    ['evolution_point_buy', 'singles'],
  ] as const)('%s to %s: the point-buy lock of the settings guard answers, not the custom guard', async (from, to) => {
    storedAs(from);
    const response = await patch({ format_type: to });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('SEASON_FORMAT_POINT_BUY_LOCKED');
    expect(getSeasonFormatSummary).not.toHaveBeenCalled();
    expect(getSeasonStartSignals).not.toHaveBeenCalled();
    expect(updateSeason).not.toHaveBeenCalled();
  });

  it('a started league cannot change between classic types: the settings guard answers, the custom guard reads nothing', async () => {
    storedAs('singles');
    vi.mocked(getSeasonPhaseStartSignals).mockResolvedValue([{ status: 'active', rounds_total: 3 }] as never);
    const response = await patch({ format_type: 'draft' });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('SEASON_FORMAT_LOCKED');
    expect(getSeasonFormatSummary).not.toHaveBeenCalled();
    expect(getSeasonStartSignals).not.toHaveBeenCalled();
  });

  it('a PATCH without format_type reads nothing about the format', async () => {
    storedAs('custom');
    expect((await patch({ name: 'Renamed' })).status).toBe(200);
    expect(getSeasonFormatSummary).not.toHaveBeenCalled();
    expect(getSeasonStartSignals).not.toHaveBeenCalled();
  });

  it('singles to custom: allowed while the league is upcoming and has no format', async () => {
    storedAs('singles');
    expect((await patch({ format_type: 'custom' })).status).toBe(200);
    expect(updateSeason).toHaveBeenCalledWith(SEASON_ID, { format_type: 'custom' });
  });

  it('singles to custom after the league started: 409 season_format_type_locked, nothing written', async () => {
    storedAs('singles');
    vi.mocked(getSeasonStartSignals).mockResolvedValue({ status: 'upcoming', phases: [{ status: 'upcoming', rounds_total: 1 }] });
    const response = await patch({ format_type: 'custom' });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.code).toBe('season_format_type_locked');
    expect(updateSeason).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('custom with an attached format to singles: 409 season_format_type_locked, nothing written', async () => {
    storedAs('custom');
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(attachedSummary);
    const response = await patch({ format_type: 'singles' });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('season_format_type_locked');
    expect(updateSeason).not.toHaveBeenCalled();
  });

  it('custom without a format back to singles: allowed while upcoming', async () => {
    storedAs('custom');
    expect((await patch({ format_type: 'singles' })).status).toBe(200);
    expect(updateSeason).toHaveBeenCalledTimes(1);
  });

  it('custom to custom: unchanged, allowed even with an attached format', async () => {
    storedAs('custom');
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(attachedSummary);
    vi.mocked(getSeasonStartSignals).mockResolvedValue({ status: 'active', phases: [] });
    expect((await patch({ format_type: 'custom', name: 'Renamed' })).status).toBe(200);
    expect(getSeasonFormatSummary).not.toHaveBeenCalled();
  });

  it('refuses before any other write of the same request (point-buy binding, test flag)', async () => {
    storedAs('custom');
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(attachedSummary);
    const response = await patch({ format_type: 'singles', point_buy_list_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
    expect(response.status).toBe(409);
    expect(updateSeason).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('answers the typed 409 the database trigger gives when the status is set to active without a format', async () => {
    const { FormatStudioError } = await import('@/lib/format-studio/errors');
    storedAs('custom');
    vi.mocked(updateSeason).mockRejectedValue(new FormatStudioError('format_not_attached'));
    const response = await patch({ status: 'active' });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('format_not_attached');
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
    const response = await DELETE(request, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
  });

  it('deletes season and reports no rebuild warning', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(deleteSeason).mockResolvedValue(undefined);

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ rebuild_warning: null });
    expect(vi.mocked(deleteSeason)).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(revalidateTag).toHaveBeenCalledWith('season:cccccccc-cccc-4ccc-8ccc-cccccccccccc', { expire: 0 });
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
    const response = await DELETE(request, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    // Participants captured BEFORE the cascade removes the rows.
    expect(getSeasonParticipants).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(vi.mocked(getSeasonParticipants).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deleteSeason).mock.invocationCallOrder[0]
    );

    // Rebuild runs after the delete committed, with the captured players.
    expect(rebuildAfterSeasonDelete).toHaveBeenCalledWith({
      seasonId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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
        resource_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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
      const response = await DELETE(request, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      // The admin sees the failure (catalogued code), the internals stay in the log.
      expect(body.data.rebuild_warning).toEqual({
        code: 'derived_data_rebuild_failed',
        error: expect.stringContaining('rebuilding the derived data'),
      });
      expect(JSON.stringify(body)).not.toContain('rebuild blew up');
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

  it('records the distinct cause when the rebuild refuses with a catalog code', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(deleteSeason).mockResolvedValue(undefined);
    vi.mocked(rebuildAfterSeasonDelete).mockRejectedValue(
      new UserFacingError('Rating history has gaps that no rebuild order can fill', {
        code: 'rating_history_incomplete',
        params: { count: 1, players: 'Alice, Bob' },
        status: 409,
      })
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await DELETE({} as unknown as NextRequest, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.rebuild_warning).toEqual({
        code: 'rating_history_incomplete',
        error: 'Rating history has gaps that no rebuild order can fill',
        params: { count: 1, players: 'Alice, Bob' },
      });
      expect(errorSpy).toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'season.delete',
          metadata: expect.objectContaining({ rebuild_error: 'rating_history_incomplete' }),
        })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('answers 409 SEASON_HAS_DEPENDENTS with nothing rebuilt or audited when the delete is refused', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason);
    vi.mocked(getSeasonParticipants).mockResolvedValue([]);
    vi.mocked(rebuildAfterSeasonDelete).mockClear();
    vi.mocked(logAuditEvent).mockClear();
    // The real deleteSeason throws SeasonHasDependentsError (a UserFacingError) on SQLSTATE 23503.
    vi.mocked(deleteSeason).mockRejectedValue(
      new UserFacingError('This league still has phases, draft pools, teams or storylines that point to it.', {
        code: 'SEASON_HAS_DEPENDENTS',
        status: 409,
      }),
    );

    const response = await DELETE({} as unknown as NextRequest, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ success: false, code: 'SEASON_HAS_DEPENDENTS' });
    expect(rebuildAfterSeasonDelete).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(deleteSeason).mockRejectedValue(new Error('FK constraint'));

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to delete league');
  });
});
