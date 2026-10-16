// ── AI Tournament Report Types ──────────────────────────────────────

export type TournamentReportType =
  | 'round_recap'
  | 'round_forecast'
  | 'season_summary'
  | 'meta_report'
  | 'player_profile';
export type TournamentReportStatus = 'pending' | 'completed' | 'failed';

/** Database row for a tournament report */
export interface TournamentReport {
  id: string;
  tournament_id: string;
  round_id: string;
  report_type: TournamentReportType;
  model_id: string;
  content: ReportContent;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  generation_time_ms: number | null;
  status: TournamentReportStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// ── Round Recap (post-round) ────────────────────────────────────────

/** Server-computed match data — the source of truth for the UI. Never AI-generated. */
export interface RoundRecapMatchData {
  match_id?: string;
  player_1_id: string;
  player_1_name: string;
  player_1_avatar_url: string | null;
  player_2_id: string;
  player_2_name: string;
  player_2_avatar_url: string | null;
  winner_id: string;
  winner_name: string;
  p1_score: number;       // remaining mons
  p2_score: number;
  p1_total_kos: number;
  p2_total_kos: number;
  mvp_pokemon: string;
  mvp_player_id: string;
  mvp_kos: number;
}

export interface RoundRecapContent {
  headline: string;
  narrative: string;
  match_summaries: RoundRecapMatchSummary[];
  /** Server-computed structured match data — use for UI instead of AI text */
  match_data: RoundRecapMatchData[];
  /** Pokémon species → type(s) lookup, e.g. { "Carkol": ["Rock", "Fire"] } */
  pokemon_types: Record<string, string[]>;
  standings_story: string;
  meta_trends: string;
  player_spotlight: {
    player_id: string;
    player_name: string;
    reason: string;
  };
  spicy_pick: {
    pokemon_name: string;
    player_id: string;
    player_name: string;
    context: string;
  } | null;
}

export interface RoundRecapMatchSummary {
  player_1_name: string;
  player_2_name: string;
  winner_name: string;
  score: string;
  one_liner: string;
  mvp_pokemon: string;
}

// ── Round Forecast (pre-round) ──────────────────────────────────────

export interface RoundForecastContent {
  headline: string;
  narrative: string;
  matchup_previews: RoundForecastMatchup[];
  standings_context: string;
  players_to_watch: {
    player_name: string;
    reason: string;
  }[];
  bold_prediction: string;
}

export interface RoundForecastMatchup {
  player_1_name: string;
  player_2_name: string;
  storyline: string;
  edge: string;
  key_pokemon: string;
}

// ── Season Summary (end-of-season) ──────────────────────────────────

export interface SeasonSummaryContent {
  headline: string;
  narrative: string;
  /** Server-computed final standings */
  final_standings: {
    rank: number;
    player_name: string;
    player_id: string;
    points: number;
    record: string;
    kd: string;
  }[];
  season_mvp: {
    player_id: string;
    player_name: string;
    reason: string;
  };
  notable_moments: string[];
  meta_evolution: string;
}

// ── Meta Report (format-level usage analysis) ───────────────────────

export interface MetaReportContent {
  headline: string;
  narrative: string;
  /** Server-computed usage table */
  usage_data: {
    pokemon_name: string;
    usage_pct: number;
    total_kos: number;
    win_rate: number;
  }[];
  top_pokemon: {
    pokemon_name: string;
    role: string;
    analysis: string;
  }[];
  type_trends: string;
  emerging_threats: string;
}

// ── Player Profile (individual season story) ────────────────────────

export interface PlayerProfileContent {
  headline: string;
  narrative: string;
  /** Server-computed season record */
  season_record: {
    wins: number;
    losses: number;
    draws: number;
    points: number;
    final_rank: number;
    kd: number;
  };
  signature_pokemon: {
    pokemon_name: string;
    times_used: number;
    total_kos: number;
    analysis: string;
  }[];
  notable_wins: {
    opponent_name: string;
    score: string;
    context: string;
  }[];
  team_evolution: string;
}

// ── Content Union ───────────────────────────────────────────────────

export type ReportContent =
  | RoundRecapContent
  | RoundForecastContent
  | SeasonSummaryContent
  | MetaReportContent
  | PlayerProfileContent;
