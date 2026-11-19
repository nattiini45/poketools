import 'server-only';
import type { Tables, TablesInsert } from '@/types/database';
import type { BroadcastMoment, BroadcastMomentInsert } from '@/types/broadcast';
import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';

function phaseMomentsQuery(matchId: string, ascending: boolean) {
  return supabase.from('phase_broadcast_moments')
    .select('id, game_id, match_id, turn_number, moment_type, description, pokemon_name, timestamp, created_by')
    .eq('match_id', matchId)
    .order('timestamp', { ascending })
    .order('id');
}

function toBroadcastMoment(row: Tables<'phase_broadcast_moments'>): BroadcastMoment {
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

export async function getPhaseMomentsByMatch(matchId: string): Promise<BroadcastMoment[]> {
  const rows = await readAllPages((from, to) => phaseMomentsQuery(matchId, true).range(from, to));
  return rows.map(toBroadcastMoment);
}

export async function getRecentPhaseMomentsByMatch(matchId: string, limit = 5): Promise<BroadcastMoment[]> {
  const { data, error } = await phaseMomentsQuery(matchId, false).limit(limit);
  if (error) throw error;
  return (data ?? []).map(toBroadcastMoment);
}

export async function createPhaseMoment(input: Pick<BroadcastMomentInsert, 'match_id' | 'moment_type' | 'description' | 'created_by'>): Promise<BroadcastMoment> {
  const { data, error } = await supabase.from('phase_broadcast_moments').insert(input).select().single();
  if (error) throw error;
  return toBroadcastMoment(data);
}

export async function createPhaseMomentsBatch(
  rows: Array<TablesInsert<'phase_broadcast_moments'> & { game_id: string }>,
): Promise<void> {
  if (!rows.length) return;
  const { error } = await supabase.from('phase_broadcast_moments').insert(rows);
  if (error) throw error;
}
