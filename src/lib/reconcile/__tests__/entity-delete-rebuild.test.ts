import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────
// The module under test is an orchestrator over the shipped engines; every
// dependency is mocked so these tests pin the ORCHESTRATION (which scopes are
// cleared vs rebuilt, in what order, with which players) without a database.

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  clearAggregatesForScope: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
}));

vi.mock('@/lib/match/aggregate-rebuild', () => ({
  rebuildAggregatesForScope: vi.fn(),
}));

vi.mock('@/lib/rating/updateRatings', () => ({
  rebuildRatingsForPlayers: vi.fn(),
}));

vi.mock('@/lib/gamification/streaks', () => ({
  recomputeStreaks: vi.fn(),
}));

vi.mock('@/lib/season/format-utils', () => ({
  isEvolutionPointBuy: vi.fn(),
}));

vi.mock('@/lib/reconcile/evolution-rebuild', () => ({
  repairSeasonEvolution: vi.fn(),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────

import {
  rebuildAfterSeasonDelete,
  rebuildAfterTournamentDelete,
} from '../entity-delete-rebuild';
import { clearAggregatesForScope } from '@/lib/supabase/queries/aggregates';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { rebuildAggregatesForScope } from '@/lib/match/aggregate-rebuild';
import { rebuildRatingsForPlayers } from '@/lib/rating/updateRatings';
import { recomputeStreaks } from '@/lib/gamification/streaks';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { repairSeasonEvolution } from '@/lib/reconcile/evolution-rebuild';
import { EntityDeleteRebuildStepError, toDeleteRebuildWarning } from '@/lib/api/delete-rebuild-warning';
import { UserFacingError } from '@/lib/api/user-facing-error';

const mockClear = vi.mocked(clearAggregatesForScope);
const mockGetSeasonById = vi.mocked(getSeasonById);
const mockRebuildScope = vi.mocked(rebuildAggregatesForScope);
const mockRebuildRatings = vi.mocked(rebuildRatingsForPlayers);
const mockRecomputeStreaks = vi.mocked(recomputeStreaks);
const mockIsEpb = vi.mocked(isEvolutionPointBuy);
const mockRepairEvolution = vi.mocked(repairSeasonEvolution);

const SEASON_ID = 'season-1';
const TOURNAMENT_ID = 'tournament-1';
const PLAYERS = ['p1', 'p2'];

/** Minimal Season shape the module reads (id + format_type). */
function seasonOf(formatType: string): { id: string; format_type: string } {
  return { id: SEASON_ID, format_type: formatType };
}

/** invocationCallOrder helper: assert `inner` ran after `outer`. */
function ranAfter(inner: number, outer: number): void {
  expect(inner).toBeGreaterThan(outer);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClear.mockResolvedValue({ aggregatesDeleted: 0, playerAggregatesDeleted: 0 });
  mockGetSeasonById.mockResolvedValue(seasonOf('singles') as never);
  mockIsEpb.mockReturnValue(false);
  mockRebuildScope.mockResolvedValue({
    gamesProcessed: 3,
    aggregatesDeleted: 5,
    playerAggregatesDeleted: 7,
  });
  mockRebuildRatings.mockImplementation(async (playerIds: string[]) =>
    playerIds.map((playerId) => ({
      playerId,
      addedToBatch: false,
      matchesReplayed: 0,
      ratingBefore: 1500,
      ratingAfter: 1500,
      unratedMatchIds: [],
      changed: false,
    }))
  );
  mockRecomputeStreaks.mockResolvedValue(undefined);
  mockRepairEvolution.mockResolvedValue({
    trackersUpdated: 0,
    eventsRewritten: 0,
    evolutionPoints: { points_awarded: 0 },
  } as never);
});

describe('rebuildAfterTournamentDelete', () => {
  it('clears the tournament scope, rebuilds league + all_time, then rebuilds players (non-EPB)', async () => {
    const summary = await rebuildAfterTournamentDelete({
      tournamentId: TOURNAMENT_ID,
      seasonId: SEASON_ID,
      playerIds: PLAYERS,
    });

    // 1. Tournament's own scope cleared exactly once.
    expect(mockClear).toHaveBeenCalledWith('tournament', TOURNAMENT_ID);

    // 2. League scope rebuilt (season survives), all_time rebuilt globally.
    expect(mockRebuildScope).toHaveBeenCalledWith('league', SEASON_ID);
    expect(mockRebuildScope).toHaveBeenCalledWith('all_time', null);

    // 3. Ratings batch once with the captured players; streaks per player.
    expect(mockRebuildRatings).toHaveBeenCalledTimes(1);
    expect(mockRebuildRatings).toHaveBeenCalledWith(PLAYERS);
    expect(mockRecomputeStreaks).toHaveBeenCalledTimes(2);

    // 4. Non-EPB season → no evolution repair.
    expect(mockRepairEvolution).not.toHaveBeenCalled();

    // 5. Summary reflects the orchestration.
    expect(summary.scope).toBe('tournament');
    expect(summary.leagueScope).toMatchObject({ seasonId: SEASON_ID, mode: 'rebuilt', gamesProcessed: 3 });
    expect(summary.allTime).toMatchObject({ gamesProcessed: 3 });
    expect(summary.evolutionRepair).toBeNull();
    expect(summary.ratingsRebuilt).toBe(2);
    expect(summary.streaksRebuilt).toBe(2);
  });

  it('counts players the rating batch added to heal history gaps', async () => {
    mockRebuildRatings.mockImplementationOnce(async (playerIds: string[]) => [
      { playerId: 'healer', addedToBatch: true, matchesReplayed: 2, ratingBefore: 1500, ratingAfter: 1520, unratedMatchIds: [], changed: true },
      ...playerIds.map((playerId) => ({ playerId, addedToBatch: false, matchesReplayed: 0, ratingBefore: 1500, ratingAfter: 1500, unratedMatchIds: [], changed: true })),
    ]);

    const summary = await rebuildAfterTournamentDelete({
      tournamentId: TOURNAMENT_ID,
      seasonId: SEASON_ID,
      playerIds: PLAYERS,
    });

    expect(summary.ratingsRebuilt).toBe(PLAYERS.length + 1);
    expect(summary.streaksRebuilt).toBe(PLAYERS.length);
  });

  it('clears the tournament scope BEFORE rebuilding league and all_time scopes', async () => {
    await rebuildAfterTournamentDelete({
      tournamentId: TOURNAMENT_ID,
      seasonId: SEASON_ID,
      playerIds: PLAYERS,
    });

    const clearOrder = mockClear.mock.invocationCallOrder[0];
    const leagueOrder = mockRebuildScope.mock.invocationCallOrder.find(
      (order, i) => mockRebuildScope.mock.calls[i][0] === 'league'
    );
    const allTimeOrder = mockRebuildScope.mock.invocationCallOrder.find(
      (order, i) => mockRebuildScope.mock.calls[i][0] === 'all_time'
    );
    ranAfter(leagueOrder!, clearOrder);
    ranAfter(allTimeOrder!, leagueOrder!);
  });

  it('repairs evolution state for a surviving EPB season', async () => {
    mockGetSeasonById.mockResolvedValue(seasonOf('evolution_point_buy') as never);
    mockIsEpb.mockReturnValue(true);
    mockRepairEvolution.mockResolvedValue({
      trackersUpdated: 4,
      eventsRewritten: 9,
      evolutionPoints: { points_awarded: 2 },
    } as never);

    const summary = await rebuildAfterTournamentDelete({
      tournamentId: TOURNAMENT_ID,
      seasonId: SEASON_ID,
      playerIds: PLAYERS,
    });

    expect(mockRepairEvolution).toHaveBeenCalledWith(SEASON_ID);
    expect(summary.evolutionRepair).toEqual({ trackersUpdated: 4, eventsRewritten: 9, pointsAwarded: 2 });
  });

  it('clears (not rebuilds) the league scope when the season is gone too', async () => {
    mockGetSeasonById.mockResolvedValue(null);

    const summary = await rebuildAfterTournamentDelete({
      tournamentId: TOURNAMENT_ID,
      seasonId: SEASON_ID,
      playerIds: PLAYERS,
    });

    expect(mockRebuildScope).not.toHaveBeenCalledWith('league', SEASON_ID);
    expect(mockClear).toHaveBeenCalledWith('league', SEASON_ID);
    expect(summary.leagueScope).toMatchObject({ seasonId: SEASON_ID, mode: 'cleared' });
    expect(mockRepairEvolution).not.toHaveBeenCalled();
  });

  it('skips league scope and evolution entirely for standalone tournaments', async () => {
    const summary = await rebuildAfterTournamentDelete({
      tournamentId: TOURNAMENT_ID,
      seasonId: null,
      playerIds: PLAYERS,
    });

    expect(mockGetSeasonById).not.toHaveBeenCalled();
    expect(mockRebuildScope).toHaveBeenCalledTimes(1); // all_time only
    expect(summary.leagueScope).toBeNull();
    expect(summary.evolutionRepair).toBeNull();
  });

  it('skips player rebuilds when no participants were captured', async () => {
    await rebuildAfterTournamentDelete({
      tournamentId: TOURNAMENT_ID,
      seasonId: SEASON_ID,
      playerIds: [],
    });

    expect(mockRebuildRatings).not.toHaveBeenCalled();
    expect(mockRecomputeStreaks).not.toHaveBeenCalled();
  });
});

describe('rebuildAfterSeasonDelete', () => {
  it('clears the league scope, rebuilds all_time, rebuilds players, no evolution repair', async () => {
    const summary = await rebuildAfterSeasonDelete({ seasonId: SEASON_ID, playerIds: PLAYERS });

    // 1. League scope cleared (nothing feeds it anymore), never rebuilt.
    expect(mockClear).toHaveBeenCalledWith('league', SEASON_ID);
    expect(mockRebuildScope).toHaveBeenCalledTimes(1);
    expect(mockRebuildScope).toHaveBeenCalledWith('all_time', null);

    // 2. Ratings + streaks for the captured participants.
    expect(mockRebuildRatings).toHaveBeenCalledWith(PLAYERS);
    expect(mockRecomputeStreaks).toHaveBeenCalledTimes(2);

    // 3. Evolution state cascades with the season row — no repair path.
    expect(mockRepairEvolution).not.toHaveBeenCalled();
    expect(summary.tournamentScopeCleared).toBeNull();
    expect(summary.evolutionRepair).toBeNull();
    expect(summary.leagueScope).toMatchObject({ seasonId: SEASON_ID, mode: 'cleared' });
    expect(summary.scope).toBe('season');
  });
});

describe('a failed rebuild step names the step (distinct warning code per cause)', () => {
  async function failure(run: () => Promise<unknown>): Promise<EntityDeleteRebuildStepError> {
    const err = await run().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(EntityDeleteRebuildStepError);
    return err as EntityDeleteRebuildStepError;
  }

  it.each([
    ['aggregates', () => mockRebuildScope.mockRejectedValueOnce(new Error('rebuild failed')), 'delete_rebuild_aggregates_failed'],
    ['ratings', () => mockRebuildRatings.mockRejectedValueOnce(new Error('ratings failed')), 'delete_rebuild_ratings_failed'],
    ['streaks', () => mockRecomputeStreaks.mockRejectedValueOnce(new Error('streaks failed')), 'delete_rebuild_streaks_failed'],
  ] as const)('tournament delete: %s', async (stepName, arrange, code) => {
    arrange();
    const err = await failure(() =>
      rebuildAfterTournamentDelete({ tournamentId: TOURNAMENT_ID, seasonId: SEASON_ID, playerIds: PLAYERS }),
    );
    expect(err.step).toBe(stepName);
    expect(err.cause).toBeInstanceOf(Error);
    expect(toDeleteRebuildWarning(err)).toMatchObject({ code });
  });

  it('tournament delete: evolution repair of a surviving EPB season', async () => {
    mockIsEpb.mockReturnValue(true);
    mockRepairEvolution.mockRejectedValueOnce(new Error('repair failed'));
    const err = await failure(() =>
      rebuildAfterTournamentDelete({ tournamentId: TOURNAMENT_ID, seasonId: SEASON_ID, playerIds: PLAYERS }),
    );
    expect(err.step).toBe('evolution');
    expect(toDeleteRebuildWarning(err)).toMatchObject({ code: 'delete_rebuild_evolution_failed' });
  });

  it('season delete: aggregates', async () => {
    mockClear.mockRejectedValueOnce(new Error('clear failed'));
    const err = await failure(() => rebuildAfterSeasonDelete({ seasonId: SEASON_ID, playerIds: PLAYERS }));
    expect(err.step).toBe('aggregates');
    // Nothing after the failed step ran.
    expect(mockRebuildRatings).not.toHaveBeenCalled();
  });

  it('keeps a catalogued domain refusal of a step (rating history gap) as its own code', async () => {
    const refusal = new UserFacingError('Rating history has gaps', {
      code: 'rating_history_incomplete',
      params: { count: 1, players: 'Ash' },
      status: 409,
    });
    mockRebuildRatings.mockRejectedValueOnce(refusal);
    const err = await failure(() => rebuildAfterSeasonDelete({ seasonId: SEASON_ID, playerIds: PLAYERS }));
    expect(err.cause).toBe(refusal);
    expect(toDeleteRebuildWarning(err)).toEqual({
      code: 'rating_history_incomplete',
      error: 'Rating history has gaps',
      params: { count: 1, players: 'Ash' },
    });
  });

  it('maps an untagged failure to the generic code', () => {
    expect(toDeleteRebuildWarning(new Error('boom'))).toMatchObject({ code: 'derived_data_rebuild_failed' });
  });
});
