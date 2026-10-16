import type { GameSummary } from './match';
import type { SignaturePokemon } from './signature';
import type { PlayerStreaks } from './streak';
import type { EarnedAchievement } from './achievement';
import type { MatchAnalysis } from './game';
import type { Locale } from '@/i18n/config';

// ─── Broadcast Moment Types ─────────────────────────────────────────

export type BroadcastMomentType =
  | 'turning_point'
  | 'big_ko'
  | 'misplay'
  | 'clutch'
  | 'highlight';

export interface BroadcastMoment {
  id: string;
  game_id: string | null;
  match_id: string;
  turn_number: number | null;
  moment_type: BroadcastMomentType;
  description: string | null;
  pokemon_name: string | null;
  timestamp: string;
  created_by: string;
}

export interface BroadcastMomentInsert {
  game_id?: string | null;
  match_id: string;
  turn_number?: number | null;
  moment_type: BroadcastMomentType;
  description?: string | null;
  pokemon_name?: string | null;
  timestamp?: string;
  created_by: string;
}

// ─── Broadcast Preset Types ─────────────────────────────────────────

export type BroadcastPresetType =
  | 'match_preview'
  | 'match_results'
  | 'standings'
  | 'attract'
  | 'draft'
  | 'recap'
  | 'match_story'
  | 'team_comparison'
  | 'h2h_history'
  | 'moment_reel'
  | 'usage_chart';

export interface BroadcastPreset {
  id: string;
  name: string;
  owner_id: string;
  preset_type: BroadcastPresetType;
  config: BroadcastPresetConfig;
  created_at: string;
  updated_at: string;
}

export interface BroadcastPresetInsert {
  name: string;
  owner_id: string;
  preset_type: BroadcastPresetType;
  config: BroadcastPresetConfig;
}

export interface BroadcastPresetConfig {
  theme?: OverlayTheme;
  accent?: string;
  accent2?: string;
  anim?: AnimationIntensity;
  poll?: number;
  w?: number;
  h?: number;
  brand?: string;
  brandpos?: BrandPosition;
  /** Type-specific extra config (showH2H, layout, etc.) */
  extra?: Record<string, unknown>;
}

// ─── Draft Replay Event Types ───────────────────────────────────────

export type DraftReplayEventType =
  | 'pick'
  | 'skip'
  | 'trade'
  | 'pause'
  | 'commentary'
  | 'timer_expire';

export interface DraftReplayEvent {
  id: string;
  draft_pool_id: string;
  pick_id: string | null;
  event_type: DraftReplayEventType;
  event_data: DraftReplayEventData;
  sequence_number: number;
  wall_clock_time: string;
  display_duration_ms: number;
}

export interface DraftReplayEventInsert {
  draft_pool_id: string;
  pick_id?: string | null;
  event_type: DraftReplayEventType;
  event_data: DraftReplayEventData;
  sequence_number: number;
  wall_clock_time?: string;
  display_duration_ms?: number;
}

export type DraftReplayEventData =
  | DraftReplayPickData
  | DraftReplayCommentaryData
  | DraftReplayPauseData
  | DraftReplaySkipData
  | DraftReplayTradeData
  | DraftReplayTimerExpireData;

export interface DraftReplayPickData {
  player_id: string;
  player_name: string;
  pokemon_name: string;
  power_tier: string | null;
  points_spent: number | null;
  round: number;
  pick_number: number;
  remaining_budget: number | null;
  tier_usage_after: Record<string, { used: number; max: number }> | null;
  evolution_chain: string[] | null;
}

export interface DraftReplayCommentaryData {
  text: string;
  author: string;
}

export interface DraftReplayPauseData {
  reason: string;
  original_duration_hours: number | null;
}

export interface DraftReplaySkipData {
  player_id: string;
  player_name: string;
  reason: string;
}

export interface DraftReplayTradeData {
  from_player_id: string;
  to_player_id: string;
  pokemon_name: string;
}

export interface DraftReplayTimerExpireData {
  player_id: string;
  player_name: string;
}

// ─── Overlay Config Types ───────────────────────────────────────────

export type OverlayTheme = 'dark' | 'light' | 'custom';
export type AnimationIntensity = 'none' | 'subtle' | 'smooth' | 'dramatic';
export type BrandPosition = 'tl' | 'tr' | 'bl' | 'br';

export interface OverlayConfig {
  theme: OverlayTheme;
  accent: string;
  accent2: string;
  anim: AnimationIntensity;
  poll: number;
  w: number;
  h: number;
  brand: string;
  brandpos: BrandPosition;
  preset: string | null;
  /** Overlay language from `?lang=` (i18n-core §6.5); null = follow the league language. */
  lang: Locale | null;
}

// ─── Tracker State Types ────────────────────────────────────────────

