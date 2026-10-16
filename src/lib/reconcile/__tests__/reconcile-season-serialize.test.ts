/**
 * Serialization tests for `reconcileAllSeasons` (spec §22, T6 review-gate fix).
 *
 * Ratings + `rating_history` are PLAYER-GLOBAL, not season-scoped. The rating
 * rebuild writes (`upsertPlayerRating` → `deleteRatingHistoryByPlayer` →
 * `insertRatingHistoryBatch`) are non-transactional; if two seasons sharing a
 * player were repaired concurrently, those writes would interleave and corrupt
 * that player's history. `reconcileAllSeasons` must therefore SERIALIZE the
 * per-season fan-out in repair mode, while keeping bounded parallelism in
 * dry-run (read-only) mode.
 *
 * Approach: the real `reconcileSeasonDerivedData` runs, but the engine
 * rebuilders it calls are mocked. In repair mode each season calls
 * `rebuildAggregatesForScope('league', <seasonId>)` exactly once; by making
 * that mock return a deferred the test controls, the season-loop concurrency
 * is observable: with serialization (chunk 1) season B's aggregate rebuild
 * cannot be called until season A's entire reconciliation resolves, whereas
 * with dry-run parallelism (chunk 2) two seasons' reads overlap. A self-mock
 * of the module's own export does NOT work here — the real loop calls the
 * local function binding, which bypasses a vi.mock export override — so the
 * engine-rebuilder ordering is the reliable signal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock handles ───────────────────────────────────────────
const {
  mockRebuildAggregatesForScope,
  mockComputeSeasonEvolutionState,
  mockDiffEvolutionState,
  mockRepairSeasonEvolution,
  mockLoadAndComputeRatingCurve,
  mockRebuildRatingsForPlayers,
  mockRecomputeStreaks,
  mockGetSeasonById,
  mockGetSeasonParticipants,
  mockListAllSeasonIds,
  mockGetSeasonTrackers,
} = vi.hoisted(() => ({
  mockRebuildAggregatesForScope: vi.fn(),
  mockComputeSeasonEvolutionState: vi.fn(),
  mockDiffEvolutionState: vi.fn(),
  mockRepairSeasonEvolution: vi.fn(),
  mockLoadAndComputeRatingCurve: vi.fn(),
  mockRebuildRatingsForPlayers: vi.fn(),
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
vi.mock('@/lib/gamification/streaks', () => ({ recomputeStreaks: mockRecomputeStreaks }));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: mockGetSeasonById,
  getSeasonParticipants: mockGetSeasonParticipants,
  listAllSeasonIds: mockListAllSeasonIds,
}));
vi.mock('@/lib/supabase/queries/evolutions', () => ({ getSeasonTrackers: mockGetSeasonTrackers }));

// `isEvolutionPointBuy` stays real (pure predicate) — gating is genuine.

// ── Import after mocks ─────────────────────────────────────────────
import { reconcileAllSeasons } from '../reconcile-season';

// ── Helpers ────────────────────────────────────────────────────────

const SEASON_IDS = ['s1', 's2', 's3', 's4'];

/** A per-season aggregate-rebuild call with a deferred the test controls. */
interface AggregateCall {
  seasonId: string;
  resolve: (r: { gamesProcessed: number; aggregatesDeleted: number; playerAggregatesDeleted: number }) => void;
}

/**
 * Wire every season to a clean EPB reconciliation, with `rebuildAggregatesForScope`
 * returning a deferred per call so the test can observe call ordering. Returns
 * the per-call records in call order.
 */
