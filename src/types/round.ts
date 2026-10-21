import type { Enums } from './database';

export type RoundStatus = Enums<'round_status'>;
export type BracketSide = import('./match').BracketSide;

export interface Round {
  id: string;
  tournament_id: string;
  name: string;
  round_number: number;
  best_of: number;
  status: RoundStatus;
  pairings_generated: boolean;
  deadline: string | null;
  bracket_side: BracketSide | null;
  created_at: string;
  updated_at: string;
}

/**
 * A round with its matches as the round detail endpoint returns them
 * (`GET /api/tournaments/[id]/rounds/[rid]`, public). The matches are the
 * public shape: no admin notes, submitter or confirmation timestamps.
 */
export interface RoundWithMatches extends Round {
  matches: import('@/lib/match/public-match').PublicMatch[];
}
