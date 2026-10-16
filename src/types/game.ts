import type { Enums } from './database';
import type { EvolutionEvent } from './evolution';
import type { ImpossibleLineup } from '@/lib/reconcile/evolution-rebuild';
import type { MatchChildrenCleanup } from '@/lib/match/match-children';

export type GameSource = Enums<'game_source'>;
export type AggregateScope = Enums<'aggregate_scope'>;

// ─── Game ────────────────────────────────────────────────────────────

export interface Game {
  id: string;
  match_id: string;
  game_number: number;
  winner_id: string | null;
  replay_url: string;
  source: GameSource;
  parsed: boolean;
  stats_locked: boolean;
  aggregate_applied_at?: string | null;
  exclude_all_time: boolean;
  created_at: string;
  updated_at: string;
}

export interface GameCreateInput {
  match_id: string;
  game_number: number;
  winner_id: string | null;
  replay_url?: string;
  source: GameSource;
  parsed?: boolean;
  exclude_all_time: boolean;
}

// ─── Battle Stats ────────────────────────────────────────────────────

export interface BattleStat {
  id: string;
  game_id: string;
  player_id: string;
  pokemon_name: string;
  was_brought: boolean;
  was_lead: boolean;
  kos_dealt: number;
  was_koed: boolean;
  moves_used: string[];
  turns_active: number;
  match_won: boolean;
  created_at: string;
}

export interface BattleStatInsert {
  game_id: string;
  player_id: string;
  pokemon_name: string;
  was_brought?: boolean;
  was_lead?: boolean;
  kos_dealt?: number;
  was_koed?: boolean;
  moves_used?: string[];
  turns_active?: number;
  match_won?: boolean;
}

// ─── Aggregates ──────────────────────────────────────────────────────

export interface Aggregate {
  id: string;
  scope_type: AggregateScope;
  scope_id: string | null;
  pokemon_name: string;
  total_appearances: number;
  total_brought: number;
  total_led: number;
  total_kos_dealt: number;
  total_koed: number;
  total_wins: number;
  total_games: number;
  move_counts: Record<string, number>;
  last_updated: string;
}

export interface PlayerAggregate extends Aggregate {
  player_id: string;
}

// ─── Replay Parsing ──────────────────────────────────────────────────

export interface ReplayData {
  id: string;
  format: string;
  players: [string, string]; // PS usernames
  winner: string; // PS username
  log: string;
}

export interface ParsedBattleStats {
  winner_ps_username: string;
  players: {
    ps_username: string;
    pokemon: ParsedPokemonStat[];
  }[];
}

export interface ParsedPokemonStat {
  pokemon_name: string;
  was_brought: boolean;
  was_lead: boolean;
  kos_dealt: number;
  was_koed: boolean;
  moves_used: string[];
  turns_active: number;
}

/**
 * Best-effort mapping of a parsed replay side (Showdown username) to one of the
 * two registered match participants. `suggested_player_id` is null when the PS
 * username does not resolve to a participant — the admin assigns it manually.
 */
export interface ReplaySideSuggestion {
  ps_username: string;
  suggested_player_id: string | null;
}

/**
 * Response from the admin replay-preview route: the parsed stats (no legibility
 * gate) plus best-effort side→player suggestions for the manual-assign editor.
 */
export interface ReplayPreviewResult {
  parsed: ParsedBattleStats;
  winner_ps_username: string;
  suggestions: ReplaySideSuggestion[];
}

// ─── API Request/Response Types ──────────────────────────────────────

export interface ParseReplayRequest {
  match_id: string;
  replay_url: string;
}

export interface ManualResultRequest {
  match_id: string;
  winner_id: string;
  pokemon_stats: {
    player_id: string;
    pokemon: {
      pokemon_name: string;
      was_brought?: boolean;
      was_lead?: boolean;
      kos_dealt?: number;
      was_koed?: boolean;
      moves_used?: string[];
      turns_active?: number;
    }[];
  }[];
}

export interface ConfirmMatchRequest {
  action: 'confirm' | 'dispute';
  winner_id?: string;
  notes?: string;
}

// ─── Admin Pipeline Types ───────────────────────────────────────────

/**
 * Itemized recalculation summary surfaced after a match-delete/reset flow
 * (spec §24). Deletion of a match result forces a full recalculation of every
 * derived record that depended on it; this summary itemizes what was rebuilt so
 * the admin UI can confirm the work and flag any inconsistencies.
 *
 * The legacy top-level fields on `ResetMatchResult` / `DeleteGameResult`
 * (`games_deleted`, `impossibleLineups`, `childrenCleanup`, `evolution_events`)
 * are preserved for backward compatibility; `recalculation` is the richer,
 * unified view that the admin confirmation flow renders.
 */
