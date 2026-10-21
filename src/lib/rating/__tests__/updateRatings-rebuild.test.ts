import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────
// `computeRatingCurveCore` tests use the REAL glicko2 math (no mock of
// `@/lib/rating/glicko2`) so the chronological-replay correctness is genuinely
// validated, not a mocked echo. The DB query modules are still mocked so the
// pure core can be exercised without a Supabase client.

vi.mock('@/lib/supabase/queries/ratings', () => ({
  applyMatchRatingResult: vi.fn(),
  getCompletedMatchesForRatingReplay: vi.fn(),
  // No test league unless a test says otherwise (clearAllMocks keeps this default).
  loadRatingScope: vi.fn(async () => ({ testSeasonTournamentIds: new Set<string>() })),
  getPlayerRating: vi.fn(),
  getRatingHistoryByMatch: vi.fn(),
  getRatingHistoryByMatches: vi.fn(),
  replacePlayerRatingCurve: vi.fn(),
  toExpectedRatingState: vi.fn(),
  RatingCurveStaleError: class RatingCurveStaleError extends Error {
    readonly playerId: string;
    constructor(playerId: string) {
      super(`stale ${playerId}`);
      this.playerId = playerId;
    }
  },
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  getPlayersByIds: vi.fn(),
}));

// ─── Import after mocks ────────────────────────────────────────────

import {
  computeRatingCurveCore,
  loadAndComputeRatingCurve,
  planRatingRebuild,
  ratingRebuildsInFlight,
  rebuildRatingsForPlayer,
  rebuildRatingsForPlayers,
  RatingHistoryIntegrityError,
  RatingRebuildPlanTooLargeError,
  type CompletedMatchForRating,
  type OpponentFrozenState,
} from '../updateRatings';
import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  getCompletedMatchesForRatingReplay,
  getPlayerRating,
  getRatingHistoryByMatches,
  applyMatchRatingResult,
  replacePlayerRatingCurve,
  loadRatingScope,
  RatingCurveStaleError,
  type RatingReplayMatch,
} from '@/lib/supabase/queries/ratings';
import { createRatingScope } from '@/lib/rating/rating-scope';
import { getPlayersByIds } from '@/lib/supabase/queries/players';
import { GLICKO2_DEFAULTS, type RatingHistoryEntry } from '@/types/rating';
import type { Player } from '@/types/player';

const mockGetCompletedMatches = vi.mocked(getCompletedMatchesForRatingReplay);
const mockGetHistoryByMatches = vi.mocked(getRatingHistoryByMatches);
const mockGetPlayerRating = vi.mocked(getPlayerRating);
const mockReplaceCurve = vi.mocked(replacePlayerRatingCurve);
const mockApplyMatchRatingResult = vi.mocked(applyMatchRatingResult);
const mockGetPlayersByIds = vi.mocked(getPlayersByIds);
const mockLoadScope = vi.mocked(loadRatingScope);

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

