import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────
// `computeRatingCurveCore` tests use the REAL glicko2 math (no mock of
// `@/lib/rating/glicko2`) so the chronological-replay correctness is genuinely
// validated, not a mocked echo. The DB query modules are still mocked so the
// pure core can be exercised without a Supabase client.

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByPlayer: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/ratings', () => ({
  deleteRatingHistoryByMatch: vi.fn(),
  deleteRatingHistoryByPlayer: vi.fn(),
  getPlayerRating: vi.fn(),
  getRatingHistoryByMatch: vi.fn(),
  getRatingHistoryByMatches: vi.fn(),
  insertRatingHistory: vi.fn(),
  insertRatingHistoryBatch: vi.fn(),
  upsertPlayerRating: vi.fn(),
}));

// ─── Import after mocks ────────────────────────────────────────────

import {
  computeRatingCurveCore,
  rebuildRatingsForPlayer,
  rebuildRatingsForPlayers,
  type CompletedMatchForRating,
  type OpponentFrozenState,
} from '../updateRatings';
import { getMatchesByPlayer } from '@/lib/supabase/queries/matches';
import {
  deleteRatingHistoryByPlayer,
  getRatingHistoryByMatches,
  insertRatingHistoryBatch,
  upsertPlayerRating,
} from '@/lib/supabase/queries/ratings';
import { GLICKO2_DEFAULTS } from '@/types/rating';

const mockGetMatchesByPlayer = vi.mocked(getMatchesByPlayer);
const mockDeleteHistoryByPlayer = vi.mocked(deleteRatingHistoryByPlayer);
const mockGetHistoryByMatches = vi.mocked(getRatingHistoryByMatches);
const mockInsertHistoryBatch = vi.mocked(insertRatingHistoryBatch);
const mockUpsertPlayerRating = vi.mocked(upsertPlayerRating);

// ─── Helpers ──────────────────────────────────────────────────────

const PLAYER_ID = 'player-A';

