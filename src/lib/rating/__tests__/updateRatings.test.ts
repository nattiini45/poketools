import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/rating/glicko2', () => ({
  glicko2Update: vi.fn(),
  inflateRD: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/ratings', () => ({
  getPlayerRating: vi.fn(),
  upsertPlayerRating: vi.fn(),
  insertRatingHistory: vi.fn(),
  getRatingHistoryByMatch: vi.fn(),
  deleteRatingHistoryByMatch: vi.fn(),
}));

// ─── Import after mocks ────────────────────────────────────────────

import { updateRatings, rollbackRatingsForMatch } from '../updateRatings';
import { glicko2Update, inflateRD } from '@/lib/rating/glicko2';
import {
  getPlayerRating,
  upsertPlayerRating,
  insertRatingHistory,
  getRatingHistoryByMatch,
  deleteRatingHistoryByMatch,
} from '@/lib/supabase/queries/ratings';

const mockGlicko2Update = vi.mocked(glicko2Update);
const mockInflateRD = vi.mocked(inflateRD);
const mockGetPlayerRating = vi.mocked(getPlayerRating);
const mockUpsertPlayerRating = vi.mocked(upsertPlayerRating);
const mockInsertRatingHistory = vi.mocked(insertRatingHistory);
const mockGetHistoryByMatch = vi.mocked(getRatingHistoryByMatch);
const mockDeleteHistoryByMatch = vi.mocked(deleteRatingHistoryByMatch);

// ─── Tests ─────────────────────────────────────────────────────────

describe('updateRatings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHistoryByMatch.mockResolvedValue([]);
    mockInflateRD.mockImplementation((rd: number) => rd);
  });

  it('updates ratings for a win', async () => {
    mockGetPlayerRating.mockResolvedValue(null);
    mockGlicko2Update.mockImplementation((player, _opponent, score) => ({
      rating: score === 1.0 ? 1550 : 1450,
      rd: 300,
      volatility: 0.06,
    }));

    const result = await updateRatings('winner-1', 'loser-1', false, 'match-1');

    expect(result.winnerRating).toBe(1550);
    expect(result.loserRating).toBe(1450);
    expect(result.winnerChange).toBe(50);
    expect(result.loserChange).toBe(-50);

    // Two upserts (winner + loser)
    expect(mockUpsertPlayerRating).toHaveBeenCalledTimes(2);
    // Two history inserts
    expect(mockInsertRatingHistory).toHaveBeenCalledTimes(2);

    // Check winner history entry
    expect(mockInsertRatingHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        player_id: 'winner-1',
        match_id: 'match-1',
        result: 'win',
        rating_before: 1500,
        rating_after: 1550,
      })
    );

    // Check loser history entry
    expect(mockInsertRatingHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        player_id: 'loser-1',
        result: 'loss',
      })
    );
  });

  it('handles draws correctly', async () => {
    mockGetPlayerRating.mockResolvedValue(null);
    mockGlicko2Update.mockReturnValue({ rating: 1500, rd: 300, volatility: 0.06 });

    await updateRatings('p1', 'p2', true, 'match-2');

    // Both called with score 0.5
    expect(mockGlicko2Update).toHaveBeenCalledTimes(2);

    // History records show draw
    expect(mockInsertRatingHistory).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: 'p1', result: 'draw' })
    );
    expect(mockInsertRatingHistory).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: 'p2', result: 'draw' })
    );

    // Draw increments draw count, not wins/losses
    expect(mockUpsertPlayerRating).toHaveBeenCalledWith('p1',
      expect.objectContaining({ draws: 1, wins: 0, losses: 0 })
    );
  });

  it('uses existing ratings when available', async () => {
    mockGetPlayerRating.mockResolvedValueOnce({
      rating: 1600, rd: 200, volatility: 0.05,
      peak_rating: 1650, peak_date: '2024-01-01',
      wins: 5, losses: 2, draws: 0, last_match_at: '2024-06-01',
    } as never);
    mockGetPlayerRating.mockResolvedValueOnce(null);
    mockGlicko2Update.mockReturnValue({ rating: 1620, rd: 190, volatility: 0.05 });

    const result = await updateRatings('p1', 'p2', false, 'match-3');

    expect(result.winnerRating).toBe(1620);

    // Winner's wins incremented from 5
    expect(mockUpsertPlayerRating).toHaveBeenCalledWith('p1',
      expect.objectContaining({ wins: 6, losses: 2 })
    );
  });

  it('updates peak rating when new high is reached', async () => {
    mockGetPlayerRating.mockResolvedValueOnce({
      rating: 1500, rd: 350, volatility: 0.06,
      peak_rating: 1500, peak_date: null,
      wins: 0, losses: 0, draws: 0, last_match_at: null,
    } as never);
    mockGetPlayerRating.mockResolvedValueOnce(null);
    mockGlicko2Update.mockReturnValue({ rating: 1600, rd: 300, volatility: 0.06 });

    await updateRatings('p1', 'p2', false, 'match-4');

    // Winner peak updated
    expect(mockUpsertPlayerRating).toHaveBeenCalledWith('p1',
      expect.objectContaining({ peak_rating: 1600 })
    );
  });

  it('inflates RD based on time since last match', async () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
    mockGetPlayerRating.mockResolvedValueOnce({
      rating: 1500, rd: 100, volatility: 0.06,
      peak_rating: 1500, peak_date: null,
      wins: 3, losses: 1, draws: 0, last_match_at: oldDate,
    } as never);
    mockGetPlayerRating.mockResolvedValueOnce(null);
    mockInflateRD.mockReturnValue(150); // Inflated RD
    mockGlicko2Update.mockReturnValue({ rating: 1530, rd: 140, volatility: 0.06 });

    await updateRatings('p1', 'p2', false, 'match-5');

    expect(mockInflateRD).toHaveBeenCalled();
  });

  it('skips processing when rating_history already exists for the match', async () => {
    mockGetHistoryByMatch.mockResolvedValue([
      {
        player_id: 'winner-1',
        match_id: 'match-dup',
        rating_before: 1500,
        rating_after: 1550,
        rd_before: 350,
        rd_after: 300,
        opponent_id: 'loser-1',
        opponent_rating: 1500,
        result: 'win' as const,
        rating_change: 50,
        recorded_at: '2024-01-01',
        id: 'hist-1',
      },
      {
        player_id: 'loser-1',
        match_id: 'match-dup',
        rating_before: 1500,
        rating_after: 1450,
        rd_before: 350,
        rd_after: 300,
        opponent_id: 'winner-1',
        opponent_rating: 1500,
        result: 'loss' as const,
        rating_change: -50,
        recorded_at: '2024-01-01',
        id: 'hist-2',
      },
    ] as never);

    const result = await updateRatings('winner-1', 'loser-1', false, 'match-dup');

    expect(result.winnerRating).toBe(1550);
    expect(result.loserRating).toBe(1450);
    expect(result.winnerChange).toBe(50);
    expect(result.loserChange).toBe(-50);
    expect(mockGetPlayerRating).not.toHaveBeenCalled();
    expect(mockUpsertPlayerRating).not.toHaveBeenCalled();
    expect(mockInsertRatingHistory).not.toHaveBeenCalled();
  });

  it('throws when rating_history exists but is incomplete for the match', async () => {
    mockGetHistoryByMatch.mockResolvedValue([
      {
        player_id: 'winner-1',
        match_id: 'match-incomplete',
        rating_before: 1500,
        rating_after: 1550,
        rd_before: 350,
        rd_after: 300,
        opponent_id: 'loser-1',
        opponent_rating: 1500,
        result: 'win' as const,
        rating_change: 50,
        recorded_at: '2024-01-01',
        id: 'hist-1',
      },
    ] as never);

    await expect(updateRatings('winner-1', 'loser-1', false, 'match-incomplete'))
      .rejects.toThrow('Incomplete rating history for match match-incomplete');
  });
});