function replayMatch(overrides: Partial<RatingReplayMatch> & { id: string }): RatingReplayMatch {
  return {
    tournament_id: 't-normal',
    player_1_id: PLAYER_ID,
    player_2_id: 'opp1',
    winner_id: PLAYER_ID,
    date_played: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A rating_history row: `playerId`'s row for `matchId` against `opponentId`. */
function historyRow(
  matchId: string,
  playerId: string,
  opponentId: string,
  overrides: Partial<RatingHistoryEntry> = {}
): RatingHistoryEntry {
  return {
    id: `h-${matchId}-${playerId}`,
    match_id: matchId,
    player_id: playerId,
    opponent_id: opponentId,
    rating_before: 1500,
    rating_after: 1500,
    rd_before: 350,
    rd_after: 300,
    opponent_rating: 1500,
    result: 'loss',
    rating_change: 0,
    recorded_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
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
    // The fallback is reported, never silent.
    expect(result.fallbackMatchIds).toEqual(['m1']);
  });

  it('reports no fallback when every match has a frozen opponent state', () => {
    const matches = [makeMatch({ id: 'm1', player_2_id: 'opp1' })];
    const result = computeRatingCurveCore({
      playerId: PLAYER_ID,
      matches,
      opponentStateByMatch: frozenMap([['m1', { rating: 1500, rd: 200 }]]),
    });
    expect(result.fallbackMatchIds).toEqual([]);
  });

  it('stamps each history row with its match timestamp (date_played, else created_at)', () => {
    const matches = [
      makeMatch({ id: 'm1', player_2_id: 'opp1', date_played: '2026-01-01T18:30:00.000Z' }),
      makeMatch({ id: 'm2', player_2_id: 'opp2', date_played: null, created_at: '2026-02-01T09:00:00.000Z' }),
    ];
    const result = computeRatingCurveCore({ playerId: PLAYER_ID, matches, opponentStateByMatch: new Map() });
    expect(result.history.map((row) => row.recorded_at)).toEqual([
      '2026-01-01T18:30:00.000Z',
      '2026-02-01T09:00:00.000Z',
    ]);
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

// ─── loadAndComputeRatingCurve (reads + integrity) ─────────────────

describe('loadAndComputeRatingCurve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlayerRating.mockResolvedValue(null);
  });

  it('classifies each match: opponent row, gap (own row only), never rated (no rows)', async () => {
    mockGetCompletedMatches.mockResolvedValue([
      replayMatch({ id: 'ok', player_2_id: 'opp1', date_played: '2026-01-01T00:00:00.000Z' }),
      replayMatch({ id: 'gap', player_2_id: 'opp2', date_played: '2026-02-01T00:00:00.000Z' }),
      replayMatch({ id: 'unrated', player_2_id: 'opp3', date_played: '2026-03-01T00:00:00.000Z' }),
      replayMatch({ id: 'own-missing', player_2_id: 'opp4', date_played: '2026-04-01T00:00:00.000Z' }),
    ]);
    mockGetHistoryByMatches.mockResolvedValue([
      historyRow('ok', 'opp1', PLAYER_ID, { rating_before: 1650, rd_before: 80 }),
      historyRow('ok', PLAYER_ID, 'opp1'),
      historyRow('gap', PLAYER_ID, 'opp2'),
      historyRow('own-missing', 'opp4', PLAYER_ID, { rating_before: 1400, rd_before: 90 }),
    ]);

    const loaded = await loadAndComputeRatingCurve(PLAYER_ID);

    expect(mockGetHistoryByMatches).toHaveBeenCalledWith(['ok', 'gap', 'unrated', 'own-missing']);
    expect(loaded.integrity.gaps).toEqual([
      { matchId: 'gap', playerId: PLAYER_ID, missingPlayerId: 'opp2' },
    ]);
    expect(loaded.integrity.unratedMatchIds).toEqual(['unrated']);
    expect(loaded.integrity.unratedOpponentIds).toEqual(['opp3']);
    // Frozen states are used where the opponent row exists (incl. own row missing).
    const byMatch = new Map(loaded.computed.history.map((row) => [row.match_id, row]));
    expect(byMatch.get('ok')?.opponent_rating).toBe(1650);
    expect(byMatch.get('own-missing')?.opponent_rating).toBe(1400);
    expect(loaded.computed.fallbackMatchIds).toEqual(['gap', 'unrated']);
  });

  it('sorts the replay in the canonical order (ties: the reader order, created_at desc then id desc)', async () => {
    mockGetCompletedMatches.mockResolvedValue([
      replayMatch({ id: 'late', date_played: '2026-03-01T00:00:00.000Z' }),
      replayMatch({ id: 'tie-a', date_played: '2026-02-01T00:00:00.000Z' }),
      replayMatch({ id: 'tie-b', date_played: '2026-02-01T00:00:00.000Z' }),
      replayMatch({ id: 'no-date', date_played: null, created_at: '2026-01-01T00:00:00.000Z' }),
    ]);
    mockGetHistoryByMatches.mockResolvedValue([]);

    const loaded = await loadAndComputeRatingCurve(PLAYER_ID);

    expect(loaded.computed.history.map((row) => row.match_id)).toEqual([
      'no-date',
      'tie-b',
      'tie-a',
      'late',
    ]);
  });

  it('leaves excluded matches out of the replay and the integrity check', async () => {
    mockGetCompletedMatches.mockResolvedValue([
      replayMatch({ id: 'keep', player_2_id: 'opp1', date_played: '2026-01-01T00:00:00.000Z' }),
      replayMatch({ id: 'drop', player_2_id: 'opp2', date_played: '2026-02-01T00:00:00.000Z' }),
    ]);
    mockGetHistoryByMatches.mockResolvedValue([historyRow('drop', PLAYER_ID, 'opp2')]);

    const loaded = await loadAndComputeRatingCurve(PLAYER_ID, { excludeMatchIds: ['drop'] });

    expect(mockGetHistoryByMatches).toHaveBeenCalledWith(['keep']);
    expect(loaded.matchesReplayed).toBe(1);
    expect(loaded.integrity.gaps).toEqual([]);
    expect(loaded.integrity.unratedMatchIds).toEqual(['keep']);
  });

  it('propagates a read failure', async () => {
    const error = new Error('history read failed');
    mockGetCompletedMatches.mockResolvedValue([replayMatch({ id: 'm1' })]);
    mockGetHistoryByMatches.mockRejectedValue(error);
    await expect(loadAndComputeRatingCurve(PLAYER_ID)).rejects.toBe(error);
  });
});

// ─── In-memory store for the write paths ───────────────────────────
// The rebuild re-reads players after earlier writes in the same batch, so the
// write tests run against a tiny fake of the two tables: completed matches
// and rating_history rows, with `replacePlayerRatingCurve` rewriting one
// player's rows the way the SQL function does.

interface FakeStore {
  matches: RatingReplayMatch[];
  rows: RatingHistoryEntry[];
}

function useFakeStore(store: FakeStore): void {
  mockGetCompletedMatches.mockImplementation(async (playerId: string) =>
    store.matches.filter((m) => m.player_1_id === playerId || m.player_2_id === playerId)
  );
  mockGetHistoryByMatches.mockImplementation(async (ids: string[]) =>
    store.rows.filter((row) => ids.includes(row.match_id))
  );
  mockReplaceCurve.mockImplementation(async (playerId, _state, history) => {
    store.rows = store.rows.filter((row) => row.player_id !== playerId);
    for (const entry of history) {
      store.rows.push(
        historyRow(entry.match_id, entry.player_id, entry.opponent_id, {
          rating_before: entry.rating_before,
          rating_after: entry.rating_after,
          rd_before: entry.rd_before,
          rd_after: entry.rd_after,
          opponent_rating: entry.opponent_rating,
          result: entry.result,
        })
      );
    }
    return history.length;
  });
}

function pairMatch(id: string, p1: string, p2: string, date: string): RatingReplayMatch {
  return replayMatch({ id, player_1_id: p1, player_2_id: p2, winner_id: p1, date_played: date });
}

function playersMap(entries: Array<[string, string]>): Map<string, Player> {
  return new Map(entries.map(([id, name]) => [id, { id, name } as Player]));
}

// ─── rebuildRatingsForPlayer (writes) ──────────────────────────────

describe('rebuildRatingsForPlayer', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetPlayerRating.mockResolvedValue(null);
    mockGetHistoryByMatches.mockResolvedValue([]);
    mockGetPlayersByIds.mockResolvedValue(new Map());
    mockReplaceCurve.mockImplementation(async (_id, _state, history) => history.length);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('writes state and history through ONE atomic replace call (no separate upsert/delete/insert)', async () => {
    mockGetCompletedMatches.mockResolvedValue([
      replayMatch({ id: 'm1', player_2_id: 'opp1', date_played: '2026-01-05T10:00:00.000Z' }),
    ]);
    mockGetHistoryByMatches.mockResolvedValue([historyRow('m1', 'opp1', PLAYER_ID)]);

    const result = await rebuildRatingsForPlayer(PLAYER_ID);

    expect(result.playerId).toBe(PLAYER_ID);
    expect(result.addedToBatch).toBe(false);
    expect(result.matchesReplayed).toBe(1);
    expect(result.ratingBefore).toBe(GLICKO2_DEFAULTS.INITIAL_RATING);
    expect(result.ratingAfter).toBeGreaterThan(GLICKO2_DEFAULTS.INITIAL_RATING);
    expect(result.unratedMatchIds).toEqual([]);

    expect(mockReplaceCurve).toHaveBeenCalledTimes(1);
    const [playerId, state, history] = mockReplaceCurve.mock.calls[0];
    expect(playerId).toBe(PLAYER_ID);
    expect(state).toMatchObject({ wins: 1, losses: 0, draws: 0, rating: result.ratingAfter });
    expect(typeof state.updated_at).toBe('string');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      player_id: PLAYER_ID,
      match_id: 'm1',
      opponent_id: 'opp1',
      result: 'win',
      recorded_at: '2026-01-05T10:00:00.000Z',
    });
    // The rebuild never goes through the live single-match writer.
    expect(mockApplyMatchRatingResult).not.toHaveBeenCalled();
  });

  it('still replaces (with an empty history) when the player has no completed match', async () => {
    mockGetCompletedMatches.mockResolvedValue([]);

    const result = await rebuildRatingsForPlayer(PLAYER_ID);

    expect(result.matchesReplayed).toBe(0);
    expect(mockReplaceCurve).toHaveBeenCalledTimes(1);
    expect(mockReplaceCurve.mock.calls[0][2]).toEqual([]);
    expect(mockReplaceCurve.mock.calls[0][1]).toMatchObject({
      rating: GLICKO2_DEFAULTS.INITIAL_RATING,
      wins: 0,
      losses: 0,
      draws: 0,
    });
  });

  it('replays matches chronologically regardless of reader order', async () => {
    mockGetCompletedMatches.mockResolvedValue([
      replayMatch({ id: 'm2', player_2_id: 'opp2', date_played: '2026-02-01T00:00:00.000Z' }),
      replayMatch({ id: 'm1', player_2_id: 'opp1', date_played: '2026-01-01T00:00:00.000Z' }),
    ]);
    mockGetHistoryByMatches.mockResolvedValue([
      historyRow('m1', 'opp1', PLAYER_ID),
      historyRow('m2', 'opp2', PLAYER_ID),
    ]);

    await rebuildRatingsForPlayer(PLAYER_ID);

    expect(mockReplaceCurve.mock.calls[0][2].map((h) => h.match_id)).toEqual(['m1', 'm2']);
  });

  it('heals a gap: rebuilds the player with the missing row first, then the requested player', async () => {
    // A live partial write: opp1's row for m1 never landed, A's did.
    const store: FakeStore = {
      matches: [pairMatch('m1', PLAYER_ID, 'opp1', '2026-01-01T00:00:00.000Z')],
      rows: [historyRow('m1', PLAYER_ID, 'opp1', { rating_before: 1500, rd_before: 350 })],
    };
    useFakeStore(store);

    const result = await rebuildRatingsForPlayer(PLAYER_ID);

    expect(mockReplaceCurve.mock.calls.map((call) => call[0])).toEqual(['opp1', PLAYER_ID]);
    expect(result.playerId).toBe(PLAYER_ID);
    // Both rows exist now, and A's replay used opp1's real frozen state.
    expect(store.rows.map((row) => `${row.match_id}:${row.player_id}`).sort()).toEqual([
      'm1:opp1',
      `m1:${PLAYER_ID}`,
    ].sort());
    const loaded = await loadAndComputeRatingCurve(PLAYER_ID);
    expect(loaded.integrity.gaps).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('opp1'));
  });

  it('heals a chain of gaps in dependency order (C before B before A)', async () => {
    const store: FakeStore = {
      matches: [
        pairMatch('m1', PLAYER_ID, 'B', '2026-01-01T00:00:00.000Z'),
        pairMatch('m2', 'B', 'C', '2026-02-01T00:00:00.000Z'),
      ],
      rows: [historyRow('m1', PLAYER_ID, 'B'), historyRow('m2', 'B', 'C')],
    };
    useFakeStore(store);

    await rebuildRatingsForPlayer(PLAYER_ID);

    expect(mockReplaceCurve.mock.calls.map((call) => call[0])).toEqual(['C', 'B', PLAYER_ID]);
    for (const playerId of [PLAYER_ID, 'B', 'C']) {
      expect((await loadAndComputeRatingCurve(playerId)).integrity.gaps).toEqual([]);
    }
  });

  it('refuses a gap cycle with RatingHistoryIntegrityError (409, catalog code, display names) and writes nothing', async () => {
    // A has m1 but B does not; B has m2 but A does not: no order fills both.
    useFakeStore({
      matches: [
        pairMatch('m1', PLAYER_ID, 'B', '2026-01-01T00:00:00.000Z'),
        pairMatch('m2', PLAYER_ID, 'B', '2026-02-01T00:00:00.000Z'),
      ],
      rows: [historyRow('m1', PLAYER_ID, 'B'), historyRow('m2', 'B', PLAYER_ID)],
    });
    mockGetPlayersByIds.mockResolvedValue(playersMap([[PLAYER_ID, 'Misty'], ['B', 'Brock']]));

    const error = await rebuildRatingsForPlayer(PLAYER_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RatingHistoryIntegrityError);
    expect(error).toBeInstanceOf(UserFacingError);
    const integrityError = error as RatingHistoryIntegrityError;
    expect(integrityError.code).toBe('rating_history_incomplete');
    expect(integrityError.statusCode).toBe(409);
    expect(integrityError.params).toEqual({ count: 2, players: 'Brock, Misty' });
    expect(integrityError.message).toBe(
      'Rating history has gaps that no rebuild order can fill for 2 completed matches (players: Brock, Misty). Those players were not rebuilt; a developer must restore the missing rating history rows.'
    );
    expect(integrityError.gaps).toEqual([
      { matchId: 'm1', playerId: PLAYER_ID, missingPlayerId: 'B' },
      { matchId: 'm2', playerId: 'B', missingPlayerId: PLAYER_ID },
    ]);
    expect(mockGetPlayersByIds).toHaveBeenCalledWith(expect.arrayContaining([PLAYER_ID, 'B']));
    expect(mockReplaceCurve).not.toHaveBeenCalled();
  });

  it('keeps the refusal (with ids) when the display-name lookup fails, and logs the lookup error', async () => {
    useFakeStore({
      matches: [
        pairMatch('m1', PLAYER_ID, 'B', '2026-01-01T00:00:00.000Z'),
        pairMatch('m2', PLAYER_ID, 'B', '2026-02-01T00:00:00.000Z'),
      ],
      rows: [historyRow('m1', PLAYER_ID, 'B'), historyRow('m2', 'B', PLAYER_ID)],
    });
    const lookupError = new Error('players read failed');
    mockGetPlayersByIds.mockRejectedValue(lookupError);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const error = await rebuildRatingsForPlayer(PLAYER_ID).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RatingHistoryIntegrityError);
      expect((error as RatingHistoryIntegrityError).params).toEqual({
        count: 2,
        players: `B, ${PLAYER_ID}`,
      });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('name lookup'), lookupError);
      expect(mockReplaceCurve).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('rebuilds both players of a never-rated match, so the second run finds no gap', async () => {
    const store: FakeStore = {
      matches: [pairMatch('stranded', PLAYER_ID, 'opp1', '2026-01-01T00:00:00.000Z')],
      rows: [],
    };
    useFakeStore(store);

    const result = await rebuildRatingsForPlayer(PLAYER_ID);

    expect(result.unratedMatchIds).toEqual(['stranded']);
    expect(mockReplaceCurve.mock.calls.map((call) => call[0])).toEqual([PLAYER_ID, 'opp1']);
    expect(mockReplaceCurve.mock.calls[0][2][0]).toMatchObject({
      match_id: 'stranded',
      opponent_rating: GLICKO2_DEFAULTS.INITIAL_RATING,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stranded'));
    expect(store.rows.map((row) => row.player_id).sort()).toEqual(['opp1', PLAYER_ID].sort());

    // Second run: both rows exist, nothing to heal, no refusal.
    mockReplaceCurve.mockClear();
    await expect(rebuildRatingsForPlayer(PLAYER_ID)).resolves.toMatchObject({ unratedMatchIds: [] });
    expect(mockReplaceCurve.mock.calls.map((call) => call[0])).toEqual([PLAYER_ID]);
    expect((await loadAndComputeRatingCurve(PLAYER_ID)).integrity.gaps).toEqual([]);
  });

  describe('changed (whether the write moved what other replays read)', () => {
    // One counted match with both rows stored: the player's own row is in the
    // replay's read, so the written history keeps the row count.
    function oneMatchWithOwnRow(): void {
      mockGetCompletedMatches.mockResolvedValue([
        replayMatch({ id: 'm1', player_2_id: 'opp1', date_played: '2026-01-05T10:00:00.000Z' }),
      ]);
      mockGetHistoryByMatches.mockResolvedValue([
        historyRow('m1', 'opp1', PLAYER_ID),
        historyRow('m1', PLAYER_ID, 'opp1'),
      ]);
    }

    /** The player_ratings row the replace stores for `state` (rating and rd numeric(7,2), volatility numeric(8,6)). */
    function storedRow(state: { rating: number; rd: number; volatility: number; wins: number; losses: number; draws: number }) {
      return {
        id: 'pr-1',
        player_id: PLAYER_ID,
        rating: Number(state.rating.toFixed(2)),
        rd: Number(state.rd.toFixed(2)),
        volatility: Number(state.volatility.toFixed(6)),
        peak_rating: Number(state.rating.toFixed(2)),
        peak_date: null,
        wins: state.wins,
        losses: state.losses,
        draws: state.draws,
        last_match_at: null,
      };
    }

    async function writtenState() {
      oneMatchWithOwnRow();
      await rebuildRatingsForPlayer(PLAYER_ID);
      const state = mockReplaceCurve.mock.calls[0][1];
      const [written] = mockReplaceCurve.mock.calls[0][2];
      mockReplaceCurve.mockClear();
      // The next read finds the player's own m1 row exactly as this write stored it.
      const ownRow = (overrides: Partial<RatingHistoryEntry> = {}) =>
        historyRow('m1', PLAYER_ID, 'opp1', {
          rating_before: Number(written.rating_before.toFixed(2)),
          rd_before: Number(written.rd_before.toFixed(2)),
          rating_after: Number(written.rating_after.toFixed(2)),
          rd_after: Number(written.rd_after.toFixed(2)),
          ...overrides,
        });
      mockGetHistoryByMatches.mockResolvedValue([historyRow('m1', 'opp1', PLAYER_ID), ownRow()]);
      return { state, ownRow };
    }

    it('is true when the player had no player_ratings row', async () => {
      oneMatchWithOwnRow();

      await expect(rebuildRatingsForPlayer(PLAYER_ID)).resolves.toMatchObject({ changed: true });
    });

    it("is false when the stored row and the player's history rows equal what the write stores", async () => {
      const { state } = await writtenState();
      mockGetPlayerRating.mockResolvedValue(storedRow(state));

      await expect(rebuildRatingsForPlayer(PLAYER_ID)).resolves.toMatchObject({ changed: false });
    });

    it("is true when one of the player's history rows moved although the final state holds", async () => {
      const { state, ownRow } = await writtenState();
      mockGetPlayerRating.mockResolvedValue(storedRow(state));
      for (const moved of [
        { rating_before: ownRow().rating_before + 0.01 },
        { rd_before: ownRow().rd_before - 0.01 },
        { rating_after: ownRow().rating_after + 0.01 },
        { rd_after: ownRow().rd_after + 0.01 },
      ]) {
        mockGetHistoryByMatches.mockResolvedValue([historyRow('m1', 'opp1', PLAYER_ID), ownRow(moved)]);

        await expect(rebuildRatingsForPlayer(PLAYER_ID), JSON.stringify(moved)).resolves.toMatchObject({
          changed: true,
        });
      }
    });

    it('is true when a stored field differs from the written state', async () => {
      const { state } = await writtenState();
      for (const differs of [
        { rating: state.rating + 0.01 },
        { rd: state.rd - 0.01 },
        { volatility: state.volatility + 0.000001 },
        { wins: state.wins + 1 },
        { losses: state.losses + 1 },
        { draws: state.draws + 1 },
      ]) {
        mockGetPlayerRating.mockResolvedValue({ ...storedRow(state), ...differs });

        await expect(rebuildRatingsForPlayer(PLAYER_ID), JSON.stringify(differs)).resolves.toMatchObject({
          changed: true,
        });
      }
    });

    it("is true when the player's number of history rows changes (equal final state)", async () => {
      const { state } = await writtenState();
      mockGetPlayerRating.mockResolvedValue(storedRow(state));
      // The replay read no own row for m1 (e.g. the league's match was never rated), the write adds one.
      mockGetHistoryByMatches.mockResolvedValue([historyRow('m1', 'opp1', PLAYER_ID)]);

      await expect(rebuildRatingsForPlayer(PLAYER_ID)).resolves.toMatchObject({ changed: true });
    });
  });

  it('propagates the replace failure unchanged', async () => {
    const error = Object.assign(new Error('rpc failed'), { code: '40P01' });
    mockGetCompletedMatches.mockResolvedValue([]);
    mockReplaceCurve.mockRejectedValue(error);

    await expect(rebuildRatingsForPlayer(PLAYER_ID)).rejects.toBe(error);
  });

  it("fences the write on the player's own history rows the replay read", async () => {
    mockGetCompletedMatches.mockResolvedValue([
      replayMatch({ id: 'm1', player_2_id: 'opp1', date_played: '2026-01-05T10:00:00.000Z' }),
      replayMatch({ id: 'm2', player_2_id: 'opp2', date_played: '2026-01-06T10:00:00.000Z' }),
    ]);
    mockGetHistoryByMatches.mockResolvedValue([
      historyRow('m1', PLAYER_ID, 'opp1'),
      historyRow('m1', 'opp1', PLAYER_ID),
      historyRow('m2', 'opp2', PLAYER_ID),
      historyRow('m2', PLAYER_ID, 'opp2'),
    ]);

    await rebuildRatingsForPlayer(PLAYER_ID);

    expect(mockReplaceCurve).toHaveBeenCalledTimes(1);
    expect([...mockReplaceCurve.mock.calls[0][3]].sort()).toEqual(['m1', 'm2']);
  });

  it('re-reads and replays again when a live apply committed between the read and the write (stale fence)', async () => {
    // m1 is completed but never rated when the rebuild reads; a live apply
    // in another process then writes both rows before the rebuild's write.
    const store: FakeStore = {
      matches: [pairMatch('m1', PLAYER_ID, 'opp1', '2026-01-05T10:00:00.000Z')],
      rows: [],
    };
    useFakeStore(store);
    const replace = mockReplaceCurve.getMockImplementation()!;
    let raced = false;
    mockReplaceCurve.mockImplementation(async (playerId, state, history, expected) => {
      if (!raced) {
        raced = true;
        store.rows.push(
          historyRow('m1', PLAYER_ID, 'opp1', { rating_before: 1600, rd_before: 80 }),
          historyRow('m1', 'opp1', PLAYER_ID, { rating_before: 1700, rd_before: 60 }),
        );
      }
      // The SQL fence: a row of a completed match outside the expected set.
      const unexpected = store.rows.some((row) => row.player_id === playerId && !expected.includes(row.match_id));
      if (unexpected) throw new RatingCurveStaleError(playerId, new Error('40001'));
      return replace(playerId, state, history, expected);
    });

    const results = await rebuildRatingsForPlayers([PLAYER_ID]);

    // First write refused, then each written once from a fresh read that
    // sees the live rows: m1 is no longer replayed against the default opponent.
    expect(mockReplaceCurve.mock.calls.map((call) => call[0])).toEqual([PLAYER_ID, PLAYER_ID, 'opp1']);
    expect(results.find((r) => r.playerId === PLAYER_ID)?.unratedMatchIds).toEqual([]);
    expect(store.rows.find((row) => row.player_id === PLAYER_ID && row.match_id === 'm1')?.opponent_rating).toBe(1700);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the history or a test-league flag changed after the replay read it'));
  });

  it('gives up after three refused writes and throws the stale error (nothing written by any attempt)', async () => {
    mockGetCompletedMatches.mockResolvedValue([]);
    const stale = new RatingCurveStaleError(PLAYER_ID, new Error('40001'));
    mockReplaceCurve.mockRejectedValue(stale);

    await expect(rebuildRatingsForPlayer(PLAYER_ID)).rejects.toBe(stale);
    expect(mockReplaceCurve).toHaveBeenCalledTimes(3);
  });
});