function makeMatch(
  overrides: Partial<CompletedMatchForRating> & { id: string }
): CompletedMatchForRating {
  return {
    player_1_id: PLAYER_ID,
    player_2_id: 'opponent-X',
    winner_id: PLAYER_ID,
    date_played: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function frozenMap(entries: Array<[string, OpponentFrozenState]>): Map<string, OpponentFrozenState> {
  return new Map(entries);
}

// ─── computeRatingCurveCore (pure, real glicko2) ───────────────────

describe('computeRatingCurveCore', () => {
  it('replays a single win and records a history row', () => {
    const matches = [makeMatch({ id: 'm1', player_2_id: 'opp1', date_played: '2026-01-01T00:00:00.000Z' })];
    const opponentStateByMatch = frozenMap([
      ['m1', { rating: GLICKO2_DEFAULTS.INITIAL_RATING, rd: GLICKO2_DEFAULTS.INITIAL_RD }],
    ]);

    const result = computeRatingCurveCore({ playerId: PLAYER_ID, matches, opponentStateByMatch });

    expect(result.matchesReplayed).toBe(1);
    expect(result.finalState.wins).toBe(1);
    expect(result.finalState.losses).toBe(0);
    expect(result.finalState.rating).toBeGreaterThan(GLICKO2_DEFAULTS.INITIAL_RATING);
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({
      player_id: PLAYER_ID,
      match_id: 'm1',
      opponent_id: 'opp1',
      result: 'win',
      rating_before: GLICKO2_DEFAULTS.INITIAL_RATING,
      opponent_rating: GLICKO2_DEFAULTS.INITIAL_RATING,
    });
    expect(result.history[0].rating_after).toBe(result.finalState.rating);
  });

  // ── The core bug: earlier-match deletion correctness ──────────────
  it('retains later matches effects when an earlier match is excluded (the regression)', () => {
    // Player A plays match M1 (earlier) vs opp1, then match M2 (later) vs opp2.
    const fullMatches = [
      makeMatch({ id: 'm1', player_2_id: 'opp1', winner_id: PLAYER_ID, date_played: '2026-01-01T00:00:00.000Z' }),
      makeMatch({ id: 'm2', player_2_id: 'opp2', winner_id: PLAYER_ID, date_played: '2026-02-01T00:00:00.000Z' }),
    ];
    const fullOpponents = frozenMap([
      ['m1', { rating: GLICKO2_DEFAULTS.INITIAL_RATING, rd: GLICKO2_DEFAULTS.INITIAL_RD }],
      ['m2', { rating: GLICKO2_DEFAULTS.INITIAL_RATING, rd: GLICKO2_DEFAULTS.INITIAL_RD }],
    ]);

    const sFull = computeRatingCurveCore({
      playerId: PLAYER_ID,
      matches: fullMatches,
      opponentStateByMatch: fullOpponents,
    }).finalState;

    // Rebuild EXCLUDING the earlier match M1 (as if it had been deleted).
    const withoutEarlier = [fullMatches[1]];
    const withoutEarlierOpponents = frozenMap([
      ['m2', { rating: GLICKO2_DEFAULTS.INITIAL_RATING, rd: GLICKO2_DEFAULTS.INITIAL_RD }],
    ]);

    const sWithoutEarlier = computeRatingCurveCore({
      playerId: PLAYER_ID,
      matches: withoutEarlier,
      opponentStateByMatch: withoutEarlierOpponents,
    }).finalState;

    // The M2-only curve (control): replay M2 alone from defaults.
    const sM2Only = computeRatingCurveCore({
      playerId: PLAYER_ID,
      matches: withoutEarlier,
      opponentStateByMatch: withoutEarlierOpponents,
    }).finalState;

    // 1. The two curves differ — removing a match changes the global state.
    expect(sWithoutEarlier.rating).not.toBe(sFull.rating);

    // 2. The excluded-earlier curve EQUALS the M2-only curve, proving the later
    //    match's effect is retained rather than discarded (an inverse-only
    //    rollback would have reset to M1's rating_before and thrown away M2).
    expect(sWithoutEarlier.rating).toBe(sM2Only.rating);
    expect(sWithoutEarlier.wins).toBe(1); // only M2 counted
    expect(sWithoutEarlier.last_match_at).toBe(sM2Only.last_match_at);

    // 3. Conversely, the full curve shows BOTH matches counted — this is the
    //    state the inverse rollback would wrongly collapse to M1's before-state.
    expect(sFull.wins).toBe(2);
  });

  it('inflation uses match dates: a long gap raises rd_before on the second match', () => {
    // Two matches on the SAME day → small rd_before on match 2.
    const sameDay = [
      makeMatch({ id: 's1', player_2_id: 'opp1', winner_id: PLAYER_ID, date_played: '2026-01-01T00:00:00.000Z' }),
      makeMatch({ id: 's2', player_2_id: 'opp2', winner_id: PLAYER_ID, date_played: '2026-01-01T12:00:00.000Z' }),
    ];
    const sameDayOpponents = frozenMap([
      ['s1', { rating: GLICKO2_DEFAULTS.INITIAL_RATING, rd: GLICKO2_DEFAULTS.INITIAL_RD }],
      ['s2', { rating: GLICKO2_DEFAULTS.INITIAL_RATING, rd: GLICKO2_DEFAULTS.INITIAL_RD }],
    ]);
    const sameDayHistory = computeRatingCurveCore({
      playerId: PLAYER_ID,
      matches: sameDay,
      opponentStateByMatch: sameDayOpponents,
    }).history;

    // Two matches FAR APART in date_played → larger rd_before on match 2.
    const farApart = [
      makeMatch({ id: 'f1', player_2_id: 'opp1', winner_id: PLAYER_ID, date_played: '2026-01-01T00:00:00.000Z' }),
      makeMatch({ id: 'f2', player_2_id: 'opp2', winner_id: PLAYER_ID, date_played: '2027-01-01T00:00:00.000Z' }),
    ];
    const farApartOpponents = frozenMap([
      ['f1', { rating: GLICKO2_DEFAULTS.INITIAL_RATING, rd: GLICKO2_DEFAULTS.INITIAL_RD }],
      ['f2', { rating: GLICKO2_DEFAULTS.INITIAL_RATING, rd: GLICKO2_DEFAULTS.INITIAL_RD }],
    ]);
    const farApartHistory = computeRatingCurveCore({
      playerId: PLAYER_ID,
      matches: farApart,
      opponentStateByMatch: farApartOpponents,
    }).history;

    // The second match's rd_before (after inflation) must be higher when the
    // gap between matches is large, all else equal.
    expect(farApartHistory[1].rd_before).toBeGreaterThan(sameDayHistory[1].rd_before);
  });

  it('uses the opponent frozen (rating_before/rd_before) state for the match, not a current rating', () => {
    // Opponent's frozen state at this match is a WEAK rating (1300), even though
    // the opponent's "current" rating (which we do NOT pass in) is irrelevant.
    const matches = [
      makeMatch({ id: 'm1', player_2_id: 'opp1', winner_id: PLAYER_ID, date_played: '2026-01-01T00:00:00.000Z' }),
    ];
    const weakFrozen = frozenMap([['m1', { rating: 1300, rd: 100 }]]);

    const resultWeak = computeRatingCurveCore({
      playerId: PLAYER_ID,
      matches,
      opponentStateByMatch: weakFrozen,
    }).finalState;

    // Same player, but opponent frozen state is a STRONG rating (1700).
    const strongFrozen = frozenMap([['m1', { rating: 1700, rd: 100 }]]);
    const resultStrong = computeRatingCurveCore({
      playerId: PLAYER_ID,
      matches,
      opponentStateByMatch: strongFrozen,
    }).finalState;

    // Beating a stronger opponent awards more rating than beating a weaker one —
    // and the curve used the FROZEN value, not some shared "current" rating.
    const weakGain = resultWeak.rating - GLICKO2_DEFAULTS.INITIAL_RATING;
    const strongGain = resultStrong.rating - GLICKO2_DEFAULTS.INITIAL_RATING;
    expect(strongGain).toBeGreaterThan(weakGain);

    // The history row records the opponent's frozen rating.
    const weakHistory = computeRatingCurveCore({
      playerId: PLAYER_ID,
      matches,
      opponentStateByMatch: weakFrozen,
    }).history;
    expect(weakHistory[0].opponent_rating).toBe(1300);
  });

  it('falls back to GLICKO2_DEFAULTS when an opponent has no frozen history row', () => {
    const matches = [
      makeMatch({ id: 'm1', player_2_id: 'opp1', winner_id: PLAYER_ID, date_played: '2026-01-01T00:00:00.000Z' }),
    ];
    // Empty map — opponent has no history row for this match.
    const result = computeRatingCurveCore({
      playerId: PLAYER_ID,
      matches,
      opponentStateByMatch: new Map(),
    });

    // History row records the fallback opponent rating.
    expect(result.history[0].opponent_rating).toBe(GLICKO2_DEFAULTS.INITIAL_RATING);
    // And the player still gets a win recorded.
    expect(result.finalState.wins).toBe(1);
  });

  it('records draws and losses with the correct result labels', () => {
    const matches = [
      makeMatch({ id: 'draw', player_2_id: 'opp1', winner_id: null, date_played: '2026-01-01T00:00:00.000Z' }),
      makeMatch({ id: 'loss', player_2_id: 'opp2', winner_id: 'opp2', date_played: '2026-02-01T00:00:00.000Z' }),
    ];
    const opponents = frozenMap([
      ['draw', { rating: GLICKO2_DEFAULTS.INITIAL_RATING, rd: GLICKO2_DEFAULTS.INITIAL_RD }],
      ['loss', { rating: GLICKO2_DEFAULTS.INITIAL_RATING, rd: GLICKO2_DEFAULTS.INITIAL_RD }],
    ]);

    const result = computeRatingCurveCore({ playerId: PLAYER_ID, matches, opponentStateByMatch: opponents });

    expect(result.history[0].result).toBe('draw');
    expect(result.history[1].result).toBe('loss');
    expect(result.finalState.draws).toBe(1);
    expect(result.finalState.losses).toBe(1);
    expect(result.finalState.wins).toBe(0);
  });

  // ── peak_date regression: peak_date must point at the peak match ──
  it('sets peak_date to the date_played of the match where the peak is reached', () => {
    // Rating rises across two wins vs weak opponents → peak at the second win.
    const matches = [
      makeMatch({ id: 'm1', player_2_id: 'opp1', winner_id: PLAYER_ID, date_played: '2026-01-01T00:00:00.000Z' }),
      makeMatch({ id: 'm2', player_2_id: 'opp2', winner_id: PLAYER_ID, date_played: '2026-02-01T00:00:00.000Z' }),
    ];
    const weakOpponents = frozenMap([
      ['m1', { rating: 1300, rd: 100 }],
      ['m2', { rating: 1300, rd: 100 }],
    ]);

    const result = computeRatingCurveCore({
      playerId: PLAYER_ID,
      matches,
      opponentStateByMatch: weakOpponents,
    });

    // Each win raises the rating, so the peak is reached at m2.
    const r1 = result.history[0].rating_after;
    const r2 = result.history[1].rating_after;
    expect(r2).toBeGreaterThan(r1);
    expect(result.finalState.peak_rating).toBe(r2);
    // peak_date must equal m2's date_played — NOT null, NOT m1's older date.
    expect(result.finalState.peak_date).toBe('2026-02-01T00:00:00.000Z');
    expect(result.finalState.peak_date).not.toBeNull();
  });

  it('keeps peak_date at the peak match even after the rating later falls', () => {
    // Win (rating rises), win again (peak at m2), then loss vs a strong
    // opponent (rating falls below the peak). peak_date must still point at m2.
    const matches = [
      makeMatch({ id: 'm1', player_2_id: 'opp1', winner_id: PLAYER_ID, date_played: '2026-01-01T00:00:00.000Z' }),
      makeMatch({ id: 'm2', player_2_id: 'opp2', winner_id: PLAYER_ID, date_played: '2026-02-01T00:00:00.000Z' }),
      makeMatch({ id: 'm3', player_2_id: 'opp3', winner_id: 'opp3', date_played: '2026-03-01T00:00:00.000Z' }),
    ];
    const opponents = frozenMap([
      ['m1', { rating: 1300, rd: 100 }], // weak opponent → win raises rating
      ['m2', { rating: 1300, rd: 100 }], // weak opponent → win raises rating (peak)
      ['m3', { rating: 1700, rd: 50 }],   // strong opponent → loss drops rating
    ]);

    const result = computeRatingCurveCore({
      playerId: PLAYER_ID,
      matches,
      opponentStateByMatch: opponents,
    });

    const r1 = result.history[0].rating_after;
    const r2 = result.history[1].rating_after;
    const r3 = result.history[2].rating_after;
    // Sanity: rating rises then falls.
    expect(r2).toBeGreaterThan(r1);
    expect(r3).toBeLessThan(r2);
    // Peak is the highest rating reached (m2), not the final (fallen) rating.
    expect(result.finalState.peak_rating).toBe(r2);
    expect(result.finalState.rating).toBe(r3);
    // peak_date must be m2's date — NOT m3's (the fall), NOT null.
    expect(result.finalState.peak_date).toBe('2026-02-01T00:00:00.000Z');
  });
});

// ─── rebuildRatingsForPlayer (writes) ──────────────────────────────

describe('rebuildRatingsForPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHistoryByMatches.mockResolvedValue([]);
    mockUpsertPlayerRating.mockResolvedValue({} as never);
    mockInsertHistoryBatch.mockResolvedValue([]);
    mockDeleteHistoryByPlayer.mockResolvedValue(undefined);
  });

  it('writes the recomputed state and deletes-then-reinserts the player history only', async () => {
    mockGetMatchesByPlayer.mockResolvedValue([
      { id: 'm1', status: 'completed', player_1_id: PLAYER_ID, player_2_id: 'opp1', winner_id: PLAYER_ID, date_played: '2026-01-01', created_at: '2026-01-01' },
    ] as never);

    // Opponent's frozen history row for the match.
    mockGetHistoryByMatches.mockResolvedValue([
      {
        id: 'h1',
        match_id: 'm1',
        player_id: 'opp1', // the opponent's row → its rating_before/rd_before
        opponent_id: PLAYER_ID,
        rating_before: 1500,
        rating_after: 1500,
        rd_before: 350,
        rd_after: 300,
        opponent_rating: 1500,
        result: 'loss',
        rating_change: 0,
        recorded_at: '2026-01-01',
      },
    ] as never);

    const result = await rebuildRatingsForPlayer(PLAYER_ID);

    expect(result.matchesReplayed).toBe(1);
    expect(result.ratingBefore).toBe(GLICKO2_DEFAULTS.INITIAL_RATING);

    // 1. upsertPlayerRating called once with the recomputed state for this player.
    expect(mockUpsertPlayerRating).toHaveBeenCalledTimes(1);
    expect(mockUpsertPlayerRating).toHaveBeenCalledWith(PLAYER_ID, expect.objectContaining({
      wins: 1,
      losses: 0,
      draws: 0,
    }));

    // 2. History is deleted for THIS player only.
    expect(mockDeleteHistoryByPlayer).toHaveBeenCalledTimes(1);
    expect(mockDeleteHistoryByPlayer).toHaveBeenCalledWith(PLAYER_ID);

    // 3. The rebuilt history is batch-inserted (one row for the one match).
    expect(mockInsertHistoryBatch).toHaveBeenCalledTimes(1);
    const inserted = mockInsertHistoryBatch.mock.calls[0][0];
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      player_id: PLAYER_ID,
      match_id: 'm1',
      opponent_id: 'opp1',
      result: 'win',
    });

    // 4. ratingAfter reflects the replayed win (rating rose).
    expect(result.ratingAfter).toBeGreaterThan(GLICKO2_DEFAULTS.INITIAL_RATING);
  });

  it('excludes non-completed matches from the replay', async () => {
    mockGetMatchesByPlayer.mockResolvedValue([
      { id: 'm1', status: 'scheduled', player_1_id: PLAYER_ID, player_2_id: 'opp1', winner_id: null, date_played: null, created_at: '2026-01-01' },
      { id: 'm2', status: 'completed', player_1_id: PLAYER_ID, player_2_id: 'opp2', winner_id: PLAYER_ID, date_played: '2026-02-01', created_at: '2026-02-01' },
    ] as never);

    const result = await rebuildRatingsForPlayer(PLAYER_ID);

    expect(result.matchesReplayed).toBe(1); // only the completed match
    expect(mockInsertHistoryBatch).toHaveBeenCalledTimes(1);
    const inserted = mockInsertHistoryBatch.mock.calls[0][0];
    expect(inserted).toHaveLength(1);
    expect(inserted[0].match_id).toBe('m2');
  });

  it('replays matches chronologically regardless of input order', async () => {
    // getMatchesByPlayer returns newest-first (per its query); rebuild sorts.
    mockGetMatchesByPlayer.mockResolvedValue([
      { id: 'm2', status: 'completed', player_1_id: PLAYER_ID, player_2_id: 'opp2', winner_id: PLAYER_ID, date_played: '2026-02-01', created_at: '2026-02-01' },
      { id: 'm1', status: 'completed', player_1_id: PLAYER_ID, player_2_id: 'opp1', winner_id: PLAYER_ID, date_played: '2026-01-01', created_at: '2026-01-01' },
    ] as never);
    mockGetHistoryByMatches.mockResolvedValue([
      { id: 'h1', match_id: 'm1', player_id: 'opp1', opponent_id: PLAYER_ID, rating_before: 1500, rating_after: 1500, rd_before: 350, rd_after: 300, opponent_rating: 1500, result: 'loss', rating_change: 0, recorded_at: '2026-01-01' },
      { id: 'h2', match_id: 'm2', player_id: 'opp2', opponent_id: PLAYER_ID, rating_before: 1500, rating_after: 1500, rd_before: 350, rd_after: 300, opponent_rating: 1500, result: 'loss', rating_change: 0, recorded_at: '2026-02-01' },
    ] as never);

    const result = await rebuildRatingsForPlayer(PLAYER_ID);

    expect(result.matchesReplayed).toBe(2);
    const inserted = mockInsertHistoryBatch.mock.calls[0][0];
    // History rows are in chronological order (m1 before m2).
    expect(inserted.map((h: { match_id: string }) => h.match_id)).toEqual(['m1', 'm2']);
  });
});

