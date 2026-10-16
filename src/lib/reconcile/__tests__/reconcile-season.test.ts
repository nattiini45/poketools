/**
 * Tests for the season derived-data reconciliation orchestrator (spec §22, T6).
 *
 * The orchestrator is a thin coordinator over the T3/T4/aggregate/streak
 * engines, so the canonical tests vi.mock every engine + query module and
 * assert the dry-run-vs-repair behavior, EPB/non-EPB gating, mismatch
 * surfacing, playersAffected aggregation, and the bounded-parallel all-seasons
 * fan-out. `isEvolutionPointBuy` is left REAL (pure) so the format gating is
 * genuinely exercised.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Hoisted mock handles ───────────────────────────────────────────
// The engines + query modules are mocked so the orchestrator's coordination
// behavior is validated without a DB or the real rebuild arithmetic. Per-cause
// logged errors are preserved (no suppression).
const {
  mockComputeSeasonEvolutionState,
  mockDiffEvolutionState,
  mockRepairSeasonEvolution,
  mockLoadAndComputeRatingCurve,
  mockRebuildRatingsForPlayers,
  mockRebuildAggregatesForScope,
  mockRecomputeStreaks,
  mockGetSeasonById,
  mockGetSeasonParticipants,
  mockListAllSeasonIds,
  mockGetSeasonTrackers,
} = vi.hoisted(() => ({
  mockComputeSeasonEvolutionState: vi.fn(),
  mockDiffEvolutionState: vi.fn(),
  mockRepairSeasonEvolution: vi.fn(),
  mockLoadAndComputeRatingCurve: vi.fn(),
  mockRebuildRatingsForPlayers: vi.fn(),
  mockRebuildAggregatesForScope: vi.fn(),
  mockRecomputeStreaks: vi.fn(),
  mockGetSeasonById: vi.fn(),
  mockGetSeasonParticipants: vi.fn(),
  mockListAllSeasonIds: vi.fn(),
  mockGetSeasonTrackers: vi.fn(),
}));

vi.mock('@/lib/reconcile/evolution-rebuild', () => ({
  computeSeasonEvolutionState: mockComputeSeasonEvolutionState,
  diffEvolutionState: mockDiffEvolutionState,
  repairSeasonEvolution: mockRepairSeasonEvolution,
}));

vi.mock('@/lib/rating/updateRatings', () => ({
  loadAndComputeRatingCurve: mockLoadAndComputeRatingCurve,
  rebuildRatingsForPlayers: mockRebuildRatingsForPlayers,
}));

vi.mock('@/lib/match/aggregate-rebuild', () => ({
  rebuildAggregatesForScope: mockRebuildAggregatesForScope,
}));

vi.mock('@/lib/gamification/streaks', () => ({
  recomputeStreaks: mockRecomputeStreaks,
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: mockGetSeasonById,
  getSeasonParticipants: mockGetSeasonParticipants,
  listAllSeasonIds: mockListAllSeasonIds,
}));

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: mockGetSeasonTrackers,
}));

// `isEvolutionPointBuy` stays REAL — it is a pure predicate and the EPB vs
// non-EPB gating is a load-bearing behavior under test.

// ── Import after mocks ─────────────────────────────────────────────
import {
  reconcileSeasonDerivedData,
  reconcileAllSeasons,
  type ReconcileReport,
} from '../reconcile-season';
import type { ComputedRatingCurve } from '@/lib/rating/updateRatings';
import type {
  ComputedEvolutionState,
  EvolutionMismatch,
  ImpossibleLineup,
  RepairResult,
} from '@/lib/reconcile/evolution-rebuild';
import type { PlayerRating } from '@/types/rating';

// ── Fixtures ───────────────────────────────────────────────────────

const SEASON_ID = 'season-1';
const EPB_SEASON = { id: SEASON_ID, format_type: 'evolution_point_buy' };
const DRAFT_SEASON = { id: SEASON_ID, format_type: 'draft' };

const PLAYER_A = 'player-a';
const PLAYER_B = 'player-b';

function participant(id: string): { id: string } {
  return { id } as never;
}

/** A computed rating curve with a fully-populated final state. */
function computedCurve(overrides: Partial<ComputedRatingCurve['finalState']> = {}): ComputedRatingCurve {
  return {
    finalState: {
      rating: 1500,
      rd: 350,
      volatility: 0.06,
      peak_rating: 1500,
      peak_date: null,
      wins: 0,
      losses: 0,
      draws: 0,
      last_match_at: null,
      ...overrides,
    },
    history: [],
    matchesReplayed: 0,
  };
}

