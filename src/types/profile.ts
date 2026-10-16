import type { Player, PublicPlayer } from './player';
import type { BracketType } from './tournament';
import type { MatchStatus } from './match';
import type { PlayerRating } from './rating';
import type { PlayerStreaks } from './streak';
import type { SignaturePokemon } from './signature';
import type { EarnedAchievement } from './achievement';

// ─── Per-participation entry ────────────────────────────────────────

export interface ProfileStanding {
  rank: number;
  total: number;
  wins: number;
  losses: number;
}

export interface ProfileBestPokemon {
  pokemon_name: string;
  kos_dealt: number;
}

export interface ProfileParticipation {
  id: string;
  name: string;
  type: 'tournament';
  status: 'upcoming' | 'active' | 'completed';
  bracket_type: BracketType | null;
  standing: ProfileStanding | null;
  best_pokemon: ProfileBestPokemon | null;
}

// ─── Match summary ──────────────────────────────────────────────────

export interface ProfileMatch {
  id: string;
  tournament_id: string;
  tournament_name: string;
  opponent_id: string;
  opponent_name: string;
  opponent_avatar_url: string | null;
  status: MatchStatus;
  winner_id: string | null;
  date_played: string | null;
  game_score: string; // pre-formatted "2-1", "0-0"
}

// ─── Player-scoped Pokémon stats ────────────────────────────────────

export interface ProfilePokemonStat {
  pokemon_name: string;
  total_games: number;
  total_kos_dealt: number;
  total_koed: number;
  kill_differential: number;
  win_rate: number; // percentage 0-100
}

export interface ProfileKillRanking {
  pokemon_name: string;
  kos_dealt: number;
  rank: number;
  total_ranked: number;
}

// ─── Headline stats ─────────────────────────────────────────────────

export interface ProfileHeadlineStats {
  total_matches: number;
  total_wins: number;
  total_losses: number;
  win_rate: number;
  total_kos_dealt: number;
  unique_pokemon_used: number;
  tournaments_entered: number;
  tournaments_won: number;
}

// ─── Trophy ─────────────────────────────────────────────────────────

export interface ProfileTrophy {
  id: string;
  name: string;
  rank: 1 | 2 | 3;
}

// ─── Full profile response ──────────────────────────────────────────

export interface PlayerProfile {
  player: Player;
  headline: ProfileHeadlineStats;
  current_participations: ProfileParticipation[];
  past_participations: ProfileParticipation[];
  upcoming_matches: ProfileMatch[];
  recent_matches: ProfileMatch[];
  most_used_pokemon: ProfilePokemonStat[];
  best_kill_pokemon: ProfileKillRanking[];
  recent_form: ('W' | 'L' | 'D')[];
  trophies: ProfileTrophy[];
  rating: PlayerRating | null;
  streaks: PlayerStreaks | null;
  signatures: SignaturePokemon[];
  achievements: EarnedAchievement[];
}

/**
 * A profile as anyone but the player themself or an admin receives it: the
 * same sections, with the player row narrowed to the `PublicPlayer` card.
 */
export type PublicPlayerProfile = Omit<PlayerProfile, 'player'> & { player: PublicPlayer };

// ─── Raw battle stat with tournament context (internal) ─────────────

export interface PlayerBattleStatRow {
  pokemon_name: string;
  kos_dealt: number;
  was_koed: boolean;
  match_won: boolean;
  tournament_id: string;
}
