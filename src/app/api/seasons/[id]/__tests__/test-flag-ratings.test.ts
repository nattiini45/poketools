/**
 * PATCH /api/seasons/[id] with `is_test_season`: test leagues stay out of
 * ratings by the CURRENT flag, so every request that sends the flag rebuilds
 * the league players' ratings for the stored value, changed or not (sending
 * it again finishes a rebuild that was cut off; src/lib/rating/
 * test-league-rebuild.ts). A failed rebuild keeps the flag saved and answers
 * `data.rebuild_warning` with a distinct code per cause (AGENTS rule 5),
 * logged and audited.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Season } from '@/types/season';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  requireResourceAdmin: vi.fn(),
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

vi.mock('@/lib/rating/test-league-rebuild', () => ({
  rebuildRatingsAfterTestFlagChange: vi.fn(),
}));

import { PATCH } from '@/app/api/seasons/[id]/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getSeasonById, updateSeason } from '@/lib/supabase/queries/seasons';
import { logAuditEvent } from '@/lib/audit/log';
import {
  rebuildRatingsAfterTestFlagChange,
  type TestFlagRatingRebuildSummary,
} from '@/lib/rating/test-league-rebuild';
import { RatingHistoryIntegrityError } from '@/lib/rating/updateRatings';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { revalidateTag } from 'next/cache';

const SEASON_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const season: Season = {
  id: SEASON_ID,
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
} as Season;

const siteAdmin = {
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

const summary = (isTestSeason: boolean): TestFlagRatingRebuildSummary => ({
  seasonId: SEASON_ID,
  isTestSeason,
  playerIds: ['p1', 'p2'],
  rebuiltPlayerIds: ['p1', 'p2'],
  passes: 2,
  settled: true,
  unratedMatches: isTestSeason ? 0 : 3,
});

const patch = (body: unknown) =>
  PATCH({ json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest, {
    params: Promise.resolve({ id: SEASON_ID }),
  });

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue(siteAdmin);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  return () => errorSpy.mockRestore();
});

describe('PATCH /api/seasons/[id] — test-league flag and ratings', () => {
  it('turning the flag ON rebuilds the league players and reports the summary', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(season);
    vi.mocked(updateSeason).mockResolvedValue({ ...season, is_test_season: true });
    vi.mocked(rebuildRatingsAfterTestFlagChange).mockResolvedValue(summary(true));

    const response = await patch({ is_test_season: true });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(rebuildRatingsAfterTestFlagChange).toHaveBeenCalledWith(SEASON_ID, true);
    // The rebuild runs after the flag is written (it replays under the new flag).
    expect(vi.mocked(updateSeason).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(rebuildRatingsAfterTestFlagChange).mock.invocationCallOrder[0],
    );
    expect(body.data).toMatchObject({ is_test_season: true, rating_rebuild: summary(true), rebuild_warning: null });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'season.set_test_flag',
        // Counts only, never the player lists.
        metadata: {
          is_test_season: true,
          changed: true,
          rating_rebuild: { players: 2, rebuilt: 2, passes: 2, settled: true, unrated_matches: 0 },
          rating_rebuild_error: null,
        },
      }),
    );
    expect(revalidateTag).toHaveBeenCalledWith(`season:${SEASON_ID}`, { expire: 0 });
  });

  it('turning the flag OFF rebuilds too (the league matches count again)', async () => {
    vi.mocked(getSeasonById).mockResolvedValue({ ...season, is_test_season: true });
    vi.mocked(updateSeason).mockResolvedValue(season);
    vi.mocked(rebuildRatingsAfterTestFlagChange).mockResolvedValue(summary(false));

    const body = await (await patch({ is_test_season: false })).json();

    expect(rebuildRatingsAfterTestFlagChange).toHaveBeenCalledWith(SEASON_ID, false);
    expect(body.data.rating_rebuild).toEqual(summary(false));
  });

  it('rebuilds for the stored value when the flag is sent unchanged (finishes a cut-off rebuild)', async () => {
    vi.mocked(getSeasonById).mockResolvedValue({ ...season, is_test_season: true });
    vi.mocked(updateSeason).mockResolvedValue({ ...season, is_test_season: true });
    vi.mocked(rebuildRatingsAfterTestFlagChange).mockResolvedValue(summary(true));

    const body = await (await patch({ is_test_season: true })).json();

    expect(rebuildRatingsAfterTestFlagChange).toHaveBeenCalledWith(SEASON_ID, true);
    expect(body.data).toMatchObject({ rating_rebuild: summary(true), rebuild_warning: null });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          changed: false,
          rating_rebuild: { players: 2, rebuilt: 2, passes: 2, settled: true, unrated_matches: 0 },
        }),
      }),
    );
  });

  it('neither reads the flag nor rebuilds for a PATCH without it', async () => {
    vi.mocked(updateSeason).mockResolvedValue({ ...season, name: 'Renamed' });

    const body = await (await patch({ name: 'Renamed' })).json();

    expect(getSeasonById).not.toHaveBeenCalled();
    expect(rebuildRatingsAfterTestFlagChange).not.toHaveBeenCalled();
    expect(body.data.rating_rebuild).toBeNull();
  });

  it('keeps the flag saved when the rebuild fails: 200 with the generic warning code, logged and audited', async () => {
    const error = new Error('replace RPC failed');
    vi.mocked(getSeasonById).mockResolvedValue(season);
    vi.mocked(updateSeason).mockResolvedValue({ ...season, is_test_season: true });
    vi.mocked(rebuildRatingsAfterTestFlagChange).mockRejectedValue(error);

    const response = await patch({ is_test_season: true });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.is_test_season).toBe(true);
    expect(body.data.rating_rebuild).toBeNull();
    expect(body.data.rebuild_warning).toEqual({
      code: 'test_flag_rating_rebuild_failed',
      error: expect.stringContaining('The test-league setting was saved, but rebuilding'),
    });
    // The internal message stays in the server log, not the response.
    expect(JSON.stringify(body)).not.toContain('replace RPC failed');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('rating rebuild failed'), error);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ changed: true, rating_rebuild_error: 'test_flag_rating_rebuild_failed' }),
      }),
    );
  });

  it('answers an unsettled rebuild with the flag saved, its summary and the unsettled warning, logged and audited', async () => {
    const unsettled = { ...summary(true), passes: 8, settled: false };
    vi.mocked(getSeasonById).mockResolvedValue(season);
    vi.mocked(updateSeason).mockResolvedValue({ ...season, is_test_season: true });
    vi.mocked(rebuildRatingsAfterTestFlagChange).mockResolvedValue(unsettled);

    const response = await patch({ is_test_season: true });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ is_test_season: true, rating_rebuild: unsettled });
    expect(body.data.rebuild_warning).toEqual({
      code: 'test_flag_rating_rebuild_unsettled',
      error: errorsAdmin.en.test_flag_rating_rebuild_unsettled,
    });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('rating rebuild not settled after 8 passes'));
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          rating_rebuild: { players: 2, rebuilt: 2, passes: 8, settled: false, unrated_matches: 0 },
          rating_rebuild_error: 'test_flag_rating_rebuild_unsettled',
        }),
      }),
    );
  });

  it('keeps the catalogued code of a rebuild refusal (gap cycle) distinct', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(season);
    vi.mocked(updateSeason).mockResolvedValue({ ...season, is_test_season: true });
    vi.mocked(rebuildRatingsAfterTestFlagChange).mockRejectedValue(
      new RatingHistoryIntegrityError(
        [{ matchId: 'm1', playerId: 'p1', missingPlayerId: 'p2' }],
        new Map([['p1', 'Misty'], ['p2', 'Brock']]),
      ),
    );

    const body = await (await patch({ is_test_season: true })).json();

    expect(body.data.rebuild_warning).toMatchObject({
      code: 'rating_history_incomplete',
      params: { count: 1, players: 'Brock, Misty' },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ rating_rebuild_error: 'rating_history_incomplete' }) }),
    );
  });

  it('a failed flag read fails the PATCH before any write', async () => {
    vi.mocked(getSeasonById).mockRejectedValue(new Error('season read failed'));

    const response = await patch({ is_test_season: true });

    expect(response.status).toBe(500);
    expect(updateSeason).not.toHaveBeenCalled();
    expect(rebuildRatingsAfterTestFlagChange).not.toHaveBeenCalled();
  });
});
