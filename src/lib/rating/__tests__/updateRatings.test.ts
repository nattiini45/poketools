import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/rating/glicko2', () => ({
  glicko2Update: vi.fn(),
  inflateRD: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/ratings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/queries/ratings')>();
  return {
    getPlayerRating: vi.fn(),
    getRatingHistoryByMatch: vi.fn(),
    applyMatchRatingResult: vi.fn(),
    loadRatingScope: vi.fn(),
    getMatchTournamentIdForRating: vi.fn(),
    // Pure mapper: the real one, so the fence values are the real projection.
    toExpectedRatingState: actual.toExpectedRatingState,
  };
});

// ─── Import after mocks ────────────────────────────────────────────

import { updateRatings, ratingRebuildsInFlight } from '../updateRatings';
import { glicko2Update, inflateRD } from '@/lib/rating/glicko2';
import {
  applyMatchRatingResult,
  getMatchTournamentIdForRating,
  getPlayerRating,
  getRatingHistoryByMatch,
  loadRatingScope,
  type MatchRatingResultEntry,
} from '@/lib/supabase/queries/ratings';
import { createRatingScope } from '@/lib/rating/rating-scope';

const mockGlicko2Update = vi.mocked(glicko2Update);
const mockInflateRD = vi.mocked(inflateRD);
const mockGetPlayerRating = vi.mocked(getPlayerRating);
const mockGetHistoryByMatch = vi.mocked(getRatingHistoryByMatch);
const mockApply = vi.mocked(applyMatchRatingResult);
const mockLoadScope = vi.mocked(loadRatingScope);
const mockMatchTournament = vi.mocked(getMatchTournamentIdForRating);

/** The tournament of every match in these tests unless a test says otherwise (a normal league). */
const NORMAL_TOURNAMENT = 't-normal';
const TEST_LEAGUE_TOURNAMENT = 't-test-league';

/** The entries of the n-th (0-based) apply call. */
function applyEntries(call = 0): readonly MatchRatingResultEntry[] {
  return mockApply.mock.calls[call][1];
}

function entryFor(playerId: string, call = 0): MatchRatingResultEntry {
  const entry = applyEntries(call).find((e) => e.playerId === playerId);
  if (!entry) throw new Error(`no apply entry for ${playerId}`);
  return entry;
}

const storedRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'pr',
  player_id: 'p',
  rating: 1600,
  rd: 200,
  volatility: 0.05,
  peak_rating: 1650,
  peak_date: '2024-01-01',
  wins: 5,
  losses: 2,
  draws: 0,
  last_match_at: '2024-06-01',
  ...overrides,
});

const historyRows = (matchId: string) => [
  {
    id: 'hist-1', player_id: 'winner-1', match_id: matchId, rating_before: 1500, rating_after: 1550,
    rd_before: 350, rd_after: 300, opponent_id: 'loser-1', opponent_rating: 1500, result: 'win' as const,
    rating_change: 50, recorded_at: '2024-01-01',
  },
  {
    id: 'hist-2', player_id: 'loser-1', match_id: matchId, rating_before: 1500, rating_after: 1450,
    rd_before: 350, rd_after: 300, opponent_id: 'winner-1', opponent_rating: 1500, result: 'loss' as const,
    rating_change: -50, recorded_at: '2024-01-01',
  },
];

// ─── Tests ─────────────────────────────────────────────────────────