export interface TrackerState {
  match_id: string;
  games_submitted: GameSummary[];
  current_game: {
    game_number: number;
    turn: number;
    player1: TrackerPlayerState;
    player2: TrackerPlayerState;
    moments: BroadcastMomentInsert[];
  };
  history: TrackerAction[];
}

export interface TrackerPlayerState {
  player_id: string;
  player_name: string;
  avatar_url: string | null;
  slots: TrackerSlot[];
}

export interface TrackerSlot {
  pokemon_name: string | null;
  was_brought: boolean;
  was_lead: boolean;
  was_koed: boolean;
  kos_dealt: number;
  moves_used: string[];
  turns_active: number;
}

export type TrackerAction =
  | { type: 'mark_brought'; player: 1 | 2; slot: number }
  | { type: 'unmark_brought'; player: 1 | 2; slot: number }
  | { type: 'mark_lead'; player: 1 | 2; slot: number }
  | { type: 'unmark_lead'; player: 1 | 2; slot: number }
  | { type: 'mark_ko'; player: 1 | 2; slot: number }
  | { type: 'unmark_ko'; player: 1 | 2; slot: number }
  | { type: 'increment_ko_dealt'; player: 1 | 2; slot: number }
  | { type: 'decrement_ko_dealt'; player: 1 | 2; slot: number }
  | { type: 'log_move'; player: 1 | 2; slot: number; move: string }
  | { type: 'remove_move'; player: 1 | 2; slot: number; move: string }
  | { type: 'set_pokemon'; player: 1 | 2; slot: number; pokemon: string }
  | { type: 'clear_pokemon'; player: 1 | 2; slot: number; pokemon: string }
  | { type: 'increment_turn' }
  | { type: 'decrement_turn' }
  | { type: 'mark_moment'; moment: BroadcastMomentInsert }
  // ── Cast Studio extensions (Phase 9) ──
  | { type: 'set_team'; player: 1 | 2; team: import('./team').PokemonSet[] }
  | { type: 'update_set'; player: 1 | 2; slot: number; set: Partial<import('./team').PokemonSet> }
  | { type: 'swap_slots'; player: 1 | 2; from: number; to: number }
  | { type: 'set_facing'; player1Slot: number | null; player2Slot: number | null };

export interface PublicSoloBroadcastSlot {
  pokemon_name: string | null;
  was_brought: boolean;
  was_koed: boolean;
  kos_dealt: number;
}

export interface PublicSoloBroadcastPlayerState {
  player_id: string;
  player_name: string;
  slots: PublicSoloBroadcastSlot[];
}

export interface PublicSoloBroadcastState {
  session_id: string;
  player1_id: string;
  player1_name: string | null;
  player2_name: string | null;
  player1_team: Array<{ species: string }>;
  player2_team: Array<{ species: string }>;
  current_game: {
    game_number: number;
    player1: PublicSoloBroadcastPlayerState;
    player2: PublicSoloBroadcastPlayerState;
  };
  games_submitted: Array<Pick<GameSummary, 'game_number' | 'winner_id'>>;
  wins: number;
  losses: number;
  updated_at: string;
}

// ─── API Response Types ─────────────────────────────────────────────

/** Response shape for GET /api/broadcast/state/[mid] */
export interface LiveMatchState {
  match_id: string;
  series_score: { player1: number; player2: number };
  player1: { id: string; name: string; avatar_url: string | null };
  player2: { id: string; name: string; avatar_url: string | null };
  current_game: {
    game_number: number;
    player1_kos: number;
    player2_kos: number;
    player1_pokemon: LivePokemonState[];
    player2_pokemon: LivePokemonState[];
  } | null;
  recent_moments: BroadcastMoment[];
  match_status: string;
  winner_id: string | null;
}

export interface LivePokemonState {
  pokemon_name: string;
  was_brought: boolean;
  was_lead: boolean;
  was_koed: boolean;
  kos_dealt: number;
}

/** Response shape for GET /api/broadcast/h2h */
export interface H2HRecord {
  player1_id: string;
  player2_id: string;
  player1_wins: number;
  player2_wins: number;
  total_matches: number;
}

/** Response shape for GET /api/broadcast/match-stats/[mid] */
export interface MatchBroadcastStats {
  match_id: string;
  games_played: number;
  pokemon_stats: MatchPokemonStat[];
}

export interface MatchPokemonStat {
  player_id: string;
  pokemon_name: string;
  total_kos: number;
  total_deaths: number;
  appearances: number;
  was_lead_count: number;
}

/** Response shape for GET /api/broadcast/leaders/[sid] */
export interface SeasonLeaders {
  season_id: string;
  most_kos: { player_id: string; player_name: string; pokemon_name: string; kos: number } | null;
  best_record: { player_id: string; player_name: string; wins: number; losses: number } | null;
  pokemon_mvp: { pokemon_name: string; appearances: number; win_rate: number } | null;
}

