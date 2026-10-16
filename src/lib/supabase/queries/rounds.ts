import { supabase } from '../client';
import type { Tables } from '@/types/database';
import type { Round, RoundStatus } from '@/types/round';

type RoundRow = Tables<'rounds'>;

function toRound(row: RoundRow): Round {
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    name: row.name,
    round_number: row.round_number,
    best_of: row.best_of,
    status: row.status as RoundStatus,
    pairings_generated: row.pairings_generated,
    deadline: row.deadline,
    bracket_side: (row.bracket_side as Round['bracket_side']) ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getRoundsByTournament(tournamentId: string): Promise<Round[]> {
  const { data, error } = await supabase
    .from('rounds')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('round_number');

  if (error) throw error;
  return data.map(toRound);
}

export async function getRoundById(id: string): Promise<Round | null> {
  const { data, error } = await supabase
    .from('rounds')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toRound(data) : null;
}

export async function createRound(input: {
  tournament_id: string;
  name: string;
  round_number: number;
  best_of: number;
  bracket_side?: string | null;
}): Promise<Round> {
  const { data, error } = await supabase
    .from('rounds')
    .insert({
      tournament_id: input.tournament_id,
      name: input.name,
      round_number: input.round_number,
      best_of: input.best_of,
      bracket_side: input.bracket_side ?? null,
      pairings_generated: true,
    })
    .select()
    .single();

  if (error) throw error;
  return toRound(data);
}

export async function updateRoundStatus(
  id: string,
  status: RoundStatus
): Promise<Round> {
  const { data, error } = await supabase
    .from('rounds')
    .update({ status })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toRound(data);
}

export async function updateRoundBestOf(
  id: string,
  bestOf: number
): Promise<Round> {
  const { data, error } = await supabase
    .from('rounds')
    .update({ best_of: bestOf })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toRound(data);
}

export async function deleteRound(id: string): Promise<void> {
  const { error } = await supabase
    .from('rounds')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
