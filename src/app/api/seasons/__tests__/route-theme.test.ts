import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';
import type { SeasonWithDetails } from '@/types/season';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  requireAnyAdmin: vi.fn(),
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
  listSeasons: vi.fn(),
  listArchivedSeasons: vi.fn(),
  createSeason: vi.fn(),
  getSeasonWithDetails: vi.fn(),
  updateSeason: vi.fn(),
  deleteSeason: vi.fn(),
  getSeasonById: vi.fn(),
  getSeasonParticipants: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  addResourceAdmin: vi.fn(),
}));

vi.mock('@/lib/season/format-rules-defaults', () => ({
  initializeEpbFormatRules: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getActiveListVersion: vi.fn(),
  bindSeasonToList: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
  diffField: (changes: Record<string, { before: unknown; after: unknown }>, field: string, before: unknown, after: unknown) => {
    if (before !== after) changes[field] = { before, after };
  },
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  archiveTournamentsBySeason: vi.fn(),
}));

vi.mock('@/lib/reconcile/entity-delete-rebuild', () => ({
  rebuildAfterSeasonDelete: vi.fn(),
}));

import { POST } from '@/app/api/seasons/route';
import { PATCH } from '@/app/api/seasons/[id]/route';
import { requireAnyAdmin, requireResourceAdmin } from '@/lib/auth/helpers';
import { createSeason, getSeasonById, updateSeason } from '@/lib/supabase/queries/seasons';

const mockSeason: SeasonWithDetails = {
  id: '37cf71ba-cf9d-4d37-8438-1fd49beed938',
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

/** Every value the DB CHECK constraint allows — wider than the registered
 *  client theme set (sakura/mountain/clouds land in C-093+). */
const CHECK_LIST = ['auto', 'plaza', 'sakura', 'mountain', 'clouds'] as const;

function makePostRequest(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

function makePatchArgs(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/seasons — route_theme pass-through', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAnyAdmin).mockResolvedValue(adminPlayer);
  });

  it('accepts every CHECK-listed route_theme value and passes it through', async () => {
    for (const route_theme of CHECK_LIST) {
      vi.mocked(createSeason).mockResolvedValue({ ...mockSeason, route_theme });
      const response = await POST(makePostRequest({
        name: 'Season One',
        format_type: 'singles',
        route_theme,
      }));
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.route_theme).toBe(route_theme);
      expect(vi.mocked(createSeason)).toHaveBeenLastCalledWith(
        expect.objectContaining({ route_theme }),
      );
    }
    expect(vi.mocked(createSeason)).toHaveBeenCalledTimes(CHECK_LIST.length);
  });

  it('omits route_theme when not supplied so the DB default applies', async () => {
    vi.mocked(createSeason).mockResolvedValue(mockSeason);

    const response = await POST(makePostRequest({
      name: 'Season One',
      format_type: 'singles',
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(vi.mocked(createSeason).mock.calls[0][0]).not.toHaveProperty('route_theme');
  });

  it('rejects an unknown route_theme string with 400 and a field-scoped safe message', async () => {
    const response = await POST(makePostRequest({
      name: 'Season One',
      format_type: 'singles',
      route_theme: 'neon-city',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('route_theme');
    expect(vi.mocked(createSeason)).not.toHaveBeenCalled();
  });

  it('rejects a non-string route_theme with 400 (type-validated, not coerced)', async () => {
    const response = await POST(makePostRequest({
      name: 'Season One',
      format_type: 'singles',
      route_theme: 42,
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('route_theme');
    expect(vi.mocked(createSeason)).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/seasons/[id] — route_theme round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    // The route reads the stored league once, before any guard or write.
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason);
  });

  it('round-trips a route_theme pick through updateSeason', async () => {
    const updated = { ...mockSeason, route_theme: 'plaza' as const };
    vi.mocked(updateSeason).mockResolvedValue(updated);

    const response = await PATCH(
      makePostRequest({ route_theme: 'plaza' }),
      makePatchArgs('37cf71ba-cf9d-4d37-8438-1fd49beed938'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ ...updated, rating_rebuild: null, rebuild_warning: null });
    expect(vi.mocked(updateSeason)).toHaveBeenCalledWith('37cf71ba-cf9d-4d37-8438-1fd49beed938', { route_theme: 'plaza' });
  });

  it('accepts every CHECK-listed value on update (including switching back to auto)', async () => {
    for (const route_theme of CHECK_LIST) {
      vi.mocked(updateSeason).mockResolvedValue({ ...mockSeason, route_theme });
      const response = await PATCH(
        makePostRequest({ route_theme }),
        makePatchArgs('37cf71ba-cf9d-4d37-8438-1fd49beed938'),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.route_theme).toBe(route_theme);
      expect(vi.mocked(updateSeason)).toHaveBeenLastCalledWith('37cf71ba-cf9d-4d37-8438-1fd49beed938', { route_theme });
    }
    expect(vi.mocked(updateSeason)).toHaveBeenCalledTimes(CHECK_LIST.length);
  });

  it('rejects an unknown route_theme with 400 before touching the database', async () => {
    const response = await PATCH(
      makePostRequest({ route_theme: 'volcano' }),
      makePatchArgs('37cf71ba-cf9d-4d37-8438-1fd49beed938'),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('route_theme');
    expect(vi.mocked(updateSeason)).not.toHaveBeenCalled();
  });
});
