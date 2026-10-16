import type { PokemonSet } from './team';
import type { BroadcastPresetConfig } from './broadcast';
import type { GameSummary } from './match';

// ─── Caster Notes ──────────────────────────────────────────────────
export interface CasterNotes {
  player1?: string;
  player2?: string;
  match?: string;
}

// ─── Cast Session Mode ─────────────────────────────────────────────
export type CastSessionMode = 'cast' | 'solo' | 'replaycast';
export type CastSessionStatus = 'draft' | 'live' | 'archived';

// ─── Cast Session (database row shape) ─────────────────────────────
export interface CastSession {
  id: string;
  owner_id: string;
  realtime_key: string;
  match_id: string | null;
  tournament_id: string | null;
  season_id: string | null;
  name: string;
  mode: CastSessionMode;
  status: CastSessionStatus;
  player1_id: string | null;
  player1_name: string | null;
  player1_avatar_url: string | null;
  player2_id: string | null;
  player2_name: string | null;
  player2_avatar_url: string | null;
  player1_team: PokemonSet[];
  player2_team: PokemonSet[];
  tracker_state: Record<string, unknown> | null;
  overlay_config: Partial<BroadcastPresetConfig>;
  caster_notes: CasterNotes;
  format: string;
  generation: number;
  created_at: string;
  updated_at: string;
}

// ─── Insert / Update shapes ────────────────────────────────────────
export interface CastSessionInsert {
  name?: string;
  mode?: CastSessionMode;
  match_id?: string | null;
  tournament_id?: string | null;
  season_id?: string | null;
  player1_id?: string | null;
  player1_name?: string | null;
  player1_avatar_url?: string | null;
  player2_id?: string | null;
  player2_name?: string | null;
  player2_avatar_url?: string | null;
  format?: string;
  generation?: number;
}

export interface CastSessionUpdate {
  name?: string;
  mode?: CastSessionMode;
  status?: CastSessionStatus;
  match_id?: string | null;
  tournament_id?: string | null;
  season_id?: string | null;
  player1_id?: string | null;
  player1_name?: string | null;
  player1_avatar_url?: string | null;
  player2_id?: string | null;
  player2_name?: string | null;
  player2_avatar_url?: string | null;
  player1_team?: PokemonSet[];
  player2_team?: PokemonSet[];
  tracker_state?: Record<string, unknown> | null;
  overlay_config?: Partial<BroadcastPresetConfig>;
  caster_notes?: CasterNotes;
  format?: string;
  generation?: number;
}

export type CastSessionRealtimeAction =
  | { type: 'set_session_name'; name: string }
  | { type: 'set_mode'; mode: CastSessionMode }
  | { type: 'set_match'; matchId: string; tournamentId: string | null; seasonId: string | null }
  | { type: 'set_format'; format: string; generation: number }
  | { type: 'new_opponent' }
  | { type: 'toggle_show_facing' }
  | { type: 'populate_match'; data: CastSessionPopulateResult };

// ─── Populate response (returned by /api/cast-sessions/[id]/populate)
export interface CastSessionPopulateResult {
  match: {
    id: string;
    tournament_id: string | null;
    season_id: string | null;
    round_name: string | null;
    best_of: number;
    status: string;
  };
  player1: {
    id: string;
    name: string;
    avatar_url: string | null;
  };
  player2: {
    id: string;
    name: string;
    avatar_url: string | null;
  };
  player1_team: PokemonSet[];
  player2_team: PokemonSet[];
  games: GameSummary[];
  games_played: number;
  format: string | null;
  generation: number | null;
}
