/** Internal types for tournament pairing algorithms */

export interface Standing {
  player_id: string;
  player_name: string;
  player_avatar_url: string | null;
  /** Gym leader type for league contexts (null if not assigned or not in a league) */
  gym_type: string | null;
  wins: number;
  losses: number;
  draws: number;
  /** Points: configurable per bracket type (Swiss: 1/win, RR: 3/win) */
  points: number;
  /** Buchholz tiebreaker: sum of opponents' points (Swiss only) */
  buchholz: number;
  /** Total individual games played (not matches) */
  games_played: number;
  /** Kill differential: KOs dealt minus KOs received across all games */
  kill_differential: number;
  /** For elimination: whether the player is still active */
  eliminated: boolean;
}

export interface Pairing {
  player_1_id: string;
  player_2_id: string;
}

/** A bye is represented as a pairing with BYE_PLAYER_ID */
export const BYE_PLAYER_ID = '__BYE__';

export interface GeneratedRound {
  round_number: number;
  round_name: string;
  pairings: Pairing[];
  /** Players receiving a bye this round */
  bye_player_ids: string[];
}

export interface MatchRecord {
  player_1_id: string;
  player_2_id: string;
  winner_id: string | null;
  round_number: number;
}
