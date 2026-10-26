import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { UserFacingError } from '@/lib/api/user-facing-error';

// The route expires public read-cache tags after its write (D37). Outside a Next request `revalidateTag` throws.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock('@/lib/auth/helpers', () => ({
  requireSuperadmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    code?: string;
    constructor(message: string, statusCode: number, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

vi.mock('@/lib/supabase/queries/league-trash', () => ({
  restoreLeagueFromTrash: vi.fn(),
  markLeagueRestoreRebuildDone: vi.fn(),
  markLeagueTrashRebuildDone: vi.fn(),
  moveLeagueToTrash: vi.fn(),
  getLeagueTrashBySeason: vi.fn(),
}));

vi.mock('@/lib/reconcile/entity-delete-rebuild', () => ({
  rebuildAfterSeasonDelete: vi.fn(),
  rebuildAfterSeasonRestore: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

import { POST } from '@/app/api/admin/league-trash/[id]/restore/route';
import { requireSuperadmin, AuthError } from '@/lib/auth/helpers';
import {
  markLeagueRestoreRebuildDone,
  restoreLeagueFromTrash,
  type LeagueTrashRestoreResult,
} from '@/lib/supabase/queries/league-trash';
import { rebuildAfterSeasonRestore } from '@/lib/reconcile/entity-delete-rebuild';
import { LeagueTrashDbError } from '@/lib/league-trash/db-error';
import { logAuditEvent } from '@/lib/audit/log';
import { revalidateTag } from 'next/cache';

const TRASH_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SEASON_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PHASES = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const PLAYERS = ['p1', 'p2'];

const superadmin = {
  playerId: 'super-1',
  name: 'Superadmin',
  isAdmin: true,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active' as const,
};

const restored: LeagueTrashRestoreResult = {
  season_id: SEASON_ID,
  season_name: 'Season One',
  restored: { matches: 12, games: 30 },
  shift_seconds: 86_400,
  player_ids: PLAYERS,
  phase_ids: PHASES,
  paused_pools: 1,
  queued_aggregate_jobs: 30,
  schema_version_at_delete: '20261026091500',
  warnings: [{ code: 'replay_hash_released', count: 1 }],
};

const rebuilt = {
  scope: 'season_restore' as const,
  playerIds: PLAYERS,
  aggregateJobs: { processed: 30, failed: 0, remaining: 0 },
  ratingsRebuilt: 2,
  ratingPasses: 2,
  ratingsSettled: true,
  streaksRebuilt: 2,
  evolutionRepair: null,
};

const call = (id = TRASH_ID) => POST({} as unknown as NextRequest, { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSuperadmin).mockResolvedValue(superadmin);
  vi.mocked(restoreLeagueFromTrash).mockResolvedValue(restored);
  vi.mocked(rebuildAfterSeasonRestore).mockResolvedValue(rebuilt);
  vi.mocked(markLeagueRestoreRebuildDone).mockResolvedValue(true);
});

describe('POST /api/admin/league-trash/[id]/restore', () => {
  it.each([
    [401, 'Not authenticated', 'unauthenticated'],
    [403, 'Superadmin access required', 'forbidden'],
  ] as const)('answers %i from the superadmin guard and restores nothing', async (status, message, code) => {
    vi.mocked(requireSuperadmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number, c: string) => Error)(message, status, code),
    );

    const response = await call();

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ success: false, error: message, code });
    expect(restoreLeagueFromTrash).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('is gated by requireSuperadmin, not by a site-admin guard', async () => {
    await call();

    expect(requireSuperadmin).toHaveBeenCalledTimes(1);
  });

  it('answers 404 INVALID_LEAGUE_TRASH_ID for a malformed id before any database call', async () => {
    const response = await call('not-a-uuid');

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('INVALID_LEAGUE_TRASH_ID');
    expect(restoreLeagueFromTrash).not.toHaveBeenCalled();
  });

  it('restores the league, rebuilds and confirms, and answers the paused drafts and warnings', async () => {
    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        season_id: SEASON_ID,
        season_name: 'Season One',
        paused_pools: 1,
        warnings: [{ code: 'replay_hash_released', count: 1 }],
        rebuild_warning: null,
      },
    });
    expect(restoreLeagueFromTrash).toHaveBeenCalledWith(TRASH_ID);
    expect(rebuildAfterSeasonRestore).toHaveBeenCalledWith({ seasonId: SEASON_ID, playerIds: PLAYERS });
    expect(markLeagueRestoreRebuildDone).toHaveBeenCalledWith(SEASON_ID);
  });

  it('expires the league and its phases right after the restore, the aggregates after the rebuild', async () => {
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
      ]),
    );
    const order = vi.mocked(revalidateTag).mock.invocationCallOrder;
    const rebuildAt = vi.mocked(rebuildAfterSeasonRestore).mock.invocationCallOrder[0];
    expect(order[tags.indexOf(`season:${SEASON_ID}`)]).toBeLessThan(rebuildAt);
    expect(order[tags.indexOf('aggregates:all_time')]).toBeGreaterThan(rebuildAt);
  });

  it('expires the rating reads of every player the restored league touched, after the rebuild rewrote them', async () => {
    await call();

    const tags = vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag);
    expect(tags).toEqual(expect.arrayContaining(['ratings', ...PLAYERS.map((id) => `player:${id}`)]));
    const rebuildAt = vi.mocked(rebuildAfterSeasonRestore).mock.invocationCallOrder[0];
    const order = vi.mocked(revalidateTag).mock.invocationCallOrder;
    expect(order[tags.indexOf('ratings')]).toBeGreaterThan(rebuildAt);
  });

  it('audit-logs season.restore by the superadmin with the restore outcome', async () => {
    await call();

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'season.restore',
        actor_id: 'super-1',
        resource_type: 'season',
        resource_id: SEASON_ID,
        resource_name: 'Season One',
        metadata: expect.objectContaining({
          trash_id: TRASH_ID,
          restored: { matches: 12, games: 30 },
          shift_seconds: 86_400,
          paused_pools: 1,
          queued_aggregate_jobs: 30,
          warnings: [{ code: 'replay_hash_released', count: 1 }],
          rebuild: expect.objectContaining({ scope: 'season_restore' }),
          rebuild_error: null,
        }),
      }),
    );
  });

  it('keeps the restore a success when the rebuild fails: a restore warning, the rebuild stays unconfirmed', async () => {
    vi.mocked(rebuildAfterSeasonRestore).mockRejectedValue(new Error('rebuild blew up'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await call();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.season_id).toBe(SEASON_ID);
      expect(body.data.rebuild_warning).toMatchObject({ code: 'restore_rebuild_failed' });
      expect(JSON.stringify(body)).not.toContain('rebuild blew up');
      expect(markLeagueRestoreRebuildDone).not.toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'season.restore',
          metadata: expect.objectContaining({ rebuild_error: 'restore_rebuild_failed' }),
        }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('warns about ratings that did not settle and leaves the rebuild pending', async () => {
    vi.mocked(rebuildAfterSeasonRestore).mockResolvedValue({ ...rebuilt, ratingsSettled: false, ratingPasses: 9 });

    const body = await (await call()).json();

    expect(body.data.rebuild_warning).toMatchObject({ code: 'restore_rebuild_ratings_unsettled' });
    expect(markLeagueRestoreRebuildDone).not.toHaveBeenCalled();
  });

  it('keeps a catalogued refusal of a rebuild step as its own warning code', async () => {
    vi.mocked(rebuildAfterSeasonRestore).mockRejectedValue(
      new UserFacingError('Rating history has gaps', { code: 'rating_history_incomplete', params: { count: 1, players: 'Ash' }, status: 409 }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const body = await (await call()).json();

      expect(body.data.rebuild_warning).toEqual({
        code: 'rating_history_incomplete',
        error: 'Rating history has gaps',
        params: { count: 1, players: 'Ash' },
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it.each([
    ['LEAGUE_TRASH_NOT_FOUND', 404, 'LEAGUE_TRASH_NOT_FOUND'],
    ['LEAGUE_TRASH_EXPIRED', 410, 'LEAGUE_TRASH_EXPIRED'],
    ['LEAGUE_TRASH_SEASON_EXISTS', 409, 'LEAGUE_TRASH_SEASON_EXISTS'],
    ['LEAGUE_TRASH_REBUILD_PENDING', 409, 'LEAGUE_TRASH_REBUILD_PENDING'],
    ['LEAGUE_TRASH_BUSY', 409, 'LEAGUE_TRASH_BUSY'],
    ['LEAGUE_TRASH_TIMEOUT', 504, 'LEAGUE_TRASH_TIMEOUT'],
  ] as const)('maps %s to %i with nothing rebuilt or audited', async (dbCode, status, code) => {
    vi.mocked(restoreLeagueFromTrash).mockRejectedValue(new LeagueTrashDbError(dbCode));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await call();

      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ success: false, code });
      expect(rebuildAfterSeasonRestore).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
      expect(revalidateTag).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('maps a schema drift to 409 with the table and columns, restoring nothing', async () => {
    vi.mocked(restoreLeagueFromTrash).mockRejectedValue(
      new LeagueTrashDbError('LEAGUE_TRASH_SCHEMA_DRIFT', { rel: 'matches', columns: ['new_required', 'other'] }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await call();
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.code).toBe('LEAGUE_TRASH_SCHEMA_DRIFT');
      expect(body.params).toEqual({ rel: 'matches', columns: 'new_required, other' });
      expect(body.error).toContain('matches');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('maps a vanished parent to 409 naming the table, column and parent', async () => {
    vi.mocked(restoreLeagueFromTrash).mockRejectedValue(
      new LeagueTrashDbError('LEAGUE_TRASH_PARENT_MISSING', { rel: 'teams', column: 'player_id', parent: 'players', ids: ['x'] }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await call();
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.code).toBe('LEAGUE_TRASH_PARENT_MISSING');
      expect(body.params).toEqual({ rel: 'teams', column: 'player_id', parent: 'players' });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('maps a plan mismatch to 409 and keeps the table names in the server log only', async () => {
    vi.mocked(restoreLeagueFromTrash).mockRejectedValue(
      new LeagueTrashDbError('LEAGUE_TRASH_PLAN_MISMATCH', { mismatched: [{ rel: 'secret_table', captured: 3, restored: 2 }] }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await call();
      const text = JSON.stringify(await response.json());

      expect(response.status).toBe(409);
      expect(text).toContain('LEAGUE_TRASH_PLAN_MISMATCH');
      expect(text).not.toContain('secret_table');
      expect(JSON.stringify(errorSpy.mock.calls)).toContain('secret_table');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('answers 500 for an unexpected error', async () => {
    vi.mocked(restoreLeagueFromTrash).mockRejectedValue(new Error('connection reset'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await call();

      expect(response.status).toBe(500);
      expect((await response.json()).error).toBe('Failed to restore league');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
