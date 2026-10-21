export interface PlayerStreaks {
  id: string;
  player_id: string;
  current_win_streak: number;
  best_win_streak: number;
  current_loss_streak: number;
  best_loss_streak: number;
  current_ko_streak: number;
  best_ko_streak: number;
  current_flawless_streak: number;
  best_flawless_streak: number;
  last_match_id: string | null;
}

export interface MatchResult {
  won: boolean;
  lost: boolean;
  drew: boolean;
}

export interface MatchStats {
  total_kos_dealt: number;
  total_kos_lost: number;
}

export interface StreakChanges {
  win_streak: { before: number; after: number };
  loss_streak: { before: number; after: number };
  ko_streak: { before: number; after: number };
  flawless_streak: { before: number; after: number };
  new_records: string[];
}