function wireCleanSeasons(): { aggregateCalls: AggregateCall[] } {
  // Each season exists, EPB, with one participant.
  mockGetSeasonById.mockImplementation(async (id: string) => ({
    id,
    format_type: 'evolution_point_buy',
  }));
  mockGetSeasonParticipants.mockResolvedValue([{ id: 'player-a' } as never]);
  mockGetSeasonTrackers.mockResolvedValue([]);
  mockComputeSeasonEvolutionState.mockResolvedValue({
    computedTrackers: [],
    computedEvents: [],
    impossibleLineups: [],
  });
  mockDiffEvolutionState.mockResolvedValue([]);
  mockLoadAndComputeRatingCurve.mockResolvedValue({
    computed: {
      finalState: {
        rating: 1500, rd: 350, volatility: 0.06, peak_rating: 1500, peak_date: null,
        wins: 0, losses: 0, draws: 0, last_match_at: null,
      },
      history: [],
      matchesReplayed: 0,
    },
    stored: null,
    matchesReplayed: 0,
  });
  mockRepairSeasonEvolution.mockResolvedValue({
    trackersUpdated: 0, eventsRewritten: 0, impossibleLineups: [],
    evolutionPoints: { players_updated: 0, points_awarded: 0 },
  });
  mockRebuildRatingsForPlayers.mockResolvedValue([]);
  mockRecomputeStreaks.mockResolvedValue(undefined);

  const aggregateCalls: AggregateCall[] = [];
  mockRebuildAggregatesForScope.mockImplementation((_scope: string, seasonId: string) => {
    let resolve!: AggregateCall['resolve'];
    const promise = new Promise<{ gamesProcessed: number; aggregatesDeleted: number; playerAggregatesDeleted: number }>((res) => {
      resolve = res;
    });
    aggregateCalls.push({ seasonId, resolve });
    return promise;
  });

  return { aggregateCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListAllSeasonIds.mockResolvedValue(SEASON_IDS);
});

/**
 * Wait until `mockRebuildAggregatesForScope` has been called exactly `count`
 * times (the real reconcileSeasonDerivedData does several awaited reads before
 * reaching the aggregate rebuild, so a few microtask yields are not enough —
 * poll with real timers). Then assert NO further call has landed yet (the
 * serialization proof: the next season has not started).
 */
async function expectAggregateCallsThenStopAt(count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(mockRebuildAggregatesForScope).toHaveBeenCalledTimes(count);
  });
  // Settle any trailing microtasks, then re-assert no extra call appeared.
  await Promise.resolve();
  await Promise.resolve();
  expect(mockRebuildAggregatesForScope).toHaveBeenCalledTimes(count);
}

// ── Repair mode: strictly sequential (no overlap) ─────────────────

describe('reconcileAllSeasons repair serialization', () => {
  it('does NOT run seasons concurrently in repair mode (chunk 1 — player-global ratings are non-transactional)', async () => {
    const { aggregateCalls } = wireCleanSeasons();

    const allPromise = reconcileAllSeasons({ repair: true });

    // Serialization (chunk 1): ONLY season s1 has reached its aggregate rebuild.
    // Season s2 must NOT have started — its aggregate rebuild is not yet called.
    await expectAggregateCallsThenStopAt(1);
    expect(aggregateCalls[0].seasonId).toBe('s1');

    // Release s1's aggregate rebuild; only then may s2 start.
    aggregateCalls[0].resolve({ gamesProcessed: 0, aggregatesDeleted: 0, playerAggregatesDeleted: 0 });
    await expectAggregateCallsThenStopAt(2);
    expect(aggregateCalls[1].seasonId).toBe('s2');

    // Release the rest one at a time, confirming each starts only after the
    // previous resolves (strictly sequential — no overlap).
    aggregateCalls[1].resolve({ gamesProcessed: 0, aggregatesDeleted: 0, playerAggregatesDeleted: 0 });
    await expectAggregateCallsThenStopAt(3);
    expect(aggregateCalls[2].seasonId).toBe('s3');

    aggregateCalls[2].resolve({ gamesProcessed: 0, aggregatesDeleted: 0, playerAggregatesDeleted: 0 });
    await expectAggregateCallsThenStopAt(4);
    expect(aggregateCalls[3].seasonId).toBe('s4');

    aggregateCalls[3].resolve({ gamesProcessed: 0, aggregatesDeleted: 0, playerAggregatesDeleted: 0 });
    const reports = await allPromise;

    // Reports preserved in season order.
    expect(reports.map((r) => r.seasonId)).toEqual(SEASON_IDS);
    expect(mockRebuildAggregatesForScope).toHaveBeenCalledTimes(4);
  });

  it('asserts the aggregate-rebuild call order matches the season-id order (strict serialization)', async () => {
    const { aggregateCalls } = wireCleanSeasons();

    const allPromise = reconcileAllSeasons({ repair: true });

    const seenOrder: string[] = [];
    // Release each season's aggregate rebuild as it appears, recording the order.
    for (let i = 0; i < SEASON_IDS.length; i++) {
      // Wait until the i-th aggregate call appears (it only does once the
      // previous season fully resolves, under serialization).
      await vi.waitFor(() => {
        expect(mockRebuildAggregatesForScope).toHaveBeenCalledTimes(i + 1);
      });
      seenOrder.push(aggregateCalls[i].seasonId);
      aggregateCalls[i].resolve({ gamesProcessed: 0, aggregatesDeleted: 0, playerAggregatesDeleted: 0 });
      await Promise.resolve();
    }
    await allPromise;

    // Strictly sequential: aggregate rebuilds fire in season-id order.
    expect(seenOrder).toEqual(SEASON_IDS);
  });
});

