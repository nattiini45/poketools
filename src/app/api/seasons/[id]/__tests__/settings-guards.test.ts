/**
 * PATCH /api/seasons/[id] settings guards (league type lock, date order, the
 * stored-league read) and the season.update audit record; plus the date order
 * of POST /api/seasons. The test-flag and archive behaviour is in route.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Season } from '@/types/season';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  requireResourceAdmin: vi.fn(),
  requireAnyAdmin: vi.fn(),
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
  listSeasons: vi.fn(),
  listArchivedSeasons: vi.fn(),
  createSeason: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  archiveTournamentsBySeason: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/season-start', () => ({
  getSeasonPhaseStartSignals: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/resource-admins', () => ({ addResourceAdmin: vi.fn() }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getActiveListVersion: vi.fn(),
  bindSeasonToList: vi.fn(),
}));
vi.mock('@/lib/season/format-rules-defaults', () => ({ initializeEpbFormatRules: vi.fn() }));
vi.mock('@/lib/season/point-buy-battle-ruleset', () => ({ ensurePointBuyBattleRuleset: vi.fn() }));
vi.mock('@/lib/reconcile/entity-delete-rebuild', () => ({ rebuildAfterSeasonDelete: vi.fn() }));
vi.mock('@/lib/rating/test-league-rebuild', () => ({ rebuildRatingsAfterTestFlagChange: vi.fn() }));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
  diffField: (
    changes: Record<string, { before: unknown; after: unknown }>,
    field: string,
    before: unknown,
    after: unknown
  ) => {
    if (before !== after) changes[field] = { before, after };
  },
}));

import { PATCH } from '@/app/api/seasons/[id]/route';
import { POST } from '@/app/api/seasons/route';
import { requireAnyAdmin, requireResourceAdmin } from '@/lib/auth/helpers';
import { getSeasonById, updateSeason, createSeason } from '@/lib/supabase/queries/seasons';
import { getSeasonPhaseStartSignals } from '@/lib/supabase/queries/season-start';
import { logAuditEvent } from '@/lib/audit/log';

const SEASON_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const stored: Season = {
  id: SEASON_ID,
  name: 'Season One',
  description: 'First season',
  format_type: 'singles',
  status: 'upcoming',
  archived: false,
  legacy: false,
  is_test_season: false,
  start_date: '2026-03-01',
  end_date: '2026-06-30',
  ruleset_id: '00000000-0000-4000-8000-000000000001',
  core_pool: null,
  point_buy_list_id: null,
  language: 'de',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const leagueAdmin = {
  playerId: 'league-admin-1',
  name: 'League Admin',
  isAdmin: false,
  isResourceAdmin: true,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active' as const,
};

const patch = (body: unknown) =>
  PATCH({ json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest, {
    params: Promise.resolve({ id: SEASON_ID }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue(leagueAdmin);
  vi.mocked(getSeasonById).mockResolvedValue(stored);
  vi.mocked(getSeasonPhaseStartSignals).mockResolvedValue([]);
  vi.mocked(updateSeason).mockImplementation(async (_id, input) => ({ ...stored, ...input }) as Season);
});

describe('PATCH /api/seasons/[id]: stored league', () => {
  it('answers an unknown league with 404 SEASON_NOT_FOUND and writes nothing', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(null);

    const response = await patch({ name: 'Renamed' });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ success: false, error: 'League not found', code: 'SEASON_NOT_FOUND' });
    expect(updateSeason).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('reads the stored league exactly once', async () => {
    await patch({ name: 'Renamed' });
    expect(getSeasonById).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH /api/seasons/[id]: league type lock', () => {
  const active = { ...stored, status: 'active' as const };

  it('refuses a league type change on an active league with 409 SEASON_FORMAT_LOCKED, nothing written', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(active);

    const response = await patch({ format_type: 'draft' });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ success: false, code: 'SEASON_FORMAT_LOCKED' });
    expect(updateSeason).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('refuses a change when a phase of an upcoming league already has a round', async () => {
    vi.mocked(getSeasonPhaseStartSignals).mockResolvedValue([{ status: 'upcoming', rounds_total: 1 }]);

    const response = await patch({ format_type: 'doubles' });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('SEASON_FORMAT_LOCKED');
    expect(updateSeason).not.toHaveBeenCalled();
  });

  it('refuses a change when a phase is no longer upcoming', async () => {
    vi.mocked(getSeasonPhaseStartSignals).mockResolvedValue([
      { status: 'upcoming', rounds_total: 0 },
      { status: 'active', rounds_total: 0 },
    ]);

    const response = await patch({ format_type: 'doubles' });

    expect(response.status).toBe(409);
    expect(updateSeason).not.toHaveBeenCalled();
  });

  it('lets the stored league type be resent on an active league, without reading the phases', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(active);

    const response = await patch({ name: 'Renamed', format_type: 'singles' });

    expect(response.status).toBe(200);
    expect(getSeasonPhaseStartSignals).not.toHaveBeenCalled();
    expect(updateSeason).toHaveBeenCalledWith(SEASON_ID, { name: 'Renamed', format_type: 'singles' });
  });

  it('lets a never-started league change its type and audits the change', async () => {
    const response = await patch({ format_type: 'doubles' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.format_type).toBe('doubles');
    expect(getSeasonPhaseStartSignals).toHaveBeenCalledWith(SEASON_ID);
    expect(updateSeason).toHaveBeenCalledWith(SEASON_ID, { format_type: 'doubles' });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'season.update',
        changes: { format_type: { before: 'singles', after: 'doubles' } },
      })
    );
  });

  it('refuses switching a classic league to point buy before the start (409 SEASON_FORMAT_POINT_BUY_LOCKED)', async () => {
    const response = await patch({ format_type: 'evolution_point_buy' });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('SEASON_FORMAT_POINT_BUY_LOCKED');
    expect(updateSeason).not.toHaveBeenCalled();
  });

  it('refuses switching a point-buy league to another type before the start', async () => {
    vi.mocked(getSeasonById).mockResolvedValue({ ...stored, format_type: 'evolution_point_buy' });

    const response = await patch({ format_type: 'singles' });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('SEASON_FORMAT_POINT_BUY_LOCKED');
    expect(updateSeason).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/seasons/[id]: date order', () => {
  it('refuses an end date before the stored start date (only end_date sent), nothing written', async () => {
    const response = await patch({ end_date: '2026-02-01' });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false, code: 'SEASON_DATES_INVALID' });
    expect(updateSeason).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('refuses a start date after the stored end date (only start_date sent)', async () => {
    const response = await patch({ start_date: '2026-07-01' });

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('SEASON_DATES_INVALID');
    expect(updateSeason).not.toHaveBeenCalled();
  });

  it('refuses a reversed pair sent together', async () => {
    const response = await patch({ start_date: '2026-09-01', end_date: '2026-08-01' });

    expect(response.status).toBe(400);
    expect(updateSeason).not.toHaveBeenCalled();
  });

  it('accepts equal dates and clearing a date with null', async () => {
    expect((await patch({ start_date: '2026-06-30' })).status).toBe(200);
    expect((await patch({ end_date: null })).status).toBe(200);
    expect(updateSeason).toHaveBeenCalledTimes(2);
  });

  it('does not hold a request that sends neither date to a range the league already stores', async () => {
    vi.mocked(getSeasonById).mockResolvedValue({ ...stored, start_date: '2026-09-01', end_date: '2026-01-01' });

    const response = await patch({ name: 'Renamed' });

    expect(response.status).toBe(200);
    expect(updateSeason).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH /api/seasons/[id]: season.update audit', () => {
  it('writes one audit row with the changed fields only and no description text', async () => {
    const response = await patch({
      name: 'Renamed',
      description: 'A secret blurb that must not reach the log',
      start_date: '2026-03-01',
      end_date: '2026-07-31',
    });

    expect(response.status).toBe(200);
    const updates = vi.mocked(logAuditEvent).mock.calls.filter(([entry]) => entry.action === 'season.update');
    expect(updates).toHaveLength(1);
    expect(updates[0][0]).toEqual({
      actor_id: 'league-admin-1',
      actor_name: 'League Admin',
      action: 'season.update',
      resource_type: 'season',
      resource_id: SEASON_ID,
      resource_name: 'Renamed',
      changes: {
        name: { before: 'Season One', after: 'Renamed' },
        end_date: { before: '2026-06-30', after: '2026-07-31' },
      },
      metadata: { description_changed: true },
    });
    expect(JSON.stringify(updates[0][0])).not.toContain('secret blurb');
  });

  it('records a description-only edit as a flag without a diff', async () => {
    await patch({ description: 'New text' });

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'season.update', changes: {}, metadata: { description_changed: true } })
    );
  });

  it('records the status, archive, theme and language fields', async () => {
    await patch({ status: 'active', archived: true, route_theme: 'plaza', language: 'en' });

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'season.update',
        changes: {
          status: { before: 'upcoming', after: 'active' },
          archived: { before: false, after: true },
          route_theme: { before: undefined, after: 'plaza' },
          language: { before: 'de', after: 'en' },
        },
        metadata: undefined,
      })
    );
  });

  it('writes no audit row when nothing changed', async () => {
    await patch({ name: 'Season One', description: 'First season' });

    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe('POST /api/seasons: date order', () => {
  const post = (body: unknown) => POST({ json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest);

  beforeEach(() => {
    vi.mocked(requireAnyAdmin).mockResolvedValue(leagueAdmin);
  });

  it('refuses an end date before the start date with 400 SEASON_DATES_INVALID, nothing created', async () => {
    const response = await post({
      name: 'New League',
      format_type: 'singles',
      start_date: '2026-06-01',
      end_date: '2026-05-01',
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false, code: 'SEASON_DATES_INVALID' });
    expect(createSeason).not.toHaveBeenCalled();
  });

  it('creates a league with an ordered range', async () => {
    vi.mocked(createSeason).mockResolvedValue({ ...stored, id: 'new-league' });

    const response = await post({
      name: 'New League',
      format_type: 'singles',
      start_date: '2026-05-01',
      end_date: '2026-06-01',
    });

    expect(response.status).toBe(201);
    expect(createSeason).toHaveBeenCalledTimes(1);
  });
});