/** Response shape for GET /api/broadcast/recap/[sid] */
export interface WeeklyRecap {
  league_name: string;
  tournament_name?: string;
  round_name?: string;
  round_number?: number;
  /** @deprecated Use round-based params instead. Kept for backward compat. */
  week_number?: number;
  date_range?: { start: string; end: string };

  headline_result: {
    match: RecapMatchSummary;
    why: string;
  } | null;

  results: RecapMatchSummary[];

  standings_movement: {
    risers: { player_name: string; old_rank: number; new_rank: number }[];
    fallers: { player_name: string; old_rank: number; new_rank: number }[];
  };

  stat_leaders: SeasonLeaders;

  evolution_updates?: {
    new_evolutions: { player_name: string; from: string; to: string }[];
  };

  moments: BroadcastMoment[];

  narrative?: string;
}

export interface RecapMatchSummary {
  match_id: string;
  player1_name: string;
  player2_name: string;
  winner_name: string;
  score: string;
}

// ─── Enriched Broadcast Types ──────────────────────────────────────
// Used by overlays when fetching with ?enrich=true for rich data display.

/** Player info enriched with rating, record, signatures, streaks, achievements */
export interface EnrichedPlayerInfo {
  id: string;
  name: string;
  avatar_url: string | null;
  record: { wins: number; losses: number; draws: number };
  rating: { rating: number; rd: number; peak: number } | null;
  rank: number | null;
  signatures: SignaturePokemon[];
  streaks: PlayerStreaks | null;
  achievements: EarnedAchievement[];
}

/** Pokemon state enriched with types, sprites, stats, and metadata */
export interface EnrichedPokemonState extends LivePokemonState {
  types: string[];
  sprite_url: string;
  moves_used: string[];
  turns_active: number;
  is_mvp: boolean;
  item: string | null;
  ability: string | null;
}

/** Per-game breakdown for Match Story and MatchResults overlays */
export interface GameBreakdown {
  game_number: number;
  winner_id: string | null;
  player1_pokemon: EnrichedPokemonState[];
  player2_pokemon: EnrichedPokemonState[];
  player1_kos: number;
  player2_kos: number;
  player1_alive: number;
  player2_alive: number;
  moments: BroadcastMoment[];
  replay_url: string | null;
}

/**
 * Enriched match state returned by GET /api/broadcast/state/[mid]?enrich=true.
 * Extends LiveMatchState with full player profiles, team data, and analytics.
 */
export interface EnrichedMatchState extends LiveMatchState {
  enriched_player1: EnrichedPlayerInfo;
  enriched_player2: EnrichedPlayerInfo;
  pokemon_score: { p1: number; p2: number };
  per_game_breakdown: GameBreakdown[];
  tournament_name: string;
  round_name: string;
  season_name: string;
  format_name: string;
  h2h: H2HRecord | null;
  /**
   * Past meetings, newest first. `draw` marks a drawn series; `winner_name`
   * then stays the English 'Draw' for older overlays.
   */
  h2h_matches?: Array<{ match_id: string; date: string; winner_name: string; score: string; draw?: boolean }>;
  match_analysis: MatchAnalysis | null;
}

/** Enriched match summary for recaps — replaces skeletal RecapMatchSummary */
export interface EnrichedRecapMatch {
  match_id: string;
  player1_id: string;
  player2_id: string;
  player1_name: string;
  player2_name: string;
  player1_avatar_url: string | null;
  player2_avatar_url: string | null;
  winner_name: string;
  winner_id: string | null;
  pokemon_score: string;
  series_score: string;
  player1_team: EnrichedPokemonState[];
  player2_team: EnrichedPokemonState[];
  mvp: { pokemon_name: string; kos: number; player_name: string } | null;
  moments: BroadcastMoment[];
}

/** Enriched weekly recap with full match data, real leaders, standings diffs */
export interface EnrichedRecap extends Omit<WeeklyRecap, 'results' | 'headline_result'> {
  headline_result: {
    match: EnrichedRecapMatch;
    why: string;
  } | null;
  results: EnrichedRecapMatch[];
  pokemon_usage: PokemonUsageStat[];
  format_name: string;
}

/** Pokemon usage stat for usage chart overlay and recap leaders */
export interface PokemonUsageStat {
  pokemon_name: string;
  sprite_url: string;
  types: string[];
  games: number;
  wins: number;
  win_rate: number;
  total_kos: number;
}

/** Match preview data from GET /api/broadcast/preview/[mid] */
export interface MatchPreviewData {
  match_id: string;
  player1: EnrichedPlayerInfo;
  player2: EnrichedPlayerInfo;
  player1_team: EnrichedPokemonState[];
  player2_team: EnrichedPokemonState[];
  h2h: H2HRecord | null;
  tournament_name: string;
  round_name: string;
  season_name: string;
  format_name: string;
  best_of: number;
}