describe('rollbackRatingsForMatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no history found', async () => {
    mockGetHistoryByMatch.mockResolvedValue([]);
    const result = await rollbackRatingsForMatch('match-1');
    expect(result).toEqual([]);
    expect(mockDeleteHistoryByMatch).not.toHaveBeenCalled();
  });

  it('rolls back ratings from history', async () => {
    mockGetHistoryByMatch.mockResolvedValue([
      {
        player_id: 'p1', rating_before: 1500, rd_before: 350,
        result: 'win' as const,
      },
      {
        player_id: 'p2', rating_before: 1500, rd_before: 350,
        result: 'loss' as const,
      },
    ] as never);

    mockGetPlayerRating.mockResolvedValue({
      rating: 1550, rd: 300, volatility: 0.06,
      peak_rating: 1550, peak_date: '2024-01-01',
      wins: 3, losses: 1, draws: 0, last_match_at: '2024-06-01',
    } as never);

    const affected = await rollbackRatingsForMatch('match-1');

    expect(affected).toContain('p1');
    expect(affected).toContain('p2');
    expect(mockUpsertPlayerRating).toHaveBeenCalledTimes(2);
    expect(mockDeleteHistoryByMatch).toHaveBeenCalledWith('match-1');

    // Winner's wins decremented
    expect(mockUpsertPlayerRating).toHaveBeenCalledWith('p1',
      expect.objectContaining({ rating: 1500, wins: 2 })
    );
    // Loser's losses decremented
    expect(mockUpsertPlayerRating).toHaveBeenCalledWith('p2',
      expect.objectContaining({ rating: 1500, losses: 0 })
    );
  });

  it('handles draw rollback', async () => {
    mockGetHistoryByMatch.mockResolvedValue([
      { player_id: 'p1', rating_before: 1500, rd_before: 350, result: 'draw' as const },
    ] as never);
    mockGetPlayerRating.mockResolvedValue({
      rating: 1510, rd: 340, volatility: 0.06,
      peak_rating: 1510, peak_date: null,
      wins: 0, losses: 0, draws: 2, last_match_at: null,
    } as never);

    await rollbackRatingsForMatch('match-2');

    expect(mockUpsertPlayerRating).toHaveBeenCalledWith('p1',
      expect.objectContaining({ draws: 1 })
    );
  });

  it('skips players with no current rating', async () => {
    mockGetHistoryByMatch.mockResolvedValue([
      { player_id: 'p1', rating_before: 1500, rd_before: 350, result: 'win' as const },
    ] as never);
    mockGetPlayerRating.mockResolvedValue(null);

    const affected = await rollbackRatingsForMatch('match-3');
    // Player skipped because no current rating
    expect(affected).toEqual([]);
    expect(mockDeleteHistoryByMatch).toHaveBeenCalled();
  });

  it('does not allow negative win/loss/draw counts', async () => {
    mockGetHistoryByMatch.mockResolvedValue([
      { player_id: 'p1', rating_before: 1500, rd_before: 350, result: 'win' as const },
    ] as never);
    mockGetPlayerRating.mockResolvedValue({
      rating: 1550, rd: 300, volatility: 0.06,
      peak_rating: 1550, peak_date: null,
      wins: 0, losses: 0, draws: 0, last_match_at: null,
    } as never);

    await rollbackRatingsForMatch('match-4');

    // wins capped at 0 (Math.max(0, 0 - 1))
    expect(mockUpsertPlayerRating).toHaveBeenCalledWith('p1',
      expect.objectContaining({ wins: 0 })
    );
  });
});