// ─── rebuildRatingsForPlayers (batch wrapper) ──────────────────────

describe('rebuildRatingsForPlayers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMatchesByPlayer.mockResolvedValue([]);
    mockGetHistoryByMatches.mockResolvedValue([]);
    mockUpsertPlayerRating.mockResolvedValue({} as never);
    mockInsertHistoryBatch.mockResolvedValue([]);
    mockDeleteHistoryByPlayer.mockResolvedValue(undefined);
  });

  it('returns one result per player', async () => {
    const results = await rebuildRatingsForPlayers(['p1', 'p2', 'p3']);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.matchesReplayed).toBe(0);
      expect(r.ratingBefore).toBe(GLICKO2_DEFAULTS.INITIAL_RATING);
      expect(r.ratingAfter).toBe(GLICKO2_DEFAULTS.INITIAL_RATING);
    }
  });

  it('rebuilds every player (each history deleted exactly once)', async () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const results = await rebuildRatingsForPlayers(ids);
    expect(results).toHaveLength(6);
    // Each player's history was deleted once.
    expect(mockDeleteHistoryByPlayer).toHaveBeenCalledTimes(6);
  });

  // ── The race regression: mutual opponents must never rebuild concurrently ──
  // A player's rebuild READS opponents' rating_history rows while deleting +
  // reinserting their own. Two players who played each other rebuilding at the
  // same time raced (2026-08-14 incident: mismatched curves grew 48 → 55).
  // Sequential execution means at most one rebuild is in flight at any moment.
  it('runs rebuilds strictly sequentially (no overlapping rebuilds)', async () => {
    let active = 0;
    let maxActive = 0;
    mockGetMatchesByPlayer.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return [];
    });

    await rebuildRatingsForPlayers(['p1', 'p2', 'p3', 'p4', 'p5']);

    expect(maxActive).toBe(1);
    expect(mockGetMatchesByPlayer).toHaveBeenCalledTimes(5);
  });
});