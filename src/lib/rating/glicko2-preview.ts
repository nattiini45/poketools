import { glicko2Update } from './glicko2';

export interface RatingPreview {
  player1Delta: number;
  player2Delta: number;
  player1NewRating: number;
  player2NewRating: number;
}

/**
 * Preview Glicko-2 rating changes for both outcomes.
 * Client-safe — uses the existing glicko2 engine.
 */
export function previewRatingChange(
  p1Rating: number,
  p1Rd: number,
  p1Vol: number,
  p2Rating: number,
  p2Rd: number,
  p2Vol: number,
  winner: 1 | 2
): RatingPreview {
  const score1 = winner === 1 ? 1 : 0;
  const score2 = winner === 2 ? 1 : 0;

  const p1After = glicko2Update(
    { rating: p1Rating, rd: p1Rd, volatility: p1Vol },
    { rating: p2Rating, rd: p2Rd, volatility: p2Vol },
    score1
  );

  const p2After = glicko2Update(
    { rating: p2Rating, rd: p2Rd, volatility: p2Vol },
    { rating: p1Rating, rd: p1Rd, volatility: p1Vol },
    score2
  );

  return {
    player1Delta: Math.round(p1After.rating - p1Rating),
    player2Delta: Math.round(p2After.rating - p2Rating),
    player1NewRating: Math.round(p1After.rating),
    player2NewRating: Math.round(p2After.rating),
  };
}
