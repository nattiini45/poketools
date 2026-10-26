import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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
  getPendingLeagueRebuild: vi.fn(),
  markLeagueRestoreRebuildDone: vi.fn(),
  markLeagueTrashRebuildDone: vi.fn(),
}));

vi.mock('@/lib/reconcile/entity-delete-rebuild', () => ({
  rebuildAfterSeasonDelete: vi.fn(),
  rebuildAfterSeasonRestore: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

import { POST } from '@/app/api/admin/league-trash/[id]/rebuild/route';
import { requireSuperadmin, AuthError } from '@/lib/auth/helpers';
import {
  getPendingLeagueRebuild,
  markLeagueRestoreRebuildDone,
  markLeagueTrashRebuildDone,
  type PendingLeagueRebuild,
} from '@/lib/supabase/queries/league-trash';
import { rebuildAfterSeasonDelete, rebuildAfterSeasonRestore } from '@/lib/reconcile/entity-delete-rebuild';
import { logAuditEvent } from '@/lib/audit/log';
import { revalidateTag } from 'next/cache';

const TRASH_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SEASON_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PHASES = ['11111111-1111-4111-8111-111111111111'];
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

const pendingDelete: PendingLeagueRebuild = {
  kind: 'delete',
  trash_id: TRASH_ID,
  season_id: SEASON_ID,
  season_name: 'Season One',
  at: '2026-10-26T10:00:00.000Z',
  phase_ids: PHASES,
  player_ids: PLAYERS,
};
const pendingRestore: PendingLeagueRebuild = { ...pendingDelete, kind: 'restore' };

const restoreSummary = {
  scope: 'season_restore' as const,
  playerIds: PLAYERS,
  aggregateJobs: { processed: 3, failed: 0, remaining: 0 },
  ratingsRebuilt: 2,
  ratingPasses: 1,
  ratingsSettled: true,
  streaksRebuilt: 2,
  evolutionRepair: null,
};

const call = (id = TRASH_ID) => POST({} as unknown as NextRequest, { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSuperadmin).mockResolvedValue(superadmin);
  vi.mocked(getPendingLeagueRebuild).mockResolvedValue(pendingDelete);
  vi.mocked(markLeagueTrashRebuildDone).mockResolvedValue(true);
  vi.mocked(markLeagueRestoreRebuildDone).mockResolvedValue(true);
  vi.mocked(rebuildAfterSeasonDelete).mockResolvedValue({
    scope: 'season',
    playerIds: PLAYERS,
    ratingsRebuilt: 2,
    streaksRebuilt: 2,
    tournamentScopeCleared: null,
    leagueScope: null,
    allTime: { gamesProcessed: 0, aggregatesDeleted: 0, playerAggregatesDeleted: 0 },
    evolutionRepair: null,
  });
  vi.mocked(rebuildAfterSeasonRestore).mockResolvedValue(restoreSummary);
});

describe('POST /api/admin/league-trash/[id]/rebuild', () => {
  it('answers 403 for anyone but the superadmin and runs nothing', async () => {
    vi.mocked(requireSuperadmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number, c: string) => Error)('Superadmin access required', 403, 'forbidden'),
    );

    const response = await call();

    expect(response.status).toBe(403);
    expect(getPendingLeagueRebuild).not.toHaveBeenCalled();
    expect(rebuildAfterSeasonDelete).not.toHaveBeenCalled();
    expect(rebuildAfterSeasonRestore).not.toHaveBeenCalled();
  });

  it('answers 404 INVALID_LEAGUE_TRASH_ID for a malformed id', async () => {
    const response = await call('nope');

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('INVALID_LEAGUE_TRASH_ID');
    expect(getPendingLeagueRebuild).not.toHaveBeenCalled();
  });

  it('answers 404 LEAGUE_TRASH_NOT_FOUND when nothing is pending for the id', async () => {
    vi.mocked(getPendingLeagueRebuild).mockResolvedValue(null);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await call();

      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe('LEAGUE_TRASH_NOT_FOUND');
      expect(getPendingLeagueRebuild).toHaveBeenCalledWith(TRASH_ID);
      expect(logAuditEvent).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('runs the rebuild after a delete with the marker\'s inputs and confirms the trash entry', async () => {
    const response = await call();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { kind: 'delete', rebuild_warning: null } });
    expect(rebuildAfterSeasonDelete).toHaveBeenCalledWith({ seasonId: SEASON_ID, playerIds: PLAYERS, phaseIds: PHASES });
    expect(markLeagueTrashRebuildDone).toHaveBeenCalledWith(TRASH_ID);
    expect(rebuildAfterSeasonRestore).not.toHaveBeenCalled();
  });

  it('runs the rebuild after a restore and confirms it by season id', async () => {
    vi.mocked(getPendingLeagueRebuild).mockResolvedValue(pendingRestore);

    const body = await (await call()).json();

    expect(body.data).toEqual({ kind: 'restore', rebuild_warning: null });
    expect(rebuildAfterSeasonRestore).toHaveBeenCalledWith({ seasonId: SEASON_ID, playerIds: PLAYERS });
    expect(markLeagueRestoreRebuildDone).toHaveBeenCalledWith(SEASON_ID);
    expect(rebuildAfterSeasonDelete).not.toHaveBeenCalled();
  });

  it('keeps the rebuild pending and answers the warning when it fails again', async () => {
    vi.mocked(rebuildAfterSeasonDelete).mockRejectedValue(new Error('still broken'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await call();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.rebuild_warning).toMatchObject({ code: 'derived_data_rebuild_failed' });
      expect(markLeagueTrashRebuildDone).not.toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ rebuild_error: 'derived_data_rebuild_failed' }) }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('expires the aggregate and rating reads the rebuild changed', async () => {
    await call();

    const tags = vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag);
    expect(tags).toEqual(
      expect.arrayContaining([
        `aggregates:league:${SEASON_ID}`,
        'aggregates:all_time',
        `aggregates:tournament:${PHASES[0]}`,
        'ratings',
        'player:p1',
      ]),
    );
  });

  it('audit-logs season.rebuild by the superadmin', async () => {
    await call();

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'season.rebuild',
        actor_id: 'super-1',
        resource_id: SEASON_ID,
        resource_name: 'Season One',
        metadata: expect.objectContaining({ trash_id: TRASH_ID, kind: 'delete', rebuild_error: null }),
      }),
    );
  });
});
