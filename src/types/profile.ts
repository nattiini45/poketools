import type { Player, PublicPlayer } from './player';
import type { BracketType } from './tournament';
import type { MatchStatus } from './match';
import type { PlayerRating } from './rating';
import type { PlayerStreaks } from './streak';
import type { SignaturePokemon } from './signature';
import type { EarnedAchievement } from './achievement';
import type { HistoricalCompetitionOption, HistoricalHonor } from '@/lib/pack-extensions/historical-statistics-types';
import type { HistoricalStatisticsView } from '@/lib/stats/combined-statistics';
import type { LeaguePhaseAddress } from '@/lib/league-phase/paths';

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

export type ProfileParticipation = {
  id: string;
  name: string;
  status: 'upcoming' | 'active' | 'completed';
  bracket_type: BracketType | null;
  standing: ProfileStanding | null;
  best_pokemon: ProfileBestPokemon | null;
  competition?: HistoricalCompetitionOption;
} & ({ type: 'tournament' } | ({ type: 'phase' } & LeaguePhaseAddress));

// ─── Match summary ──────────────────────────────────────────────────

export type ProfileMatch = {
  id: string;
  opponent_id: string;
  opponent_name: string;
  opponent_avatar_url: string | null;
  status: MatchStatus;
  winner_id: string | null;
  date_played: string | null;
  game_score: string; // pre-formatted "2-1", "0-0"
} & ({ tournament_id: string; tournament_name: string } | (LeaguePhaseAddress & { phase_name: string }));

// ─── Player-scoped Pokémon stats ────────────────────────────────────

export interface ProfilePokemonStat {
  pokemon_name: string;
  total_games: number | null;
  total_kos_dealt: number | null;
  total_koed: number | null;
  kill_differential: number | null;
  win_rate: number | null; // percentage 0-100
}

export interface ProfileKillRanking {
  pokemon_name: string;
  kos_dealt: number;
  rank: number | null;
  total_ranked: number | null;
}

// ─── Headline stats ─────────────────────────────────────────────────

export interface ProfileHeadlineStats {
  total_matches: number;
  total_wins: number;
  total_losses: number;
  total_draws?: number;
  win_rate: number;
  total_kos_dealt: number | null;
  unique_pokemon_used: number;
  tournaments_entered: number;
  tournaments_won: number;
}

// ─── Trophy ─────────────────────────────────────────────────────────

export type ProfileTrophy = {
  id: string;
  name: string;
  rank: 1 | 2 | 3;
} & (LeaguePhaseAddress | { phase_id?: never; season_id?: never });

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
  live_pokemon_counters?: ProfilePokemonCounter[];
  history?: HistoricalStatisticsView;
  historical_honors?: HistoricalHonor[];
}

export interface ProfilePokemonCounter {
  pokemon_name: string;
  total_games: number;
  total_wins: number;
  total_kos_dealt: number;
  total_koed: number;
}

/**
 * A profile as anyone but the player themself or an admin receives it: the
 * same sections, with the player row narrowed to the `PublicPlayer` card.
 */
export type PublicPlayerProfile = Omit<PlayerProfile, 'player' | 'live_pokemon_counters'> & { player: PublicPlayer };
export type CachedPlayerProfile = PublicPlayerProfile & Pick<PlayerProfile, 'live_pokemon_counters'>;

// ─── Raw battle stat with tournament context (internal) ─────────────

export interface PlayerBattleStatRow {
  pokemon_name: string;
  kos_dealt: number;
  was_koed: boolean;
  match_won: boolean;
  tournament_id: string;
}