export interface MatchRecalculationSummary {
  gamesDeleted: number;
  /** Per-type match-derived children cleanup from `cleanMatchChildren` (T5). */
  childrenCleanup?: MatchChildrenCleanup;
  /** Player ids whose rating curves were rebuilt (both match participants). */
  ratingsRebuilt?: { players: string[] };
  /**
   * EPB evolution rebuild detail from `repairSeasonEvolution` (T3 `RepairResult`
   * projection). Present only for evolution_point_buy seasons; legacy seasons
   * leave this undefined.
   */
  evolutionRepaired?: {
    trackersUpdated: number;
    eventsRewritten: number;
    evolutionPoints: number;
    impossibleLineups: ImpossibleLineup[];
  };
  /**
   * Unified impossible-lineups array (EPB) for easy UI access. Mirrors the EPB
   * repair result's `impossibleLineups`; empty for legacy seasons (where no
   * whole-season rebuild runs and none can be surfaced).
   */
  impossibleLineups: ImpossibleLineup[];
}

export interface DeleteGameResult {
  match_status: string;
  games_remaining: number;
  evolution_events: EvolutionEvent[];
  /**
   * Impossible lineups surfaced by the EPB evolution rebuild
   * (`repairSeasonEvolution`). Present only for evolution_point_buy seasons;
   * legacy seasons leave this undefined.
   */
  impossibleLineups?: ImpossibleLineup[];
  /**
   * Itemized recalculation summary (spec §24): the single game deleted plus the
   * EPB evolution rebuild detail (when applicable). Richer than the legacy
   * top-level fields; both are returned together for backward compatibility.
   */
  recalculation?: MatchRecalculationSummary;
}

export interface ResetMatchResult {
  games_deleted: number;
  has_downstream_matches: boolean;
  evolution_events: EvolutionEvent[];
  /**
   * Per-type summary of the match-derived children cleaned by
   * `cleanMatchChildren` (prep teams, proposals, moments, animation views,
   * cleared pointers, social image). Present on every reset.
   */
  childrenCleanup?: MatchChildrenCleanup;
  /**
   * Impossible lineups surfaced by the EPB evolution rebuild
   * (`repairSeasonEvolution`). Present only for evolution_point_buy seasons;
   * legacy seasons leave this undefined.
   */
  impossibleLineups?: ImpossibleLineup[];
  /**
   * Itemized recalculation summary (spec §24): games deleted, children cleaned,
   * ratings rebuilt, and (for EPB) evolution rebuild detail + impossible
   * lineups. Richer than the legacy top-level fields; both are returned
   * together for backward compatibility.
   */
  recalculation?: MatchRecalculationSummary;
}

export interface ResetRoundResult {
  matches_reset: number;
  total_games_deleted: number;
  evolution_events: EvolutionEvent[];
}

export interface EditGameInput {
  game_id: string;
  winner_id?: string;
  battle_stats?: EditBattleStatInput[];
  admin_id: string;
}

export interface EditBattleStatInput {
  player_id: string;
  pokemon_name: string;
  was_brought?: boolean;
  was_lead?: boolean;
  kos_dealt?: number;
  was_koed?: boolean;
  moves_used?: string[];
  turns_active?: number;
}

export interface EditGameResult {
  match_status: string;
  match_winner_id: string | null;
  evolution_events: EvolutionEvent[];
}

// ─── Match Analysis (AI) ────────────────────────────────────────────

export type MatchAnalysisStatus = 'pending' | 'completed' | 'failed';

