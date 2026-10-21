import type { SignaturePokemon } from './signature';

export interface PlayerRating {
  id: string;
  player_id: string;
  rating: number;
  rd: number;
  volatility: number;
  peak_rating: number;
  peak_date: string | null;
  wins: number;
  losses: number;
  draws: number;
  last_match_at: string | null;
}

export interface RatingHistoryEntry {
  id: string;
  player_id: string;
  match_id: string;
  rating_before: number;
  rating_after: number;
  rd_before: number;
  rd_after: number;
  opponent_id: string;
  opponent_rating: number;
  result: 'win' | 'loss' | 'draw';
  rating_change: number;
  recorded_at: string;
}

export interface RatingLeaderboardEntry extends PlayerRating {
  player_name: string;
  player_avatar_url: string | null;
  signatures: SignaturePokemon[];
}

/** Glicko-2 constants */
export const GLICKO2_DEFAULTS = {
  INITIAL_RATING: 1500,
  INITIAL_RD: 350,
  INITIAL_VOLATILITY: 0.06,
  SYSTEM_TAU: 0.5,
  RD_FLOOR: 30,
  RD_CEILING: 350,
} as const;
