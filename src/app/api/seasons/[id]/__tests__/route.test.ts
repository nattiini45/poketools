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
  getSeasonById: vi.fn(),
}));

// The recycle bin: the database functions behind the DELETE (league-trash.test.ts and the SQL lab cover them).
vi.mock('@/lib/supabase/queries/league-trash', () => ({
  moveLeagueToTrash: vi.fn(),
  getLeagueTrashBySeason: vi.fn(),
  listPendingLeagueRebuilds: vi.fn(),
  markLeagueTrashRebuildDone: vi.fn(),
  markLeagueRestoreRebuildDone: vi.fn(),
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
  rebuildAfterSeasonRestore: vi.fn(),
}));

// The custom league type guard reads the attached format and the start signals only for a change involving `custom`.
vi.mock('@/lib/supabase/queries/season-formats', () => ({
  getSeasonFormatSummary: vi.fn(),
  getSeasonStartSignals: vi.fn(),
}));

vi.mock('@/lib/ruleset-studio/pin-change', () => ({ assertRulesetChangeAllowed: vi.fn() }));

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
import { getSeasonWithDetails, updateSeason, getSeasonById } from '@/lib/supabase/queries/seasons';
import {
  getLeagueTrashBySeason,
  listPendingLeagueRebuilds,
  markLeagueTrashRebuildDone,
  moveLeagueToTrash,
} from '@/lib/supabase/queries/league-trash';
import { LeagueTrashDbError } from '@/lib/league-trash/db-error';
import { LEAGUE_TRASH_RETENTION_DAYS } from '@/lib/league-trash/constants';
import { rebuildAfterSeasonDelete } from '@/lib/reconcile/entity-delete-rebuild';
import { logAuditEvent } from '@/lib/audit/log';
import { archiveTournamentsBySeason } from '@/lib/supabase/queries/tournaments';
import { rebuildRatingsAfterTestFlagChange } from '@/lib/rating/test-league-rebuild';
import { getSeasonFormatSummary, getSeasonStartSignals } from '@/lib/supabase/queries/season-formats';
import { getSeasonPhaseStartSignals } from '@/lib/supabase/queries/season-start';
import { assertRulesetChangeAllowed } from '@/lib/ruleset-studio/pin-change';
import { RulesetStudioError } from '@/lib/ruleset-studio/errors';
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