export interface MatchAnalysis {
  id: string;
  match_id: string;
  model_id: string;
  analysis: MatchAnalysisContent;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  generation_time_ms: number | null;
  status: MatchAnalysisStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface MatchAnalysisContent {
  /** 2-3 sentence match overview */
  summary: string;
  /** Key moment that decided the match */
  turning_point: string;
  /** Most valuable Pokémon of the match */
  mvp: {
    pokemon: string;
    player: string;
    reasoning: string;
  };
  /** Per-game breakdowns */
  game_breakdowns: {
    game_number: number;
    winner: string;
    narrative: string;
    key_plays: string[];
  }[];
  /** How picks compared to format meta */
  meta_observations: string;
  /** Counterfactual: what one player could have done differently */
  what_if: string;
  /**
   * How a per-player league type constraint (gym leader typing OR assigned
   * Core Liga triple) shaped team composition and strategy. Only present when
   * the league imposes such a constraint.
   */
  league_constraint_analysis?: string;
  /**
   * @deprecated Superseded by {@link league_constraint_analysis}. Retained so
   * historical analyses stored before the rename still render. New analyses
   * populate `league_constraint_analysis` instead.
   */
  gym_type_analysis?: string;
}

// ─── Match Prep Analysis (AI Scouting) ──────────────────────────────

export type MatchPrepAnalysisStatus = 'pending' | 'completed' | 'failed';

export interface MatchPrepAnalysis {
  id: string;
  match_id: string;
  player_id: string;
  model_id: string;
  analysis: MatchPrepAnalysisContent;
  has_user_team: boolean;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  generation_time_ms: number | null;
  status: MatchPrepAnalysisStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface MatchPrepAnalysisContent {
  /** 2-3 sentence overview of opponent's general style and approach */
  opponent_profile: string;
  /** Opponent's most-used Pokémon with usage context */
  signature_pokemon: { pokemon: string; usage_note: string }[];
  /** Observable patterns from opponent's battle history */
  tendencies: {
    lead_patterns: string;
    play_style: string;
    favorite_moves: string;
  };
  /** How opponent's picks compare to the tournament meta */
  meta_positioning: string;
  /** Type matchup analysis — only present when both teams are known */
  matchup_analysis?: {
    your_advantages: string;
    their_advantages: string;
    neutral_ground: string;
  };
  /** Suggested Pokémon picks with sets — only present when no user team is provided */
  suggested_picks?: {
    pokemon: string;
    role: string;
    set_summary: string;
    reasoning: string;
  }[];
  /** Concrete strategic recommendations */
  recommendations: {
    threats_to_watch: string[];
    suggested_leads: string;
    coverage_gaps: string;
    key_advice: string;
  };
}

// ─── Stats Display Types ─────────────────────────────────────────────

// ─── Pokemon Detail Page Types ──────────────────────────────────────

export interface PokemonDetailStats {
  pokemon_name: string;
  total_appearances: number;
  total_games_in_scope: number;
  usage_percent: number;
  kos_dealt: number;
  koed_rate: number;
  bring_rate: number | null;
  lead_rate: number | null;
  win_rate: number | null;
  moves: { name: string; count: number; usage_percent: number }[];
  items: { name: string; count: number; usage_percent: number }[];
  players: PokemonPlayerRow[];
}

export interface PokemonPlayerRow {
  player_id: string;
  /** Null when the player's name cannot be resolved; the UI shows a localized "unknown player". */
  player_name: string | null;
  games: number;
  kos_dealt: number;
  koed_rate: number;
  bring_rate: number | null;
  lead_rate: number | null;
  win_rate: number | null;
}

export interface PokemonSpeciesInfo {
  name: string;
  types: string[];
  baseStats: {
    hp: number;
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  };
  abilities: string[];
}

export interface PokemonFilterOptions {
  leagues: { id: string; name: string }[];
  tournaments: { id: string; name: string }[];
  players: { id: string; name: string }[];
}

export interface PokemonUsageRow {
  pokemon_name: string;
  usage_percent: number;
  total_appearances: number;
  total_games: number;
  kos_dealt: number;
  koed_rate: number;
  /** Average KOs scored per game where the Pokémon was sent out (total_kos_dealt / total_brought). Null when brought data is unavailable (e.g. global meta fallback). */
  efficiency: number | null;
  /** Doubles-only fields */
  bring_rate: number | null;
  lead_rate: number | null;
  win_rate: number | null;
}

export interface StandingsRow {
  player_id: string;
  player_name: string;
  player_avatar_url: string | null;
  gym_type?: string | null;
  wins: number;
  losses: number;
  game_wins: number;
  game_losses: number;
}

export interface MoveUsageRow {
  move_name: string;
  count: number;
  pokemon_name: string;
  /** Move's Pokémon type (e.g. "Water"). Null when the move cannot be resolved via `@pkmn/data`. */
  move_type: string | null;
  /** Damage category. Null when the move cannot be resolved via `@pkmn/data`. */
  move_category: 'Physical' | 'Special' | 'Status' | null;
}

export interface MovePokemonTotals {
  pokemon_name: string;
  total_brought: number;
  total_appearances: number;
}

export interface MoveUsageResponse {
  rows: MoveUsageRow[];
  pokemonTotals: MovePokemonTotals[];
}

export interface KillRankingRow {
  pokemon_name: string;
  kos_dealt: number;
  times_koed: number;
  kill_differential: number;
  participations: number;
  times_in_team: number;
  efficiency: number;
}
