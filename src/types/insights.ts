import type { PlayerStreaks } from './streak';

export interface StreakLeaderboardEntry extends PlayerStreaks {
  player_name: string;
  player_avatar_url: string | null;
}