/** A stored player_ratings row mirroring `computedCurve` defaults (no mismatch). */
function storedRatingMatchingDefaults(): PlayerRating {
  return {
    id: 'pr-1',
    player_id: PLAYER_A,
    rating: 1500,
    rd: 350,
    volatility: 0.06,
    peak_rating: 1500,
    peak_date: null,
    wins: 0,
    losses: 0,
    draws: 0,
    last_match_at: null,
  };
}

function emptyEvolutionState(): ComputedEvolutionState {
  return { computedTrackers: [], computedEvents: [], impossibleLineups: [] };
}

/** Wire the default "no mismatches, no matches" state for an EPB season. */
function setupEpbSeasonClean(): void {
  mockGetSeasonById.mockResolvedValue(EPB_SEASON);
  mockGetSeasonParticipants.mockResolvedValue([participant(PLAYER_A), participant(PLAYER_B)]);
  mockGetSeasonTrackers.mockResolvedValue([]);
  mockComputeSeasonEvolutionState.mockResolvedValue(emptyEvolutionState());
  mockDiffEvolutionState.mockResolvedValue([]);
  mockLoadAndComputeRatingCurve.mockResolvedValue({
    computed: computedCurve(),
    stored: storedRatingMatchingDefaults(),
    matchesReplayed: 0,
  });
  mockRepairSeasonEvolution.mockResolvedValue({
    trackersUpdated: 0,
    eventsRewritten: 0,
    impossibleLineups: [],
    evolutionPoints: { players_updated: 0, points_awarded: 0 },
  } as RepairResult);
  mockRebuildRatingsForPlayers.mockResolvedValue([]);
  mockRebuildAggregatesForScope.mockResolvedValue({
    gamesProcessed: 0,
    aggregatesDeleted: 0,
    playerAggregatesDeleted: 0,
  });
  mockRecomputeStreaks.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  setupEpbSeasonClean();
});

// ── Dry-run does not write ─────────────────────────────────────────