// ─── planRatingRebuild (read-only preflight) ───────────────────────

describe('planRatingRebuild', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlayerRating.mockResolvedValue(null);
    mockGetPlayersByIds.mockResolvedValue(new Map());
  });

  it('orders healing players first and writes nothing', async () => {
    useFakeStore({
      matches: [pairMatch('m1', 'p1', 'p9', '2026-01-01T00:00:00.000Z')],
      rows: [historyRow('m1', 'p1', 'p9')],
    });

    const plan = await planRatingRebuild(['p1', 'p2']);

    expect(plan.order).toEqual(['p2', 'p9', 'p1']);
    expect(plan.addedPlayerIds).toEqual(['p9']);
    expect(plan.healedGaps).toEqual([{ matchId: 'm1', playerId: 'p1', missingPlayerId: 'p9' }]);
    expect(mockReplaceCurve).not.toHaveBeenCalled();
  });

  it('ignores excluded matches (a reset preflight: the reset match is still completed)', async () => {
    // The match being reset is itself one-sided in both directions with m2,
    // which would be a cycle; excluding it leaves nothing to refuse.
    useFakeStore({
      matches: [
        pairMatch('reset-me', 'p1', 'p2', '2026-01-01T00:00:00.000Z'),
        pairMatch('m2', 'p1', 'p2', '2026-02-01T00:00:00.000Z'),
      ],
      rows: [historyRow('reset-me', 'p1', 'p2'), historyRow('m2', 'p2', 'p1')],
    });

    await expect(planRatingRebuild(['p1', 'p2'])).rejects.toBeInstanceOf(RatingHistoryIntegrityError);
    const plan = await planRatingRebuild(['p1', 'p2'], { excludeMatchIds: ['reset-me'] });

    expect(plan.order).toEqual(['p1', 'p2']);
    expect(plan.healedGaps).toEqual([{ matchId: 'm2', playerId: 'p2', missingPlayerId: 'p1' }]);
    expect(mockReplaceCurve).not.toHaveBeenCalled();
  });

  it('refuses (catalogued 409, nothing written) when healing would grow the plan past its player cap', async () => {
    // 2000 requested players fill the cap; the gap on p0 needs one more.
    useFakeStore({
      matches: [pairMatch('m1', 'p0', 'outsider', '2026-01-01T00:00:00.000Z')],
      rows: [historyRow('m1', 'p0', 'outsider')],
    });
    const requested = Array.from({ length: 2000 }, (_, i) => `p${i}`);

    const rejection = planRatingRebuild(requested);
    await expect(rejection).rejects.toBeInstanceOf(RatingRebuildPlanTooLargeError);
    await expect(rejection).rejects.toMatchObject({
      code: 'rating_rebuild_plan_too_large', statusCode: 409, params: { limit: 2000 },
    });
    expect(mockReplaceCurve).not.toHaveBeenCalled();
  });

  it('propagates a read failure', async () => {
    const error = new Error('matches read failed');
    mockGetCompletedMatches.mockRejectedValue(error);
    await expect(planRatingRebuild(['p1'])).rejects.toBe(error);
  });
});

