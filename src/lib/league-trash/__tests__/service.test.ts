/**
 * What the league routes do around the recycle bin: the delete that settles a request deadline, and the rebuilds that
 * are confirmed to the database only when they finished (an unconfirmed one keeps the entry from being purged).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/league-trash', () => ({
  moveLeagueToTrash: vi.fn(),
  getLeagueTrashBySeason: vi.fn(),
  getPendingLeagueRebuild: vi.fn(),
  restoreLeagueFromTrash: vi.fn(),
  markLeagueTrashRebuildDone: vi.fn(),
  markLeagueRestoreRebuildDone: vi.fn(),
}));

vi.mock('@/lib/reconcile/entity-delete-rebuild', () => ({
  rebuildAfterSeasonDelete: vi.fn(),
  rebuildAfterSeasonRestore: vi.fn(),
}));

import {
  finishLeagueDeleteRebuild,
  finishLeagueRestoreRebuild,
  restoreLeague,
  trashLeague,
} from '../service';
import { LeagueTrashDbError } from '../db-error';
import {
  getLeagueTrashBySeason,
  getPendingLeagueRebuild,
  markLeagueRestoreRebuildDone,
  markLeagueTrashRebuildDone,
  moveLeagueToTrash,
  restoreLeagueFromTrash,
  type LeagueTrashEntry,
  type LeagueTrashRestoreResult,
} from '@/lib/supabase/queries/league-trash';
import { rebuildAfterSeasonDelete, rebuildAfterSeasonRestore } from '@/lib/reconcile/entity-delete-rebuild';
import { EntityDeleteRebuildStepError } from '@/lib/api/delete-rebuild-warning';

const SEASON = 'season-1';
const TRASH = 'trash-1';

const moved = {
  trash_id: TRASH,
  season_id: SEASON,
  season_name: 'League One',
  deleted_at: '2026-10-26T10:00:00.000Z',
  purge_after: '2027-01-24T10:00:00.000Z',
  counts: { matches: 4 },
  player_ids: ['p1'],
  phase_ids: ['ph1'],
  frozen_pools: 2,
  schema_version: '1',
};

const trashEntry: LeagueTrashEntry = {
  id: TRASH,
  season_name: 'League One',
  purge_after: '2027-01-24T10:00:00.000Z',
  phase_ids: ['ph1', 'ph2'],
  player_ids: ['p1', 'p2'],
};

const deleteSummary = {
  scope: 'season' as const,
  playerIds: ['p1'],
  ratingsRebuilt: 1,
  streaksRebuilt: 1,
  tournamentScopeCleared: null,
  leagueScope: null,
  allTime: { gamesProcessed: 0, aggregatesDeleted: 0, playerAggregatesDeleted: 0 },
  evolutionRepair: null,
};

const restoreSummary = {
  scope: 'season_restore' as const,
  playerIds: ['p1'],
  aggregateJobs: { requeued: 0, processed: 1, failed: 0, remaining: 0, failedForGood: 0 },
  ratingsRebuilt: 1,
  ratingPasses: 1,
  ratingsSettled: true,
  streaksRebuilt: 1,
  evolutionRepair: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(markLeagueTrashRebuildDone).mockResolvedValue(true);
  vi.mocked(markLeagueRestoreRebuildDone).mockResolvedValue(true);
  vi.mocked(rebuildAfterSeasonDelete).mockResolvedValue(deleteSummary);
  vi.mocked(rebuildAfterSeasonRestore).mockResolvedValue(restoreSummary);
});

describe('trashLeague', () => {
  it('returns what the delete function reported, without the fields the routes do not need', async () => {
    vi.mocked(moveLeagueToTrash).mockResolvedValue(moved);

    await expect(trashLeague(SEASON, 'admin-1')).resolves.toEqual({
      trash_id: TRASH,
      season_name: 'League One',
      purge_after: '2027-01-24T10:00:00.000Z',
      phase_ids: ['ph1'],
      player_ids: ['p1'],
      counts: { matches: 4 },
      frozen_pools: 2,
    });
    expect(moveLeagueToTrash).toHaveBeenCalledWith(SEASON, 'admin-1');
    expect(getLeagueTrashBySeason).not.toHaveBeenCalled();
  });

  it('throws a database refusal unchanged, without reading the trash back', async () => {
    const busy = new LeagueTrashDbError('LEAGUE_TRASH_BUSY');
    vi.mocked(moveLeagueToTrash).mockRejectedValue(busy);

    await expect(trashLeague(SEASON, 'admin-1')).rejects.toBe(busy);
    expect(getLeagueTrashBySeason).not.toHaveBeenCalled();
  });

  it('throws an unexpected error unchanged', async () => {
    const boom = new Error('connection reset');
    vi.mocked(moveLeagueToTrash).mockRejectedValue(boom);

    await expect(trashLeague(SEASON, 'admin-1')).rejects.toBe(boom);
  });

  describe('after a request deadline', () => {
    const timeout = new LeagueTrashDbError('LEAGUE_TRASH_TIMEOUT');

    beforeEach(() => {
      vi.mocked(moveLeagueToTrash).mockRejectedValue(timeout);
    });

    it('rethrows the timeout when the trash holds no entry for the league (the delete did not commit)', async () => {
      vi.mocked(getLeagueTrashBySeason).mockResolvedValue(null);

      await expect(trashLeague(SEASON, 'admin-1')).rejects.toBe(timeout);
    });

    it('settles as committed and takes the name and the rebuild inputs from the trash entry', async () => {
      vi.mocked(getLeagueTrashBySeason).mockResolvedValue(trashEntry);

      await expect(trashLeague(SEASON, 'admin-1')).resolves.toEqual({
        trash_id: TRASH,
        season_name: 'League One',
        purge_after: '2027-01-24T10:00:00.000Z',
        phase_ids: ['ph1', 'ph2'],
        player_ids: ['p1', 'p2'],
        counts: {},
        frozen_pools: null,
      });
      expect(getLeagueTrashBySeason).toHaveBeenCalledWith(SEASON);
    });
  });
});

describe('restoreLeague', () => {
  const restored: LeagueTrashRestoreResult = {
    season_id: SEASON,
    season_name: 'League One',
    restored: { matches: 4 },
    shift_seconds: 3600,
    player_ids: ['p1'],
    phase_ids: ['ph1'],
    paused_pools: 1,
    queued_aggregate_jobs: 4,
    schema_version_at_delete: '1',
    warnings: [],
  };
  const pendingOf = (kind: 'delete' | 'restore') => ({
    kind,
    trash_id: TRASH,
    season_id: SEASON,
    season_name: 'League One',
    at: '2026-10-27T10:00:00.000Z',
    phase_ids: ['ph1', 'ph2'],
    player_ids: ['p1', 'p2'],
  });

  it('returns what the restore function reported', async () => {
    vi.mocked(restoreLeagueFromTrash).mockResolvedValue(restored);

    await expect(restoreLeague(TRASH)).resolves.toEqual({ ...restored, settled_after_timeout: false });
    expect(getPendingLeagueRebuild).not.toHaveBeenCalled();
  });

  it('throws a database refusal unchanged, without looking for the tombstone', async () => {
    const refusal = new LeagueTrashDbError('LEAGUE_TRASH_REBUILD_PENDING');
    vi.mocked(restoreLeagueFromTrash).mockRejectedValue(refusal);

    await expect(restoreLeague(TRASH)).rejects.toBe(refusal);
    expect(getPendingLeagueRebuild).not.toHaveBeenCalled();
  });

  describe('after a request deadline', () => {
    const timeout = new LeagueTrashDbError('LEAGUE_TRASH_TIMEOUT');

    beforeEach(() => {
      vi.mocked(restoreLeagueFromTrash).mockRejectedValue(timeout);
    });

    it.each([
      ['nothing is pending', null],
      ['only the delete rebuild is pending', pendingOf('delete')],
    ])('rethrows the timeout when %s (the restore did not commit)', async (_label, pending) => {
      vi.mocked(getPendingLeagueRebuild).mockResolvedValue(pending);

      await expect(restoreLeague(TRASH)).rejects.toBe(timeout);
      expect(getPendingLeagueRebuild).toHaveBeenCalledWith(TRASH);
    });

    it('settles as committed from the restore tombstone, with the lost details as null', async () => {
      vi.mocked(getPendingLeagueRebuild).mockResolvedValue(pendingOf('restore'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        await expect(restoreLeague(TRASH)).resolves.toEqual({
          season_id: SEASON,
          season_name: 'League One',
          restored: {},
          shift_seconds: null,
          player_ids: ['p1', 'p2'],
          phase_ids: ['ph1', 'ph2'],
          paused_pools: null,
          queued_aggregate_jobs: null,
          schema_version_at_delete: null,
          warnings: [],
          settled_after_timeout: true,
        });
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});

describe('finishLeagueDeleteRebuild', () => {
  const input = { trashId: TRASH, seasonId: SEASON, playerIds: ['p1'], phaseIds: ['ph1'] };

  it('rebuilds with the delete\'s inputs and confirms the trash entry afterwards', async () => {
    const outcome = await finishLeagueDeleteRebuild(input);

    expect(outcome).toEqual({ summary: deleteSummary, warning: null });
    expect(rebuildAfterSeasonDelete).toHaveBeenCalledWith({ seasonId: SEASON, playerIds: ['p1'], phaseIds: ['ph1'] });
    expect(markLeagueTrashRebuildDone).toHaveBeenCalledWith(TRASH);
    expect(vi.mocked(markLeagueTrashRebuildDone).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(rebuildAfterSeasonDelete).mock.invocationCallOrder[0],
    );
  });

  it('does not throw when the rebuild fails: a typed warning, the entry stays unconfirmed', async () => {
    vi.mocked(rebuildAfterSeasonDelete).mockRejectedValue(new EntityDeleteRebuildStepError('ratings', new Error('gap')));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const outcome = await finishLeagueDeleteRebuild(input);

      expect(outcome.summary).toBeNull();
      expect(outcome.warning).toMatchObject({ code: 'delete_rebuild_ratings_failed' });
      expect(markLeagueTrashRebuildDone).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('reports a failed confirmation as a warning too (the rebuild is re-runnable)', async () => {
    vi.mocked(markLeagueTrashRebuildDone).mockRejectedValue(new Error('rpc failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const outcome = await finishLeagueDeleteRebuild(input);

      expect(outcome.warning).toMatchObject({ code: 'derived_data_rebuild_failed' });
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('finishLeagueRestoreRebuild', () => {
  const input = { seasonId: SEASON, playerIds: ['p1'] };

  it('rebuilds and confirms the tombstone by season id', async () => {
    const outcome = await finishLeagueRestoreRebuild(input);

    expect(outcome).toEqual({ summary: restoreSummary, warning: null });
    expect(rebuildAfterSeasonRestore).toHaveBeenCalledWith({ seasonId: SEASON, playerIds: ['p1'] });
    expect(markLeagueRestoreRebuildDone).toHaveBeenCalledWith(SEASON);
  });

  it('keeps the tombstone when aggregate jobs of the league failed for good, and warns with their count', async () => {
    vi.mocked(rebuildAfterSeasonRestore).mockResolvedValue({
      ...restoreSummary,
      aggregateJobs: { ...restoreSummary.aggregateJobs, failed: 3, failedForGood: 2 },
    });

    const outcome = await finishLeagueRestoreRebuild(input);

    expect(outcome.warning).toMatchObject({ code: 'restore_rebuild_aggregate_jobs_failed', params: { count: 2 } });
    expect(markLeagueRestoreRebuildDone).not.toHaveBeenCalled();
  });

  it('confirms while jobs are still queued for the cron or only failed attempts were retried', async () => {
    vi.mocked(rebuildAfterSeasonRestore).mockResolvedValue({
      ...restoreSummary,
      aggregateJobs: { ...restoreSummary.aggregateJobs, failed: 2, remaining: 40, failedForGood: 0 },
    });

    const outcome = await finishLeagueRestoreRebuild(input);

    expect(outcome.warning).toBeNull();
    expect(markLeagueRestoreRebuildDone).toHaveBeenCalledWith(SEASON);
  });

  it('keeps the tombstone when the ratings did not settle, and warns', async () => {
    vi.mocked(rebuildAfterSeasonRestore).mockResolvedValue({ ...restoreSummary, ratingsSettled: false });

    const outcome = await finishLeagueRestoreRebuild(input);

    expect(outcome.summary).toMatchObject({ ratingsSettled: false });
    expect(outcome.warning).toMatchObject({ code: 'restore_rebuild_ratings_unsettled' });
    expect(markLeagueRestoreRebuildDone).not.toHaveBeenCalled();
  });

  it('does not throw when a step fails: the step\'s restore warning, the tombstone stays', async () => {
    vi.mocked(rebuildAfterSeasonRestore).mockRejectedValue(new EntityDeleteRebuildStepError('streaks', new Error('x')));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const outcome = await finishLeagueRestoreRebuild(input);

      expect(outcome.warning).toMatchObject({ code: 'restore_rebuild_streaks_failed' });
      expect(markLeagueRestoreRebuildDone).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