describe('dry-run (default) does not write', () => {
  it('calls compute + diff + loadAndComputeRatingCurve but NOT the repair rebuilders', async () => {
    const report = await reconcileSeasonDerivedData(SEASON_ID, {});

    expect(report.dryRun).toBe(true);
    expect(report.summary.repaired).toBe(false);

    // Reads happen.
    expect(mockComputeSeasonEvolutionState).toHaveBeenCalledWith(SEASON_ID);
    expect(mockDiffEvolutionState).toHaveBeenCalledWith(SEASON_ID, expect.anything());
    expect(mockLoadAndComputeRatingCurve).toHaveBeenCalledTimes(2); // player-a, player-b

    // Writes do NOT happen.
    expect(mockRepairSeasonEvolution).not.toHaveBeenCalled();
    expect(mockRebuildRatingsForPlayers).not.toHaveBeenCalled();
    expect(mockRebuildAggregatesForScope).not.toHaveBeenCalled();
    expect(mockRecomputeStreaks).not.toHaveBeenCalled();

    // Report shape: evolution checked (EPB), no repaired counts.
    expect(report.evolution.checked).toBe(true);
    expect(report.evolution.repaired).toBeUndefined();
    expect(report.ratings.checked).toBe(true);
    expect(report.ratings.repaired).toBeUndefined();
    expect(report.aggregates.checked).toBe(false);
    expect(report.aggregates.rebuilt).toBeUndefined();
    expect(report.streaks.checked).toBe(false);
    expect(report.streaks.rebuilt).toBeUndefined();
  });

  it('explicit dryRun:true is equivalent to the default', async () => {
    const report = await reconcileSeasonDerivedData(SEASON_ID, { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(mockRepairSeasonEvolution).not.toHaveBeenCalled();
  });
});

// ── Repair writes ──────────────────────────────────────────────────

describe('repair (opts.repair=true) writes', () => {
  it('calls every repair rebuilder and surfaces repaired counts', async () => {
    const report = await reconcileSeasonDerivedData(SEASON_ID, { repair: true });

    expect(report.dryRun).toBe(false);
    expect(report.summary.repaired).toBe(true);

    // EPB still computes + diffs first (to report what was found), then repairs.
    expect(mockComputeSeasonEvolutionState).toHaveBeenCalled();
    expect(mockDiffEvolutionState).toHaveBeenCalled();
    expect(mockRepairSeasonEvolution).toHaveBeenCalledWith(SEASON_ID);

    // Ratings rebuild for the whole season player set.
    expect(mockRebuildRatingsForPlayers).toHaveBeenCalledTimes(1);
    expect(mockRebuildRatingsForPlayers).toHaveBeenCalledWith([PLAYER_A, PLAYER_B]);

    // Aggregates rebuilt at league scope (NOT all_time).
    expect(mockRebuildAggregatesForScope).toHaveBeenCalledTimes(1);
    expect(mockRebuildAggregatesForScope).toHaveBeenCalledWith('league', SEASON_ID);

    // Streaks recomputed per player.
    expect(mockRecomputeStreaks).toHaveBeenCalledTimes(2);
    expect(mockRecomputeStreaks).toHaveBeenNthCalledWith(1, PLAYER_A);
    expect(mockRecomputeStreaks).toHaveBeenNthCalledWith(2, PLAYER_B);

    // Repaired counts surfaced.
    expect(report.evolution.repaired).toEqual({
      trackersUpdated: 0,
      eventsRewritten: 0,
      evolutionPoints: 0,
    });
    expect(report.ratings.repaired).toEqual({ players: 2 });
    expect(report.aggregates.rebuilt).toEqual({ gamesProcessed: 0, aggregatesDeleted: 0 });
    expect(report.streaks.rebuilt).toEqual({ players: 2 });
  });

  it('repair forces dryRun=false even when dryRun:true is also passed', async () => {
    const report = await reconcileSeasonDerivedData(SEASON_ID, { repair: true, dryRun: true });
    expect(report.dryRun).toBe(false);
    expect(report.summary.repaired).toBe(true);
    expect(mockRepairSeasonEvolution).toHaveBeenCalled();
  });

  it('surfaces the repair evolution counts (trackersUpdated/eventsRewritten/evolutionPoints)', async () => {
    mockRepairSeasonEvolution.mockResolvedValue({
      trackersUpdated: 3,
      eventsRewritten: 5,
      impossibleLineups: [],
      evolutionPoints: { players_updated: 2, points_awarded: 4 },
    } as RepairResult);

    const report = await reconcileSeasonDerivedData(SEASON_ID, { repair: true });

    expect(report.evolution.repaired).toEqual({
      trackersUpdated: 3,
      eventsRewritten: 5,
      evolutionPoints: 4,
    });
  });
});

// ── EPB mismatch detection ─────────────────────────────────────────

describe('EPB mismatch detection', () => {
  it('surfaces evolution mismatches + impossible lineups and aggregates playersAffected', async () => {
    // Two trackers owned by player-a and player-b; computed state carries them
    // so the orchestrator can resolve trackerId → player_id.
    const computed: ComputedEvolutionState = {
      computedTrackers: [
        { id: 't-a', player_id: PLAYER_A, base_pokemon: 'Dreepy' } as never,
        { id: 't-b', player_id: PLAYER_B, base_pokemon: 'Gastly' } as never,
      ],
      computedEvents: [],
      impossibleLineups: [],
    };
    mockComputeSeasonEvolutionState.mockResolvedValue(computed);

    const mismatches: EvolutionMismatch[] = [
      { trackerId: 't-a', field: 'real_kills', stored: 0, computed: 3 },
    ];
    mockDiffEvolutionState.mockResolvedValue(mismatches);

    const report = await reconcileSeasonDerivedData(SEASON_ID, {});

    expect(report.evolution.mismatches).toHaveLength(1);
    expect(report.evolution.mismatches[0].field).toBe('real_kills');
    expect(report.summary.totalMismatches).toBe(1);
    // player-a owns the mismatched tracker → affected.
    expect(report.playersAffected).toContain(PLAYER_A);
  });

  it('includes impossible-lineup player ids in playersAffected', async () => {
    const impossible: ImpossibleLineup[] = [
      {
        matchId: 'm1',
        playerId: PLAYER_B,
        basePokemon: 'Dreepy',
        snapshotStage: 2,
        rebuiltMaxStageByMatchday: 1,
        matchday: 2,
      },
    ];
    mockComputeSeasonEvolutionState.mockResolvedValue({
      computedTrackers: [{ id: 't-b', player_id: PLAYER_B, base_pokemon: 'Dreepy' } as never],
      computedEvents: [],
      impossibleLineups: impossible,
    });
    mockDiffEvolutionState.mockResolvedValue([]);

    const report = await reconcileSeasonDerivedData(SEASON_ID, {});

    expect(report.evolution.impossibleLineups).toHaveLength(1);
    expect(report.evolution.impossibleLineups[0].playerId).toBe(PLAYER_B);
    expect(report.playersAffected).toContain(PLAYER_B);
  });

  it('surfaces rating mismatches and adds the player to playersAffected', async () => {
    // player-a's computed rating differs from stored.
    mockLoadAndComputeRatingCurve.mockImplementation(async (playerId: string) => {
      if (playerId === PLAYER_A) {
        return {
          computed: computedCurve({ rating: 1600, wins: 1 }),
          stored: storedRatingMatchingDefaults(), // rating 1500, wins 0
          matchesReplayed: 1,
        };
      }
      return {
        computed: computedCurve(),
        stored: storedRatingMatchingDefaults(),
        matchesReplayed: 0,
      };
    });

    const report = await reconcileSeasonDerivedData(SEASON_ID, {});

    const aMismatches = report.ratings.mismatches.filter((m) => m.playerId === PLAYER_A);
    expect(aMismatches.some((m) => m.field === 'rating')).toBe(true);
    expect(aMismatches.some((m) => m.field === 'wins')).toBe(true);
    // player-b has no mismatch.
    expect(report.ratings.mismatches.some((m) => m.playerId === PLAYER_B)).toBe(false);
    expect(report.playersAffected).toContain(PLAYER_A);
    expect(report.summary.totalMismatches).toBe(aMismatches.length);
  });

  it('records a mismatch with stored:null when the player has no stored row', async () => {
    mockLoadAndComputeRatingCurve.mockImplementation(async (playerId: string) => {
      if (playerId === PLAYER_A) {
        return {
          computed: computedCurve({ rating: 1600, wins: 1, losses: 0, draws: 0 }),
          stored: null, // no stored row
          matchesReplayed: 1,
        };
      }
      return {
        computed: computedCurve(),
        stored: storedRatingMatchingDefaults(),
        matchesReplayed: 0,
      };
    });

    const report = await reconcileSeasonDerivedData(SEASON_ID, {});

    const ratingMismatch = report.ratings.mismatches.find(
      (m) => m.playerId === PLAYER_A && m.field === 'rating'
    );
    expect(ratingMismatch).toBeDefined();
    expect(ratingMismatch?.stored).toBeNull();
    expect(ratingMismatch?.computed).toBe(1600);
  });
});

// ── Non-EPB season ─────────────────────────────────────────────────

describe('non-EPB season (draft format)', () => {
  beforeEach(() => {
    mockGetSeasonById.mockResolvedValue(DRAFT_SEASON);
    // resolveSeasonPlayers does NOT call getSeasonTrackers for non-EPB.
    mockGetSeasonTrackers.mockReset();
  });

  it('skips evolution (checked=false) but still checks ratings', async () => {
    const report = await reconcileSeasonDerivedData(SEASON_ID, {});

    expect(report.evolution.checked).toBe(false);
    expect(report.evolution.mismatches).toEqual([]);
    expect(report.evolution.impossibleLineups).toEqual([]);
    expect(mockComputeSeasonEvolutionState).not.toHaveBeenCalled();
    expect(mockDiffEvolutionState).not.toHaveBeenCalled();
    expect(mockGetSeasonTrackers).not.toHaveBeenCalled(); // not EPB

    // Ratings still checked.
    expect(report.ratings.checked).toBe(true);
    expect(mockLoadAndComputeRatingCurve).toHaveBeenCalledTimes(2);
  });

  it('in repair mode, does NOT call repairSeasonEvolution but still repairs ratings/aggregates/streaks', async () => {
    const report = await reconcileSeasonDerivedData(SEASON_ID, { repair: true });

    expect(report.dryRun).toBe(false);
    expect(mockRepairSeasonEvolution).not.toHaveBeenCalled();
    expect(mockRebuildRatingsForPlayers).toHaveBeenCalledTimes(1);
    expect(mockRebuildAggregatesForScope).toHaveBeenCalledWith('league', SEASON_ID);
    expect(mockRecomputeStreaks).toHaveBeenCalledTimes(2);
    // evolution.repaired undefined because evolution was not run.
    expect(report.evolution.repaired).toBeUndefined();
    expect(report.ratings.repaired).toEqual({ players: 2 });
  });
});

// ── Idempotent re-run ──────────────────────────────────────────────

describe('idempotent re-run', () => {
  it('repair then dry-run shows zero mismatches (mocked clean state)', async () => {
    // First pass: repair with a deliberately-seeded mismatch.
    mockComputeSeasonEvolutionState.mockResolvedValue({
      computedTrackers: [{ id: 't-a', player_id: PLAYER_A, base_pokemon: 'Dreepy' } as never],
      computedEvents: [],
      impossibleLineups: [],
    });
    mockDiffEvolutionState.mockResolvedValueOnce([
      { trackerId: 't-a', field: 'real_kills', stored: 0, computed: 3 },
    ]);
    mockLoadAndComputeRatingCurve.mockImplementation(async (playerId: string) => {
      if (playerId === PLAYER_A) {
        return {
          computed: computedCurve({ rating: 1600, wins: 1 }),
          stored: storedRatingMatchingDefaults(),
          matchesReplayed: 1,
        };
      }
      return {
        computed: computedCurve(),
        stored: storedRatingMatchingDefaults(),
        matchesReplayed: 0,
      };
    });

    const repaired = await reconcileSeasonDerivedData(SEASON_ID, { repair: true });
    expect(repaired.summary.repaired).toBe(true);
    expect(repaired.summary.totalMismatches).toBeGreaterThan(0);

    // Second pass: dry-run after the (mocked) repair rewrote everything to match.
    mockDiffEvolutionState.mockResolvedValueOnce([]);
    mockLoadAndComputeRatingCurve.mockResolvedValue({
      computed: computedCurve(),
      stored: storedRatingMatchingDefaults(),
      matchesReplayed: 0,
    });

    const dryRunReport = await reconcileSeasonDerivedData(SEASON_ID, {});
    expect(dryRunReport.dryRun).toBe(true);
    expect(dryRunReport.summary.totalMismatches).toBe(0);
    expect(dryRunReport.evolution.mismatches).toEqual([]);
    expect(dryRunReport.ratings.mismatches).toEqual([]);
    expect(dryRunReport.playersAffected).toEqual([]);
    // No writes on the dry-run pass.
    expect(mockRepairSeasonEvolution).toHaveBeenCalledTimes(1); // only from the repair pass
    expect(mockRebuildRatingsForPlayers).toHaveBeenCalledTimes(1); // only from the repair pass
  });
});

// ── Missing season ─────────────────────────────────────────────────

describe('missing season', () => {
  it('throws a distinct, logged error and does not proceed', async () => {
    mockGetSeasonById.mockResolvedValue(null);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(reconcileSeasonDerivedData('no-such-season', {})).rejects.toThrow(
      /season no-such-season not found/
    );

    expect(spy).toHaveBeenCalled();
    // No engine work happened.
    expect(mockComputeSeasonEvolutionState).not.toHaveBeenCalled();
    expect(mockLoadAndComputeRatingCurve).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ── EPB tracker player unioned into the player set ─────────────────

describe('player set resolution (EPB unions tracker players)', () => {
  it('includes a tracker player not in the roster', async () => {
    // Roster has only player-a; trackers add player-c (dropped from roster).
    mockGetSeasonParticipants.mockResolvedValue([participant(PLAYER_A)]);
    mockGetSeasonTrackers.mockResolvedValue([
      { id: 't-c', player_id: 'player-c', base_pokemon: 'Dreepy' } as never,
    ]);

    await reconcileSeasonDerivedData(SEASON_ID, { repair: true });

    // rebuildRatingsForPlayers receives the union: [player-a, player-c].
    expect(mockRebuildRatingsForPlayers).toHaveBeenCalledWith(['player-a', 'player-c']);
    // recomputeStreaks ran for both.
    expect(mockRecomputeStreaks).toHaveBeenCalledTimes(2);
  });
});

// ── reconcileAllSeasons ────────────────────────────────────────────

describe('reconcileAllSeasons', () => {
  it('loops every season id in bounded parallel chunks of 2', async () => {
    const seasonIds = ['s1', 's2', 's3', 's4', 's5'];
    mockListAllSeasonIds.mockResolvedValue(seasonIds);
    // Each season resolves to a clean EPB season with one participant.
    mockGetSeasonById.mockImplementation(async (id: string) => ({
      id,
      format_type: 'evolution_point_buy',
    }));
    mockGetSeasonParticipants.mockResolvedValue([participant(PLAYER_A)]);
    mockGetSeasonTrackers.mockResolvedValue([]);
    mockComputeSeasonEvolutionState.mockResolvedValue(emptyEvolutionState());
    mockDiffEvolutionState.mockResolvedValue([]);
    mockLoadAndComputeRatingCurve.mockResolvedValue({
      computed: computedCurve(),
      stored: storedRatingMatchingDefaults(),
      matchesReplayed: 0,
    });

    const reports = await reconcileAllSeasons({});

    expect(reports).toHaveLength(5);
    expect(reports.map((r) => r.seasonId)).toEqual(seasonIds);
    expect(mockListAllSeasonIds).toHaveBeenCalledTimes(1);
    // Every season had its evolution computed (dry-run).
    expect(mockComputeSeasonEvolutionState).toHaveBeenCalledTimes(5);
    // No writes in dry-run.
    expect(mockRepairSeasonEvolution).not.toHaveBeenCalled();
    for (const r of reports) {
      expect(r.dryRun).toBe(true);
      expect(r.summary.repaired).toBe(false);
    }
  });

  it('returns one report per season even when the count is not a multiple of the chunk size', async () => {
    mockListAllSeasonIds.mockResolvedValue(['only-1']);
    mockGetSeasonById.mockResolvedValue(DRAFT_SEASON);
    mockGetSeasonParticipants.mockResolvedValue([participant(PLAYER_A)]);
    mockLoadAndComputeRatingCurve.mockResolvedValue({
      computed: computedCurve(),
      stored: storedRatingMatchingDefaults(),
      matchesReplayed: 0,
    });

    const reports = await reconcileAllSeasons({});
    expect(reports).toHaveLength(1);
    expect(reports[0].seasonId).toBe('only-1');
    // Non-EPB: evolution not checked.
    expect(reports[0].evolution.checked).toBe(false);
  });

  it('propagates repair opts to each season', async () => {
    mockListAllSeasonIds.mockResolvedValue(['s1', 's2']);
    mockGetSeasonById.mockResolvedValue(EPB_SEASON);
    mockGetSeasonParticipants.mockResolvedValue([participant(PLAYER_A)]);
    mockGetSeasonTrackers.mockResolvedValue([]);
    mockComputeSeasonEvolutionState.mockResolvedValue(emptyEvolutionState());
    mockDiffEvolutionState.mockResolvedValue([]);
    mockLoadAndComputeRatingCurve.mockResolvedValue({
      computed: computedCurve(),
      stored: storedRatingMatchingDefaults(),
      matchesReplayed: 0,
    });
    mockRepairSeasonEvolution.mockResolvedValue({
      trackersUpdated: 0,
      eventsRewritten: 0,
      impossibleLineups: [],
      evolutionPoints: { players_updated: 0, points_awarded: 0 },
    } as RepairResult);
    mockRebuildRatingsForPlayers.mockResolvedValue([]);
    mockRebuildAggregatesForScope.mockResolvedValue({
      gamesProcessed: 0,
      aggregatesDeleted: 0,
      playerAggregatesDeleted: 0,
    });
    mockRecomputeStreaks.mockResolvedValue(undefined);

    const reports = await reconcileAllSeasons({ repair: true });

    expect(reports).toHaveLength(2);
    for (const r of reports) {
      expect(r.dryRun).toBe(false);
      expect(r.summary.repaired).toBe(true);
    }
    expect(mockRepairSeasonEvolution).toHaveBeenCalledTimes(2);
    expect(mockRebuildAggregatesForScope).toHaveBeenCalledTimes(2);
  });

  it('handles zero seasons (empty list)', async () => {
    mockListAllSeasonIds.mockResolvedValue([]);
    const reports = await reconcileAllSeasons({});
    expect(reports).toEqual([]);
  });
});

// ── Report type sanity ─────────────────────────────────────────────

describe('report shape', () => {
  it('satisfies the ReconcileReport contract', async () => {
    const report: ReconcileReport = await reconcileSeasonDerivedData(SEASON_ID, {});

    // Top-level fields.
    expect(report.seasonId).toBe(SEASON_ID);
    expect(typeof report.dryRun).toBe('boolean');
    expect(Array.isArray(report.playersAffected)).toBe(true);
    expect(typeof report.summary.totalMismatches).toBe('number');
    expect(typeof report.summary.repaired).toBe('boolean');

    // Each section has `checked`.
    expect(typeof report.evolution.checked).toBe('boolean');
    expect(typeof report.ratings.checked).toBe('boolean');
    expect(typeof report.aggregates.checked).toBe('boolean');
    expect(typeof report.streaks.checked).toBe('boolean');
  });
});

// ── §27 deleteGame ratings gap (documented limitation) ─────────────
//
// `deleteGame` does NOT rebuild a player's rating curve — only `resetMatch`
// does. So after a deleteGame, the stored `player_ratings` row still reflects
// the deleted match's contribution while the authoritative curve (replayed
// from the REMAINING matches) no longer does: the stored rating drifts from
// the computed curve. The reconcile report must DETECT this drift (it is the
// safety net deleteGame does not provide). This test asserts that invariant:
// when `loadAndComputeRatingCurve` returns a computed curve whose final state
// differs from the stored row, `report.ratings.mismatches` is non-empty — i.e.
// reconcile surfaces the drift deleteGame leaves behind. (In dry-run mode no
// repair runs, so the mismatch is reported, not fixed — matching the
// "documented limitation, detectable by reconcile" contract.)

describe('deleteGame ratings gap — reconcile detects the drift deleteGame leaves behind', () => {
  it('surfaces a ratings mismatch when stored rating differs from the computed curve (deleteGame drift)', async () => {
    // Model the post-deleteGame state: the computed curve (replayed from the
    // REMAINING matches) yields rating 1500 / wins 0, but the stored row still
    // reflects the deleted match (rating 1600, wins 1). This is exactly the
    // drift deleteGame leaves behind because it skips the rating rebuild.
    mockLoadAndComputeRatingCurve.mockImplementation(async (playerId: string) => {
      if (playerId === PLAYER_A) {
        return {
          // Computed curve = authoritative state from REMAINING matches.
          computed: computedCurve({ rating: 1500, wins: 0 }),
          // Stored row = stale, still includes the deleted match's contribution.
          stored: {
            ...storedRatingMatchingDefaults(),
            rating: 1600,
            wins: 1,
          },
          matchesReplayed: 0,
        };
      }
      // player-b: stored matches computed → no drift.
      return {
        computed: computedCurve(),
        stored: storedRatingMatchingDefaults(),
        matchesReplayed: 0,
      };
    });

    const report = await reconcileSeasonDerivedData(SEASON_ID, {});

    // The load-bearing assertion: reconcile DETECTS the drift — ratings
    // mismatches is non-empty, carrying the deleteGame left-behind gap.
    expect(report.ratings.mismatches.length).toBeGreaterThan(0);
    const aMismatches = report.ratings.mismatches.filter((m) => m.playerId === PLAYER_A);
    expect(aMismatches.some((m) => m.field === 'rating')).toBe(true);
    expect(aMismatches.some((m) => m.field === 'wins')).toBe(true);

    // The rating mismatch records the drift direction: stored > computed for
    // rating (the stale row still credits the deleted match), and stored >
    // computed for wins (the deleted win is no longer in the curve).
    const ratingMismatch = aMismatches.find((m) => m.field === 'rating');
    expect(ratingMismatch?.stored).toBe(1600); // stale, includes deleted match
    expect(ratingMismatch?.computed).toBe(1500); // authoritative remaining-matches curve
    const winsMismatch = aMismatches.find((m) => m.field === 'wins');
    expect(winsMismatch?.stored).toBe(1); // stale
    expect(winsMismatch?.computed).toBe(0); // remaining matches have no win

    // player-a is affected (the drift is on their row); player-b is not.
    expect(report.playersAffected).toContain(PLAYER_A);
    expect(report.playersAffected).not.toContain(PLAYER_B);

    // Dry-run: the drift is REPORTED, not repaired (deleteGame's gap is
    // surfaced for an operator to act on, not silently fixed here).
    expect(report.dryRun).toBe(true);
    expect(report.ratings.repaired).toBeUndefined();
  });
});