describe('updateRatings (live path, one transaction via rating_apply_match_result)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHistoryByMatch.mockResolvedValue([]);
    mockInflateRD.mockImplementation((rd: number) => rd);
    mockApply.mockResolvedValue('applied');
    mockLoadScope.mockResolvedValue(createRatingScope([TEST_LEAGUE_TOURNAMENT]));
    mockMatchTournament.mockResolvedValue(NORMAL_TOURNAMENT);
  });

  it('writes both ratings and both history rows in ONE apply call for a win', async () => {
    mockGetPlayerRating.mockResolvedValue(null);
    mockGlicko2Update.mockImplementation((_player, _opponent, score) => ({
      rating: score === 1.0 ? 1550 : 1450,
      rd: 300,
      volatility: 0.06,
    }));

    const result = await updateRatings('winner-1', 'loser-1', false, 'match-1');

    expect(result).toEqual({ status: 'rated', winnerRating: 1550, loserRating: 1450, winnerChange: 50, loserChange: -50 });
    expect(mockApply).toHaveBeenCalledTimes(1);
    expect(mockApply.mock.calls[0][0]).toBe('match-1');
    expect(applyEntries()).toHaveLength(2);

    const winner = entryFor('winner-1');
    expect(winner.expected).toBeNull(); // no stored row was read
    expect(winner.state).toMatchObject({ rating: 1550, wins: 1, losses: 0, draws: 0 });
    expect(winner.history).toEqual({
      rating_before: 1500,
      rating_after: 1550,
      rd_before: 350,
      rd_after: 300,
      opponent_id: 'loser-1',
      opponent_rating: 1500,
      result: 'win',
    });
    const loser = entryFor('loser-1');
    expect(loser.state).toMatchObject({ rating: 1450, wins: 0, losses: 1 });
    expect(loser.history).toMatchObject({ opponent_id: 'winner-1', result: 'loss' });
  });

  it('handles draws correctly', async () => {
    mockGetPlayerRating.mockResolvedValue(null);
    mockGlicko2Update.mockReturnValue({ rating: 1500, rd: 300, volatility: 0.06 });

    await updateRatings('p1', 'p2', true, 'match-2');

    expect(mockGlicko2Update).toHaveBeenCalledTimes(2);
    expect(entryFor('p1').history.result).toBe('draw');
    expect(entryFor('p2').history.result).toBe('draw');
    expect(entryFor('p1').state).toMatchObject({ draws: 1, wins: 0, losses: 0 });
  });

  it('computes from the stored rows and fences on exactly the values it read', async () => {
    mockGetPlayerRating.mockResolvedValueOnce(storedRow({ player_id: 'p1' }) as never);
    mockGetPlayerRating.mockResolvedValueOnce(null);
    mockGlicko2Update.mockReturnValue({ rating: 1620, rd: 190, volatility: 0.05 });

    const result = await updateRatings('p1', 'p2', false, 'match-3');

    expect(result).toMatchObject({ status: 'rated', winnerRating: 1620 });
    expect(entryFor('p1').state).toMatchObject({ wins: 6, losses: 2 });
    expect(entryFor('p1').expected).toEqual({ rating: 1600, rd: 200, volatility: 0.05, wins: 5, losses: 2, draws: 0 });
    expect(entryFor('p2').expected).toBeNull();
  });

  it('updates peak rating when new high is reached', async () => {
    mockGetPlayerRating.mockResolvedValueOnce(
      storedRow({ rating: 1500, rd: 350, volatility: 0.06, peak_rating: 1500, peak_date: null, wins: 0, losses: 0, last_match_at: null }) as never
    );
    mockGetPlayerRating.mockResolvedValueOnce(null);
    mockGlicko2Update.mockReturnValue({ rating: 1600, rd: 300, volatility: 0.06 });

    await updateRatings('p1', 'p2', false, 'match-4');

    expect(entryFor('p1').state).toMatchObject({ peak_rating: 1600 });
  });

  it('inflates RD based on time since last match', async () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    mockGetPlayerRating.mockResolvedValueOnce(storedRow({ rd: 100, last_match_at: oldDate }) as never);
    mockGetPlayerRating.mockResolvedValueOnce(null);
    mockInflateRD.mockReturnValue(150);
    mockGlicko2Update.mockReturnValue({ rating: 1530, rd: 140, volatility: 0.06 });

    await updateRatings('p1', 'p2', false, 'match-5');

    expect(mockInflateRD).toHaveBeenCalled();
    expect(entryFor('p1').history.rd_before).toBe(150);
  });

  it('skips processing when rating_history already exists for the match', async () => {
    mockGetHistoryByMatch.mockResolvedValue(historyRows('match-dup') as never);

    const result = await updateRatings('winner-1', 'loser-1', false, 'match-dup');

    expect(result).toEqual({ status: 'rated', winnerRating: 1550, loserRating: 1450, winnerChange: 50, loserChange: -50 });
    expect(mockGetPlayerRating).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('throws when rating_history stays one-sided after waiting for a rebuild to finish it', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockGetHistoryByMatch.mockResolvedValue([historyRows('match-incomplete')[0]] as never);

      const pending = updateRatings('winner-1', 'loser-1', false, 'match-incomplete');
      const assertion = expect(pending).rejects.toThrow('Incomplete rating history for match match-incomplete');
      await vi.advanceTimersByTimeAsync(250 + 750 + 1500);
      await assertion;

      // The first read plus one re-read after each wait.
      expect(mockGetHistoryByMatch).toHaveBeenCalledTimes(4);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('one-sided rating history'));
      expect(mockApply).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('waits for a rebuild in another process to write the second history row, then reports the stored change', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockGetHistoryByMatch
        .mockResolvedValueOnce([historyRows('match-rebuilding')[0]] as never)
        .mockResolvedValueOnce(historyRows('match-rebuilding') as never);

      const pending = updateRatings('winner-1', 'loser-1', false, 'match-rebuilding');
      await vi.advanceTimersByTimeAsync(250);

      await expect(pending).resolves.toEqual({ status: 'rated', winnerRating: 1550, loserRating: 1450, winnerChange: 50, loserChange: -50 });
      expect(mockGetPlayerRating).not.toHaveBeenCalled();
      expect(mockApply).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('reads the rebuild result when the RPC finds a one-sided history written after its read (history_incomplete)', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockGetPlayerRating.mockResolvedValue(null);
      mockGlicko2Update.mockReturnValue({ rating: 1600, rd: 300, volatility: 0.06 });
      mockApply.mockResolvedValueOnce('history_incomplete');
      mockGetHistoryByMatch
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([historyRows('match-late')[0]] as never)
        .mockResolvedValueOnce(historyRows('match-late') as never);

      const pending = updateRatings('winner-1', 'loser-1', false, 'match-late');
      await vi.advanceTimersByTimeAsync(250);

      await expect(pending).resolves.toEqual({ status: 'rated', winnerRating: 1550, loserRating: 1450, winnerChange: 50, loserChange: -50 });
      expect(mockApply).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('reports the stored change when a concurrent finalize applied the match first (already_applied)', async () => {
    mockGetPlayerRating.mockResolvedValue(null);
    mockGlicko2Update.mockReturnValue({ rating: 1700, rd: 300, volatility: 0.06 });
    mockApply.mockResolvedValueOnce('already_applied');
    mockGetHistoryByMatch.mockResolvedValueOnce([]).mockResolvedValueOnce(historyRows('match-race') as never);

    const result = await updateRatings('winner-1', 'loser-1', false, 'match-race');

    // The other writer's numbers, not this computation's 1700.
    expect(result).toEqual({ status: 'rated', winnerRating: 1550, loserRating: 1450, winnerChange: 50, loserChange: -50 });
    expect(mockApply).toHaveBeenCalledTimes(1);
  });

  it('re-reads and recomputes when a player changed between read and write (stale), never overwriting it', async () => {
    mockGetPlayerRating
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      // Second attempt: a concurrent finalize sharing p1 wrote its row meanwhile.
      .mockResolvedValueOnce(storedRow({ player_id: 'p1', rating: 1580, wins: 1, losses: 0 }) as never)
      .mockResolvedValueOnce(null);
    mockGlicko2Update.mockReturnValue({ rating: 1600, rd: 300, volatility: 0.06 });
    mockApply.mockResolvedValueOnce('stale').mockResolvedValueOnce('applied');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await updateRatings('p1', 'p2', false, 'match-stale');

    expect(mockApply).toHaveBeenCalledTimes(2);
    expect(entryFor('p1', 1).expected).toMatchObject({ rating: 1580, wins: 1 });
    expect(entryFor('p1', 1).state).toMatchObject({ wins: 2 });
    expect(entryFor('p1', 1).history.rating_before).toBe(1580);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('attempt 1 of 3'));
    warn.mockRestore();
  });

  it('gives up after three stale attempts with an error (nothing was written)', async () => {
    mockGetPlayerRating.mockResolvedValue(null);
    mockGlicko2Update.mockReturnValue({ rating: 1600, rd: 300, volatility: 0.06 });
    mockApply.mockResolvedValue('stale');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(updateRatings('p1', 'p2', false, 'match-busy')).rejects.toThrow(
      'Ratings for match match-busy were not applied: the players\' ratings kept changing during 3 attempts'
    );
    expect(mockApply).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('writes nothing for a match of a test league: no history read, no rating read, no RPC', async () => {
    mockMatchTournament.mockResolvedValue(TEST_LEAGUE_TOURNAMENT);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const result = await updateRatings('winner-1', 'loser-1', false, 'match-test-league');

    expect(result).toEqual({ status: 'skipped_test_season' });
    expect(mockMatchTournament).toHaveBeenCalledWith('match-test-league');
    expect(mockGetHistoryByMatch).not.toHaveBeenCalled();
    expect(mockGetPlayerRating).not.toHaveBeenCalled();
    expect(mockGlicko2Update).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('belongs to a test league'));
    info.mockRestore();
  });

  it('does not report leftover history rows of a test-league match as its rating change', async () => {
    mockMatchTournament.mockResolvedValue(TEST_LEAGUE_TOURNAMENT);
    mockGetHistoryByMatch.mockResolvedValue(historyRows('match-old-test') as never);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    await expect(updateRatings('winner-1', 'loser-1', false, 'match-old-test')).resolves.toEqual({
      status: 'skipped_test_season',
    });
    expect(mockGetHistoryByMatch).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it('rates a standalone or normal-league match as before', async () => {
    mockMatchTournament.mockResolvedValue('t-standalone');
    mockGetPlayerRating.mockResolvedValue(null);
    mockGlicko2Update.mockImplementation((_player, _opponent, score) => ({
      rating: score === 1.0 ? 1550 : 1450,
      rd: 300,
      volatility: 0.06,
    }));

    await expect(updateRatings('winner-1', 'loser-1', false, 'match-standalone')).resolves.toEqual(
      { status: 'rated', winnerRating: 1550, loserRating: 1450, winnerChange: 50, loserChange: -50 }
    );
    expect(mockApply).toHaveBeenCalledTimes(1);
  });

  it('returns skipped_test_season when the RPC finds the league became a test league after the check', async () => {
    mockGetPlayerRating.mockResolvedValue(null);
    mockGlicko2Update.mockReturnValue({ rating: 1600, rd: 300, volatility: 0.06 });
    mockApply.mockResolvedValueOnce('skipped_test_season');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    await expect(updateRatings('p1', 'p2', false, 'm-flagged')).resolves.toEqual({ status: 'skipped_test_season' });
    expect(mockApply).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('flag set meanwhile'));
    info.mockRestore();
  });

  it('throws when the match does not exist (no tournament to check), before any rating read', async () => {
    mockMatchTournament.mockResolvedValue(null);

    await expect(updateRatings('p1', 'p2', false, 'm-gone')).rejects.toThrow(
      'Match m-gone not found; its ratings were not applied'
    );
    expect(mockGetHistoryByMatch).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('propagates a failed rating-scope read (never falls back to rating a test-league match)', async () => {
    mockLoadScope.mockRejectedValueOnce(new Error('seasons read failed'));

    await expect(updateRatings('p1', 'p2', false, 'm-scope')).rejects.toThrow('seasons read failed');
    expect(mockApply).not.toHaveBeenCalled();
  });

  it.each([
    ['history_incomplete', 'Incomplete rating history for match m-x'],
    ['match_missing', 'Match m-x not found; its ratings were not applied'],
    ['match_not_completed', 'Match m-x is no longer completed; its ratings were not applied'],
  ] as const)('throws on the %s outcome', async (outcome, message) => {
    mockGetPlayerRating.mockResolvedValue(null);
    mockGlicko2Update.mockReturnValue({ rating: 1600, rd: 300, volatility: 0.06 });
    mockApply.mockResolvedValueOnce(outcome);

    await expect(updateRatings('p1', 'p2', false, 'm-x')).rejects.toThrow(message);
  });

  it('propagates the RPC error unchanged (the transaction rolled back: nothing written)', async () => {
    mockGetPlayerRating.mockResolvedValue(null);
    mockGlicko2Update.mockReturnValue({ rating: 1500, rd: 300, volatility: 0.06 });
    const err = new Error('apply failed');
    mockApply.mockRejectedValueOnce(err);

    await expect(updateRatings('p1', 'p2', false, 'match-6')).rejects.toBe(err);
    expect(mockApply).toHaveBeenCalledTimes(1);
  });

  it('queues on the in-process rating lock (counted while in flight)', async () => {
    mockGetPlayerRating.mockResolvedValue(null);
    mockGlicko2Update.mockReturnValue({ rating: 1500, rd: 300, volatility: 0.06 });
    let release!: () => void;
    mockApply.mockReturnValueOnce(new Promise((resolve) => { release = () => resolve('applied'); }));

    const pending = updateRatings('p1', 'p2', false, 'match-lock');
    expect(ratingRebuildsInFlight()).toBe(1);
    await vi.waitFor(() => expect(mockApply).toHaveBeenCalledTimes(1));
    release();
    await pending;
    await vi.waitFor(() => expect(ratingRebuildsInFlight()).toBe(0));
  });
});
