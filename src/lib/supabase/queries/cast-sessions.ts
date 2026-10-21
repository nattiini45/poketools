import { supabase } from '../client';
import type { Json } from '@/types/database';
import type {
  CastSession,
  CastSessionInsert,
  CastSessionUpdate,
} from '@/types/cast-session';
import type { PokemonSet } from '@/types/team';
import type { BroadcastPresetConfig } from '@/types/broadcast';

/**
 * Name stored for a session created without one. It is data and stays
 * English; screens compare against it and render the localized
 * `sessions.untitled` instead (SessionManager mirrors this literal because it
 * is a client component and cannot import this server query module).
 */
export const UNTITLED_CAST_SESSION_NAME = 'Untitled Session';

// ─── Row → domain mapper ───────────────────────────────────────────

interface CastSessionRow {
  id: string;
  owner_id: string;
  realtime_key: string;
  match_id: string | null;
  tournament_id: string | null;
  season_id: string | null;
  name: string;
  mode: string;
  status: string;
  player1_id: string | null;
  player1_name: string | null;
  player1_avatar_url: string | null;
  player2_id: string | null;
  player2_name: string | null;
  player2_avatar_url: string | null;
  player1_team: Json;
  player2_team: Json;
  tracker_state: Json | null;
  overlay_config: Json;
  caster_notes: Json;
  format: string;
  generation: number;
  created_at: string;
  updated_at: string;
}

function toCastSession(row: CastSessionRow): CastSession {
  return {
    id: row.id,
    owner_id: row.owner_id,
    realtime_key: row.realtime_key,
    match_id: row.match_id,
    tournament_id: row.tournament_id,
    season_id: row.season_id,
    name: row.name,
    mode: row.mode as CastSession['mode'],
    status: row.status as CastSession['status'],
    player1_id: row.player1_id,
    player1_name: row.player1_name,
    player1_avatar_url: row.player1_avatar_url,
    player2_id: row.player2_id,
    player2_name: row.player2_name,
    player2_avatar_url: row.player2_avatar_url,
    player1_team: row.player1_team as unknown as PokemonSet[],
    player2_team: row.player2_team as unknown as PokemonSet[],
    tracker_state: row.tracker_state as Record<string, unknown> | null,
    overlay_config: row.overlay_config as unknown as Partial<BroadcastPresetConfig>,
    caster_notes: (row.caster_notes as Record<string, string>) ?? {},
    format: row.format,
    generation: row.generation,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Queries ───────────────────────────────────────────────────────

/** List all sessions for a creator, newest first. */
export async function listCastSessions(ownerId: string): Promise<CastSession[]> {
  const { data, error } = await supabase
    .from('cast_sessions')
    .select('*')
    .eq('owner_id', ownerId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data as unknown as CastSessionRow[]).map(toCastSession);
}

/** Get a single session by ID. */
export async function getCastSessionById(id: string): Promise<CastSession | null> {
  const { data, error } = await supabase
    .from('cast_sessions')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    throw error;
  }
  return toCastSession(data as unknown as CastSessionRow);
}

/** Create a new cast session. Returns the created session. */
export async function createCastSession(
  ownerId: string,
  input: CastSessionInsert
): Promise<CastSession> {
  const { data, error } = await supabase
    .from('cast_sessions')
    .insert({
      owner_id: ownerId,
      // Stored sentinel (data, stays English); screens map it to the localized
      // `sessions.untitled` at render time.
      name: input.name ?? UNTITLED_CAST_SESSION_NAME,
      mode: input.mode ?? 'cast',
      match_id: input.match_id ?? null,
      tournament_id: input.tournament_id ?? null,
      season_id: input.season_id ?? null,
      player1_id: input.player1_id ?? null,
      player1_name: input.player1_name ?? null,
      player1_avatar_url: input.player1_avatar_url ?? null,
      player2_id: input.player2_id ?? null,
      player2_name: input.player2_name ?? null,
      player2_avatar_url: input.player2_avatar_url ?? null,
      format: input.format ?? 'gen9ou',
      generation: input.generation ?? 9,
    })
    .select()
    .single();

  if (error) throw error;
  return toCastSession(data as unknown as CastSessionRow);
}

/** Update a cast session (partial update). */
export async function updateCastSession(
  id: string,
  update: CastSessionUpdate
): Promise<CastSession> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };

  // Only include fields that are explicitly provided
  if (update.name !== undefined) payload.name = update.name;
  if (update.mode !== undefined) payload.mode = update.mode;
  if (update.status !== undefined) payload.status = update.status;
  if (update.match_id !== undefined) payload.match_id = update.match_id;
  if (update.tournament_id !== undefined) payload.tournament_id = update.tournament_id;
  if (update.season_id !== undefined) payload.season_id = update.season_id;
  if (update.player1_id !== undefined) payload.player1_id = update.player1_id;
  if (update.player1_name !== undefined) payload.player1_name = update.player1_name;
  if (update.player1_avatar_url !== undefined) payload.player1_avatar_url = update.player1_avatar_url;
  if (update.player2_id !== undefined) payload.player2_id = update.player2_id;
  if (update.player2_name !== undefined) payload.player2_name = update.player2_name;
  if (update.player2_avatar_url !== undefined) payload.player2_avatar_url = update.player2_avatar_url;
  if (update.player1_team !== undefined) payload.player1_team = update.player1_team;
  if (update.player2_team !== undefined) payload.player2_team = update.player2_team;
  if (update.tracker_state !== undefined) payload.tracker_state = update.tracker_state;
  if (update.overlay_config !== undefined) payload.overlay_config = update.overlay_config;
  if (update.caster_notes !== undefined) payload.caster_notes = update.caster_notes;
  if (update.format !== undefined) payload.format = update.format;
  if (update.generation !== undefined) payload.generation = update.generation;

  const { data, error } = await supabase
    .from('cast_sessions')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toCastSession(data as unknown as CastSessionRow);
}

/** Delete a cast session. */
export async function deleteCastSession(id: string): Promise<void> {
  const { error } = await supabase
    .from('cast_sessions')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/**
 * Null the `match_id` pointer on every cast session linked to a match
 * (match-scoped), WITHOUT deleting the session rows. A cast session is a
 * reusable studio entity owned by a caster, so on match undo only the stale
 * pointer is cleared — mirroring the hard-delete FK `ON DELETE SET NULL`
 * behavior. Returns the count of rows whose pointer was cleared so the
 * cleanup can surface it in its summary.
 */
export async function clearCastSessionsMatchPointer(matchId: string): Promise<number> {
  const { count, error } = await supabase
    .from('cast_sessions')
    .update({ match_id: null }, { count: 'exact' })
    .eq('match_id', matchId);

  if (error) throw error;
  return count ?? 0;
}
