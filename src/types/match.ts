import type { Enums } from './database';

export type MatchStatus = Enums<'match_status'>;
export type GameSource = Enums<'game_source'>;

export type BracketSide = 'winners' | 'losers' | 'grand_finals';

export interface Match {
  id: string;
  round_id: string;
  tournament_id: string;
  player_1_id: string;
  player_2_id: string;
  winner_id: string | null;
  status: MatchStatus;
  submitter_id: string | null;
  date_played: string | null;
  scheduled_at: string | null;
  auto_confirm_at: string | null;
  confirmed_at: string | null;
  notes: string;
  social_image_url: string | null;
  bracket_side: BracketSide | null;
  bracket_pos: number | null;
  created_at: string;
  updated_at: string;
}

export interface MatchWithPlayers extends Match {
  player_1_name: string;
  player_2_name: string;
  player_1_avatar_url: string | null;
  player_2_avatar_url: string | null;
  winner_name: string | null;
  round_status: import('./round').RoundStatus;
  games: GameSummary[];
}

export interface GameSummary {
  id: string;
  game_number: number;
  winner_id: string | null;
  replay_url: string;
  source: GameSource;
  stats_locked: boolean;
}