// ── Dry-run mode: parallelism is allowed (contrast) ───────────────

describe('reconcileAllSeasons dry-run parallelism (contrast)', () => {
  it('does NOT call the aggregate rebuilder at all in dry-run (read-only, no writes)', async () => {
    wireCleanSeasons();

    const reports = await reconcileAllSeasons({});

    expect(reports.map((r) => r.seasonId)).toEqual(SEASON_IDS);
    // Dry-run performs no writes — the aggregate rebuilder is never called.
    expect(mockRebuildAggregatesForScope).not.toHaveBeenCalled();
    expect(mockRebuildRatingsForPlayers).not.toHaveBeenCalled();
    expect(mockRecomputeStreaks).not.toHaveBeenCalled();
    expect(mockRepairSeasonEvolution).not.toHaveBeenCalled();
  });

  it('allows the read path to run concurrently across seasons (bounded parallel chunk of 2)', async () => {
    // Use the EPB compute loader as the in-flight signal: in dry-run the only
    // per-season read that can be deferred is computeSeasonEvolutionState. Make
    // it return a deferred per call and assert two seasons' computes overlap
    // (chunk 2), which is safe because dry-run writes nothing.
    mockGetSeasonById.mockImplementation(async (id: string) => ({
      id,
      format_type: 'evolution_point_buy',
    }));
    mockGetSeasonParticipants.mockResolvedValue([{ id: 'player-a' } as never]);
    mockGetSeasonTrackers.mockResolvedValue([]);
    mockDiffEvolutionState.mockResolvedValue([]);
    mockLoadAndComputeRatingCurve.mockResolvedValue({
      computed: {
        finalState: {
          rating: 1500, rd: 350, volatility: 0.06, peak_rating: 1500, peak_date: null,
          wins: 0, losses: 0, draws: 0, last_match_at: null,
        },
        history: [],
        matchesReplayed: 0,
      },
      stored: null,
      matchesReplayed: 0,
    });

    const computeCalls: { seasonId: string; resolve: (s: unknown) => void }[] = [];
    mockComputeSeasonEvolutionState.mockImplementation((seasonId: string) => {
      let resolve!: (s: unknown) => void;
      const promise = new Promise((res) => {
        resolve = res;
      });
      computeCalls.push({ seasonId, resolve });
      return promise;
    });

    const allPromise = reconcileAllSeasons({}); // dry-run, chunk 2

    // Chunk 2: both s1 and s2 computes are in-flight at once — two calls before
    // either resolves. This is the dry-run parallelism that is SAFE (no writes).
    // Under serialization this would be exactly 1.
    await vi.waitFor(() => {
      expect(mockComputeSeasonEvolutionState).toHaveBeenCalledTimes(2);
    });
    // Settle trailing microtasks, then assert no third call yet (still chunk 1).
    await Promise.resolve();
    await Promise.resolve();
    expect(mockComputeSeasonEvolutionState).toHaveBeenCalledTimes(2);
    expect(computeCalls.map((c) => c.seasonId)).toEqual(['s1', 's2']);

    // Release both; the second chunk (s3, s4) then starts concurrently.
    computeCalls[0].resolve({ computedTrackers: [], computedEvents: [], impossibleLineups: [] });
    computeCalls[1].resolve({ computedTrackers: [], computedEvents: [], impossibleLineups: [] });
    await vi.waitFor(() => {
      expect(mockComputeSeasonEvolutionState).toHaveBeenCalledTimes(4);
    });

    computeCalls[2].resolve({ computedTrackers: [], computedEvents: [], impossibleLineups: [] });
    computeCalls[3].resolve({ computedTrackers: [], computedEvents: [], impossibleLineups: [] });
    const reports = await allPromise;

    expect(reports.map((r) => r.seasonId)).toEqual(SEASON_IDS);
    // Confirms the dry-run path used chunk 2 (not serialized).
    expect(mockComputeSeasonEvolutionState).toHaveBeenCalledTimes(4);
  });
});