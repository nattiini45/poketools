import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock('@/lib/rating/glicko2', () => ({
  glicko2Update: vi.fn(),
}));

import { previewRatingChange } from '../glicko2-preview';
import type { RatingPreview } from '../glicko2-preview';
import { glicko2Update } from '@/lib/rating/glicko2';

const mockGlicko2Update = vi.mocked(glicko2Update);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────

describe('previewRatingChange', () => {
  it('returns player1Delta, player2Delta, player1NewRating, player2NewRating', () => {
    mockGlicko2Update.mockReturnValueOnce({ rating: 1532.5, rd: 200, volatility: 0.06 });
    mockGlicko2Update.mockReturnValueOnce({ rating: 1467.5, rd: 200, volatility: 0.06 });

    const result: RatingPreview = previewRatingChange(
      1500, 200, 0.06,
      1500, 200, 0.06,
      1,
    );

    expect(result).toHaveProperty('player1Delta');
    expect(result).toHaveProperty('player2Delta');
    expect(result).toHaveProperty('player1NewRating');
    expect(result).toHaveProperty('player2NewRating');
  });

  it('calculates correct deltas when player 1 wins', () => {
    mockGlicko2Update.mockReturnValueOnce({ rating: 1530, rd: 200, volatility: 0.06 });
    mockGlicko2Update.mockReturnValueOnce({ rating: 1470, rd: 200, volatility: 0.06 });

    const result = previewRatingChange(
      1500, 200, 0.06,
      1500, 200, 0.06,
      1,
    );

    expect(result.player1Delta).toBe(30);    // 1530 - 1500
    expect(result.player2Delta).toBe(-30);   // 1470 - 1500
    expect(result.player1NewRating).toBe(1530);
    expect(result.player2NewRating).toBe(1470);
  });

  it('calculates correct deltas when player 2 wins', () => {
    mockGlicko2Update.mockReturnValueOnce({ rating: 1470, rd: 200, volatility: 0.06 });
    mockGlicko2Update.mockReturnValueOnce({ rating: 1530, rd: 200, volatility: 0.06 });

    const result = previewRatingChange(
      1500, 200, 0.06,
      1500, 200, 0.06,
      2,
    );

    expect(result.player1Delta).toBe(-30);
    expect(result.player2Delta).toBe(30);
    expect(result.player1NewRating).toBe(1470);
    expect(result.player2NewRating).toBe(1530);
  });

  it('passes score=1 for the winner and score=0 for the loser', () => {
    mockGlicko2Update.mockReturnValue({ rating: 1500, rd: 200, volatility: 0.06 });

    previewRatingChange(1500, 200, 0.06, 1500, 200, 0.06, 1);

    // First call: player1 with score=1
    expect(mockGlicko2Update).toHaveBeenNthCalledWith(
      1,
      { rating: 1500, rd: 200, volatility: 0.06 },
      { rating: 1500, rd: 200, volatility: 0.06 },
      1, // winner score
    );

    // Second call: player2 with score=0
    expect(mockGlicko2Update).toHaveBeenNthCalledWith(
      2,
      { rating: 1500, rd: 200, volatility: 0.06 },
      { rating: 1500, rd: 200, volatility: 0.06 },
      0, // loser score
    );
  });

  it('passes score=0 for player1 and score=1 for player2 when player2 wins', () => {
    mockGlicko2Update.mockReturnValue({ rating: 1500, rd: 200, volatility: 0.06 });

    previewRatingChange(1500, 200, 0.06, 1500, 200, 0.06, 2);

    // First call: player1 with score=0
    expect(mockGlicko2Update).toHaveBeenNthCalledWith(
      1,
      { rating: 1500, rd: 200, volatility: 0.06 },
      { rating: 1500, rd: 200, volatility: 0.06 },
      0,
    );

    // Second call: player2 with score=1
    expect(mockGlicko2Update).toHaveBeenNthCalledWith(
      2,
      { rating: 1500, rd: 200, volatility: 0.06 },
      { rating: 1500, rd: 200, volatility: 0.06 },
      1,
    );
  });

  it('rounds deltas and new ratings to integers', () => {
    mockGlicko2Update.mockReturnValueOnce({ rating: 1532.78, rd: 198.3, volatility: 0.06 });
    mockGlicko2Update.mockReturnValueOnce({ rating: 1467.22, rd: 198.3, volatility: 0.06 });

    const result = previewRatingChange(
      1500, 200, 0.06,
      1500, 200, 0.06,
      1,
    );

    expect(result.player1Delta).toBe(33);       // Math.round(1532.78 - 1500)
    expect(result.player2Delta).toBe(-33);      // Math.round(1467.22 - 1500)
    expect(result.player1NewRating).toBe(1533); // Math.round(1532.78)
    expect(result.player2NewRating).toBe(1467); // Math.round(1467.22)
  });

  it('handles unequal starting ratings', () => {
    mockGlicko2Update.mockReturnValueOnce({ rating: 1620, rd: 190, volatility: 0.06 });
    mockGlicko2Update.mockReturnValueOnce({ rating: 1390, rd: 310, volatility: 0.06 });

    const result = previewRatingChange(
      1600, 200, 0.06,
      1400, 300, 0.06,
      1,
    );

    expect(result.player1Delta).toBe(20);      // 1620 - 1600
    expect(result.player2Delta).toBe(-10);     // 1390 - 1400
    expect(result.player1NewRating).toBe(1620);
    expect(result.player2NewRating).toBe(1390);
  });

  it('calls glicko2Update exactly twice', () => {
    mockGlicko2Update.mockReturnValue({ rating: 1500, rd: 200, volatility: 0.06 });

    previewRatingChange(1500, 200, 0.06, 1500, 200, 0.06, 1);

    expect(mockGlicko2Update).toHaveBeenCalledTimes(2);
  });
});
