import { supabase } from '../client';
import type { Tables } from '@/types/database';
import type { BroadcastMoment, BroadcastMomentInsert } from '@/types/broadcast';

type BroadcastMomentRow = Tables<'broadcast_moments'>;

function toBroadcastMoment(row: BroadcastMomentRow): BroadcastMoment {
  return {
    id: row.id,
    game_id: row.game_id,
    match_id: row.match_id,
    turn_number: row.turn_number,
    moment_type: row.moment_type as BroadcastMoment['moment_type'],
    description: row.description,
    pokemon_name: row.pokemon_name,
    timestamp: row.timestamp,
    created_by: row.created_by,
  };
}

// ─── Read ───────────────────────────────────────────────────────────

export async function getMomentsByMatch(matchId: string): Promise<BroadcastMoment[]> {
  const { data, error } = await supabase
    .from('broadcast_moments')
    .select('*')
    .eq('match_id', matchId)
    .order('timestamp', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(toBroadcastMoment);
}

export async function getMomentsByGame(gameId: string): Promise<BroadcastMoment[]> {
  const { data, error } = await supabase
    .from('broadcast_moments')
    .select('*')
    .eq('game_id', gameId)
    .order('timestamp', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(toBroadcastMoment);
}

export async function getRecentMomentsByMatch(
  matchId: string,
  limit: number = 5
): Promise<BroadcastMoment[]> {
  const { data, error } = await supabase
    .from('broadcast_moments')
    .select('*')
    .eq('match_id', matchId)
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(toBroadcastMoment);
}

// ─── Write ──────────────────────────────────────────────────────────

export async function createMoment(input: BroadcastMomentInsert): Promise<BroadcastMoment> {
  const { data, error } = await supabase
    .from('broadcast_moments')
    .insert({
      game_id: input.game_id ?? null,
      match_id: input.match_id,
      turn_number: input.turn_number ?? null,
      moment_type: input.moment_type,
      description: input.description ?? null,
      pokemon_name: input.pokemon_name ?? null,
      timestamp: input.timestamp ?? new Date().toISOString(),
      created_by: input.created_by,
    })
    .select()
    .single();

  if (error) throw error;
  return toBroadcastMoment(data);
}

export async function createMomentsBatch(
  inputs: BroadcastMomentInsert[]
): Promise<BroadcastMoment[]> {
  if (inputs.length === 0) return [];

  const rows = inputs.map((input) => ({
    game_id: input.game_id ?? null,
    match_id: input.match_id,
    turn_number: input.turn_number ?? null,
    moment_type: input.moment_type,
    description: input.description ?? null,
    pokemon_name: input.pokemon_name ?? null,
    timestamp: input.timestamp ?? new Date().toISOString(),
    created_by: input.created_by,
  }));

  const { data, error } = await supabase
    .from('broadcast_moments')
    .insert(rows)
    .select();

  if (error) throw error;
  return (data ?? []).map(toBroadcastMoment);
}

// ─── Delete ─────────────────────────────────────────────────────────

export async function deleteMoment(id: string): Promise<void> {
  const { error } = await supabase
    .from('broadcast_moments')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/**
 * Delete ALL broadcast moments for a match (match-scoped, including
 * match-scoped rows with a null game_id). The `match_id` FK is NO ACTION,
 * so neither a hard match delete nor the current reset cascades these —
 * they must be removed explicitly. Returns the count of rows deleted so
 * the cleanup can surface it in its summary.
 */
export async function deleteMomentsByMatch(matchId: string): Promise<number> {
  const { count, error } = await supabase
    .from('broadcast_moments')
    .delete({ count: 'exact' })
    .eq('match_id', matchId);

  if (error) throw error;
  return count ?? 0;
}