describe('DELETE /api/seasons/[id] (the league goes to the trash)', () => {
  const SEASON_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const TRASH_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const PHASES = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const PLAYERS = ['p1', 'p2'];
  const PURGE_AFTER = '2027-01-24T10:00:00.000Z';

  const moved = {
    trash_id: TRASH_ID,
    season_id: SEASON_ID,
    season_name: 'Season One',
    deleted_at: '2026-10-26T10:00:00.000Z',
    purge_after: PURGE_AFTER,
    counts: { matches: 12, games: 30 },
    player_ids: PLAYERS,
    phase_ids: PHASES,
    frozen_pools: 1,
    schema_version: '20261026091500',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(moveLeagueToTrash).mockResolvedValue(moved);
    vi.mocked(markLeagueTrashRebuildDone).mockResolvedValue(true);
    vi.mocked(rebuildAfterSeasonDelete).mockResolvedValue({
      scope: 'season',
      playerIds: PLAYERS,
      ratingsRebuilt: 2,
      streaksRebuilt: 2,
      tournamentScopeCleared: null,
      leagueScope: null,
      allTime: { gamesProcessed: 0, aggregatesDeleted: 0, playerAggregatesDeleted: 0 },
      evolutionRepair: null,
    } as never);
  });

  const call = (id = SEASON_ID) => DELETE({} as unknown as NextRequest, makeRouteArgs(id));

  it('returns 403 when not admin, and never touches the trash', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required', 403),
    );

    const response = await call();

    expect(response.status).toBe(403);
    expect((await response.json()).success).toBe(false);
    expect(moveLeagueToTrash).not.toHaveBeenCalled();
  });

  it('answers 404 INVALID_SEASON_ID for a malformed id before any database call', async () => {
    const response = await call('not-a-uuid');

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('INVALID_SEASON_ID');
    expect(moveLeagueToTrash).not.toHaveBeenCalled();
  });

  it('moves the league to the trash by the acting admin, reports the trash entry and no rebuild warning', async () => {
    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { rebuild_warning: null, trash: { id: TRASH_ID, purge_after: PURGE_AFTER } },
    });
    expect(moveLeagueToTrash).toHaveBeenCalledWith(SEASON_ID, 'admin-1');
  });

  it('keeps the retention window a database matter: the route passes no days of its own', async () => {
    await call();

    expect(vi.mocked(moveLeagueToTrash).mock.calls[0]).toEqual([SEASON_ID, 'admin-1']);
    expect(LEAGUE_TRASH_RETENTION_DAYS).toBeGreaterThan(0);
  });

  it('expires the league, its phases and the lists, then the aggregate and rating reads after the rebuild', async () => {
    await call();

    const tags = vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag);
    expect(tags).toEqual(
      expect.arrayContaining([
        `season:${SEASON_ID}`,
        'seasons',
        'tournaments',
        'player-profiles',
        `tournament:${PHASES[0]}`,
        `tournament:${PHASES[1]}`,
        `aggregates:league:${SEASON_ID}`,
        'aggregates:all_time',
        `aggregates:tournament:${PHASES[0]}`,
        `aggregates:tournament:${PHASES[1]}`,
        'ratings',
        'player:p1',
        'player:p2',
      ]),
    );
    // The league's reads go first (it is gone from every read), the aggregates only once the rebuild ran.
    const aggregateExpiry = vi.mocked(revalidateTag).mock.invocationCallOrder[tags.indexOf('aggregates:all_time')];
    expect(vi.mocked(rebuildAfterSeasonDelete).mock.invocationCallOrder[0]).toBeLessThan(aggregateExpiry);
    expect(vi.mocked(revalidateTag).mock.invocationCallOrder[tags.indexOf(`season:${SEASON_ID}`)]).toBeLessThan(
      vi.mocked(rebuildAfterSeasonDelete).mock.invocationCallOrder[0],
    );
  });

  it('rebuilds the derived data with the participants and phases the delete returned, then confirms it', async () => {
    await call();

    expect(rebuildAfterSeasonDelete).toHaveBeenCalledWith({
      seasonId: SEASON_ID,
      playerIds: PLAYERS,
      phaseIds: PHASES,
    });
    expect(markLeagueTrashRebuildDone).toHaveBeenCalledWith(TRASH_ID);
    expect(vi.mocked(markLeagueTrashRebuildDone).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(rebuildAfterSeasonDelete).mock.invocationCallOrder[0],
    );
  });

  it('audit-logs the delete with the trash entry, the counts and the rebuild summary', async () => {
    await call();

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'season.delete',
        actor_id: 'admin-1',
        resource_type: 'season',
        resource_id: SEASON_ID,
        resource_name: 'Season One',
        metadata: expect.objectContaining({
          trash_id: TRASH_ID,
          purge_after: PURGE_AFTER,
          counts: { matches: 12, games: 30 },
          frozen_pools: 1,
          rebuild: expect.objectContaining({ scope: 'season' }),
          rebuild_error: null,
        }),
      }),
    );
  });

  it('still returns success when the derived-data rebuild fails, leaves the rebuild unconfirmed and keeps the cause', async () => {
    vi.mocked(rebuildAfterSeasonDelete).mockRejectedValue(new Error('rebuild blew up'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await call();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      // The admin sees the failure (catalogued code), the internals stay in the log.
      expect(body.data.rebuild_warning).toEqual({
        code: 'derived_data_rebuild_failed',
        error: expect.stringContaining('rebuilding the derived data'),
      });
      expect(body.data.trash).toEqual({ id: TRASH_ID, purge_after: PURGE_AFTER });
      expect(JSON.stringify(body)).not.toContain('rebuild blew up');
      expect(errorSpy).toHaveBeenCalled();
      // Without the confirmation the entry is never purged: the superadmin runs the rebuild again.
      expect(markLeagueTrashRebuildDone).not.toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'season.delete',
          metadata: expect.objectContaining({ rebuild_error: 'derived_data_rebuild_failed' }),
        }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('records the distinct cause when the rebuild refuses with a catalog code', async () => {
    vi.mocked(rebuildAfterSeasonDelete).mockRejectedValue(
      new UserFacingError('Rating history has gaps that no rebuild order can fill', {
        code: 'rating_history_incomplete',
        params: { count: 1, players: 'Alice, Bob' },
        status: 409,
      }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const body = await (await call()).json();

      expect(body.data.rebuild_warning).toEqual({
        code: 'rating_history_incomplete',
        error: 'Rating history has gaps that no rebuild order can fill',
        params: { count: 1, players: 'Alice, Bob' },
      });
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ rebuild_error: 'rating_history_incomplete' }) }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('answers 404 SEASON_NOT_FOUND for a league that does not exist, with nothing rebuilt or audited', async () => {
    vi.mocked(moveLeagueToTrash).mockRejectedValue(new LeagueTrashDbError('LEAGUE_TRASH_SEASON_NOT_FOUND'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await call();

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ success: false, code: 'SEASON_NOT_FOUND' });
      expect(rebuildAfterSeasonDelete).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
      expect(revalidateTag).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it.each([
    ['LEAGUE_TRASH_BUSY', 409],
    ['LEAGUE_TRASH_INVENTORY_INCOMPLETE', 500],
  ] as const)('maps %s to a coded %i and keeps table names out of the body', async (code, status) => {
    vi.mocked(moveLeagueToTrash).mockRejectedValue(new LeagueTrashDbError(code, { rels: ['secret_table'] }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await call();
      const text = JSON.stringify(await response.json());

      expect(response.status).toBe(status);
      expect(text).toContain(code);
      expect(text).not.toContain('secret_table');
      expect(rebuildAfterSeasonDelete).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  describe('a request deadline (the delete may still have committed)', () => {
    const timeout = () => new LeagueTrashDbError('LEAGUE_TRASH_TIMEOUT');

    beforeEach(() => {
      vi.mocked(moveLeagueToTrash).mockRejectedValue(timeout());
    });

    it('continues as a success when the trash holds the league, rebuilding from the pending marker', async () => {
      vi.mocked(getLeagueTrashBySeason).mockResolvedValue({ id: TRASH_ID, purge_after: PURGE_AFTER });
      vi.mocked(listPendingLeagueRebuilds).mockResolvedValue([
        {
          kind: 'delete',
          trash_id: TRASH_ID,
          season_id: SEASON_ID,
          season_name: 'Season One',
          at: '2026-10-26T10:00:00.000Z',
          phase_ids: PHASES,
          player_ids: PLAYERS,
        },
      ]);

      const response = await call();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.trash).toEqual({ id: TRASH_ID, purge_after: PURGE_AFTER });
      expect(getLeagueTrashBySeason).toHaveBeenCalledWith(SEASON_ID);
      expect(rebuildAfterSeasonDelete).toHaveBeenCalledWith({ seasonId: SEASON_ID, playerIds: PLAYERS, phaseIds: PHASES });
      expect(markLeagueTrashRebuildDone).toHaveBeenCalledWith(TRASH_ID);
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'season.delete', resource_name: 'Season One' }),
      );
    });

    it('answers 504 LEAGUE_TRASH_TIMEOUT when the trash does not hold the league', async () => {
      vi.mocked(getLeagueTrashBySeason).mockResolvedValue(null);

      const response = await call();

      expect(response.status).toBe(504);
      expect(await response.json()).toMatchObject({ success: false, code: 'LEAGUE_TRASH_TIMEOUT' });
      expect(rebuildAfterSeasonDelete).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });
  });

  it('returns 500 on an unexpected error', async () => {
    vi.mocked(moveLeagueToTrash).mockRejectedValue(new Error('connection reset'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await call();
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Failed to delete league');
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('PATCH /api/seasons/[id] — the league ruleset pin', () => {
  const SEASON_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const PINNED = '00000000-0000-4000-8000-0000000000a1';
  const NEXT = '00000000-0000-4000-8000-0000000000b2';
  const patch = (body: Record<string, unknown>) =>
    PATCH({ json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest, makeRouteArgs(SEASON_ID));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getSeasonById).mockResolvedValue({ ...mockSeason, ruleset_id: PINNED, status: 'active' });
    vi.mocked(updateSeason).mockImplementation(async (_id, input) => ({ ...mockSeason, ...input }) as never);
    vi.mocked(getSeasonPhaseStartSignals).mockResolvedValue([{ status: 'active', rounds_total: 2 }] as never);
  });

  it('asks the pin guard with the stored pin, the requested one and whether the league has started', async () => {
    vi.mocked(assertRulesetChangeAllowed).mockResolvedValue(undefined);
    expect((await patch({ ruleset_id: NEXT })).status).toBe(200);
    expect(assertRulesetChangeAllowed).toHaveBeenCalledWith({ player: adminPlayer, current: PINNED, requested: NEXT, started: true });
  });

  it('a refused change writes nothing', async () => {
    vi.mocked(assertRulesetChangeAllowed).mockRejectedValue(new RulesetStudioError('ruleset_pin_started'));
    const response = await patch({ ruleset_id: NEXT });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('ruleset_pin_started');
    expect(updateSeason).not.toHaveBeenCalled();
  });

  it('resending the stored ruleset (a settings form always sends it) reads and checks nothing', async () => {
    expect((await patch({ ruleset_id: PINNED, name: 'Renamed' })).status).toBe(200);
    expect(assertRulesetChangeAllowed).not.toHaveBeenCalled();
    expect(getSeasonPhaseStartSignals).not.toHaveBeenCalled();
  });
});