// ─── rebuildRatingsForPlayers (batch wrapper) ──────────────────────

describe('rebuildRatingsForPlayers', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetCompletedMatches.mockResolvedValue([]);
    mockGetHistoryByMatches.mockResolvedValue([]);
    mockGetPlayerRating.mockResolvedValue(null);
    mockGetPlayersByIds.mockResolvedValue(new Map());
    mockReplaceCurve.mockImplementation(async (_id, _state, history) => history.length);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('returns one result per player, one atomic replace each', async () => {
    const results = await rebuildRatingsForPlayers(['p1', 'p2', 'p3']);
    expect(results.map((r) => r.playerId)).toEqual(['p1', 'p2', 'p3']);
    for (const r of results) {
      expect(r.addedToBatch).toBe(false);
      expect(r.matchesReplayed).toBe(0);
      expect(r.ratingBefore).toBe(GLICKO2_DEFAULTS.INITIAL_RATING);
      expect(r.ratingAfter).toBe(GLICKO2_DEFAULTS.INITIAL_RATING);
    }
    expect(mockReplaceCurve.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2', 'p3']);
  });

  it('reuses the plan load for the first player and re-reads the others', async () => {
    await rebuildRatingsForPlayers(['p1', 'p2', 'p3']);
    // 3 plan reads + 2 re-reads (p2, p3); p1 is written from its plan load.
    expect(mockGetCompletedMatches.mock.calls.map((c) => c[0])).toEqual([
      'p1',
      'p2',
      'p3',
      'p2',
      'p3',
    ]);
  });

  it('heals a gap in the LAST player by rebuilding the missing player before it', async () => {
    useFakeStore({
      matches: [pairMatch('m9', 'p3', 'p7', '2026-01-01T00:00:00.000Z')],
      rows: [historyRow('m9', 'p3', 'p7')],
    });

    const results = await rebuildRatingsForPlayers(['p1', 'p2', 'p3']);

    expect(results.map((r) => [r.playerId, r.addedToBatch])).toEqual([
      ['p1', false],
      ['p2', false],
      ['p7', true],
      ['p3', false],
    ]);
  });

  it('checks every player before the first write: a gap cycle in the LAST player writes nothing', async () => {
    useFakeStore({
      matches: [
        pairMatch('m8', 'p3', 'p7', '2026-01-01T00:00:00.000Z'),
        pairMatch('m9', 'p3', 'p7', '2026-02-01T00:00:00.000Z'),
      ],
      rows: [historyRow('m8', 'p3', 'p7'), historyRow('m9', 'p7', 'p3')],
    });

    await expect(rebuildRatingsForPlayers(['p1', 'p2', 'p3'])).rejects.toBeInstanceOf(
      RatingHistoryIntegrityError
    );
    expect(mockReplaceCurve).not.toHaveBeenCalled();
  });

  it('backstop: a gap that appears mid-batch (another writer) stops before that player is written', async () => {
    const store: FakeStore = {
      matches: [pairMatch('m1', 'p2', 'p5', '2026-01-01T00:00:00.000Z')],
      rows: [historyRow('m1', 'p2', 'p5'), historyRow('m1', 'p5', 'p2')],
    };
    useFakeStore(store);
    const replace = mockReplaceCurve.getMockImplementation()!;
    mockReplaceCurve.mockImplementation(async (playerId, state, history, expected) => {
      const written = await replace(playerId, state, history, expected);
      // Another process loses p5's row right after p1 is written.
      if (playerId === 'p1') store.rows = store.rows.filter((row) => row.player_id !== 'p5');
      return written;
    });

    await expect(rebuildRatingsForPlayers(['p1', 'p2'])).rejects.toBeInstanceOf(
      RatingHistoryIntegrityError
    );
    expect(mockReplaceCurve.mock.calls.map((c) => c[0])).toEqual(['p1']);
  });

  it('stops at the first failed player: earlier players stay rebuilt, later ones untouched', async () => {
    const error = new Error('replace failed for p2');
    mockReplaceCurve.mockImplementation(async (playerId, _state, history) => {
      if (playerId === 'p2') throw error;
      return history.length;
    });

    await expect(rebuildRatingsForPlayers(['p1', 'p2', 'p3'])).rejects.toBe(error);
    expect(mockReplaceCurve.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2']);
  });

  // ── The race regression: mutual opponents must never rebuild concurrently ──
  // A player's rebuild READS opponents' rating_history rows while its own rows
  // are rewritten (2026-08-14 incident: mismatched curves grew 48 → 55).
  it('runs rebuilds strictly sequentially within a batch', async () => {
    let active = 0;
    let maxActive = 0;
    mockReplaceCurve.mockImplementation(async (_id, _state, history) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return history.length;
    });

    await rebuildRatingsForPlayers(['p1', 'p2', 'p3', 'p4', 'p5']);

    expect(maxActive).toBe(1);
    expect(mockReplaceCurve).toHaveBeenCalledTimes(5);
  });

  it('serializes concurrent callers in this process (no interleaving of two batches)', async () => {
    const events: string[] = [];
    mockGetCompletedMatches.mockImplementation(async (playerId: string) => {
      events.push(`read:${playerId}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
      return [];
    });
    mockReplaceCurve.mockImplementation(async (playerId, _state, history) => {
      events.push(`write:${playerId}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
      return history.length;
    });

    const first = rebuildRatingsForPlayers(['a1', 'a2']);
    const second = rebuildRatingsForPlayers(['b1', 'b2']);
    const single = rebuildRatingsForPlayer('c1');
    expect(ratingRebuildsInFlight()).toBe(3);

    await Promise.all([first, second, single]);

    // Batch A (plan reads, then writes and re-reads) completes before B starts, B before C.
    const lastA = Math.max(...events.map((e, i) => (e.endsWith(':a1') || e.endsWith(':a2') ? i : -1)));
    const firstB = events.findIndex((e) => e.endsWith(':b1') || e.endsWith(':b2'));
    const lastB = Math.max(...events.map((e, i) => (e.endsWith(':b1') || e.endsWith(':b2') ? i : -1)));
    const firstC = events.findIndex((e) => e.endsWith(':c1'));
    expect(lastA).toBeLessThan(firstB);
    expect(lastB).toBeLessThan(firstC);
    expect(ratingRebuildsInFlight()).toBe(0);
  });

  it('a failed batch does not block the next caller, and each caller sees only its own error', async () => {
    const error = new Error('first batch failed');
    mockReplaceCurve.mockImplementation(async (playerId, _state, history) => {
      if (playerId === 'bad') throw error;
      return history.length;
    });

    const failing = rebuildRatingsForPlayers(['bad']);
    const following = rebuildRatingsForPlayers(['good']);

    await expect(failing).rejects.toBe(error);
    await expect(following).resolves.toHaveLength(1);
    expect(ratingRebuildsInFlight()).toBe(0);
  });
});

// ─── Test leagues stay out of every replay (rating-scope.ts) ───────

describe('test-league matches in the rebuild', () => {
  const TEST_TOURNAMENT = 't-test-league';
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetPlayerRating.mockResolvedValue(null);
    mockGetPlayersByIds.mockResolvedValue(new Map());
    mockLoadScope.mockResolvedValue(createRatingScope([TEST_TOURNAMENT]));
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('leaves a test-league match out of the replay, the history read, the integrity check and the fence', async () => {
    mockGetCompletedMatches.mockResolvedValue([
      replayMatch({ id: 'normal', player_2_id: 'opp1', date_played: '2026-01-01T00:00:00.000Z' }),
      replayMatch({ id: 'test', tournament_id: TEST_TOURNAMENT, player_2_id: 'opp2', date_played: '2026-02-01T00:00:00.000Z' }),
    ]);
    mockGetHistoryByMatches.mockResolvedValue([
      historyRow('normal', 'opp1', PLAYER_ID, { rating_before: 1650, rd_before: 80 }),
      historyRow('normal', PLAYER_ID, 'opp1'),
    ]);

    const loaded = await loadAndComputeRatingCurve(PLAYER_ID);

    expect(mockGetHistoryByMatches).toHaveBeenCalledWith(['normal']);
    expect(loaded.matchesReplayed).toBe(1);
    expect(loaded.computed.history.map((row) => row.match_id)).toEqual(['normal']);
    expect(loaded.integrity).toEqual({ gaps: [], unratedMatchIds: [], unratedOpponentIds: [] });
    expect(loaded.ownHistoryMatchIds).toEqual(['normal']);
  });

  it('uses a scope passed in the options without reading it again', async () => {
    mockGetCompletedMatches.mockResolvedValue([
      replayMatch({ id: 'other-test', tournament_id: 't-other' }),
    ]);
    mockGetHistoryByMatches.mockResolvedValue([]);

    const loaded = await loadAndComputeRatingCurve(PLAYER_ID, { scope: createRatingScope(['t-other']) });

    expect(mockLoadScope).not.toHaveBeenCalled();
    expect(loaded.matchesReplayed).toBe(0);
  });

  it('rewrites a curve without its test-league matches, deleting their rows (a player whose test league already moved ratings)', async () => {
    const store: FakeStore = {
      matches: [
        pairMatch('normal', PLAYER_ID, 'opp1', '2026-01-01T00:00:00.000Z'),
        { ...pairMatch('test', PLAYER_ID, 'opp1', '2026-02-01T00:00:00.000Z'), tournament_id: TEST_TOURNAMENT },
      ],
      rows: [
        historyRow('normal', PLAYER_ID, 'opp1'),
        historyRow('normal', 'opp1', PLAYER_ID),
        historyRow('test', PLAYER_ID, 'opp1'),
        historyRow('test', 'opp1', PLAYER_ID),
      ],
    };
    useFakeStore(store);

    const results = await rebuildRatingsForPlayers([PLAYER_ID, 'opp1']);

    expect(results.map((r) => [r.playerId, r.matchesReplayed])).toEqual([[PLAYER_ID, 1], ['opp1', 1]]);
    for (const call of mockReplaceCurve.mock.calls) {
      expect(call[2].map((row) => row.match_id)).toEqual(['normal']);
      // The fence names only the replayed match: the leftover test-league row is not expected (the SQL fence ignores it).
      expect(call[3]).toEqual(['normal']);
    }
    expect(store.rows.map((row) => row.match_id).sort()).toEqual(['normal', 'normal']);
  });

  it('reads the scope once for a whole batch', async () => {
    mockGetCompletedMatches.mockResolvedValue([]);
    mockGetHistoryByMatches.mockResolvedValue([]);
    mockReplaceCurve.mockImplementation(async (_id, _state, history) => history.length);

    await rebuildRatingsForPlayers(['p1', 'p2', 'p3']);

    expect(mockLoadScope).toHaveBeenCalledTimes(1);
  });

  it('re-reads the scope after a stale refusal, so a league flagged meanwhile leaves the retried replay', async () => {
    const store: FakeStore = {
      matches: [pairMatch('m-flagged', PLAYER_ID, 'opp1', '2026-01-01T00:00:00.000Z')],
      rows: [historyRow('m-flagged', PLAYER_ID, 'opp1'), historyRow('m-flagged', 'opp1', PLAYER_ID)],
    };
    useFakeStore(store);
    store.matches[0] = { ...store.matches[0], tournament_id: 't-flagged-later' };
    // The plan reads the old flags; the flag is set before the write, which the SQL refuses (40001).
    mockLoadScope
      .mockResolvedValueOnce(createRatingScope([]))
      .mockResolvedValue(createRatingScope(['t-flagged-later']));
    const replace = mockReplaceCurve.getMockImplementation()!;
    let refused = false;
    mockReplaceCurve.mockImplementation(async (playerId, state, history, expected) => {
      if (!refused && history.some((row) => row.match_id === 'm-flagged')) {
        refused = true;
        throw new RatingCurveStaleError(playerId, new Error('40001 test league'));
      }
      return replace(playerId, state, history, expected);
    });

    const [own] = await rebuildRatingsForPlayers([PLAYER_ID]);

    expect(mockLoadScope).toHaveBeenCalledTimes(2);
    expect(own.matchesReplayed).toBe(0);
    expect(mockReplaceCurve.mock.calls.at(-1)?.[2]).toEqual([]);
  });
});
