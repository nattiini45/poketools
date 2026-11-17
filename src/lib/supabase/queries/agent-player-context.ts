import { supabase } from '../client';
import { postgrestQuoted } from '../postgrest-filter';
import { assertValidUuid } from '@/lib/utils/uuid';
import type { PokemonSet } from '@/types/team';

export async function getAgentPhasePrep(matchId: string, playerId: string): Promise<PokemonSet[] | null> {
  assertValidUuid(matchId);
  assertValidUuid(playerId);
  const { data, error } = await supabase.from('phase_match_prep_teams').select('pokemon')
    .eq('match_id', matchId).eq('player_id', playerId).maybeSingle();
  if (error) throw error;
  return data ? data.pokemon as unknown as PokemonSet[] : null;
}

export async function getAgentPhaseHistory(phaseId: string, playerId: string, opponentId?: string) {
  for (const id of [phaseId, playerId, ...(opponentId !== undefined ? [opponentId] : [])]) assertValidUuid(id);
  const player = postgrestQuoted(playerId);
  const opponent = opponentId !== undefined ? postgrestQuoted(opponentId) : null;
  const query = supabase.from('phase_matches')
    .select('id, phase_id, round_id, player_1_id, player_2_id, winner_id, date_played, round:phase_rounds!phase_matches_phase_round_fkey(phase_id)', { count: 'exact' })
    .eq('phase_id', phaseId).eq('status', 'completed')
    .or(opponent
      ? `and(player_1_id.eq.${player},player_2_id.eq.${opponent}),and(player_1_id.eq.${opponent},player_2_id.eq.${player})`
      : `player_1_id.eq.${player},player_2_id.eq.${player}`);
  const { data, error, count } = await query.order('date_played', { ascending: false, nullsFirst: false })
    .order('id').range(0, 19);
  if (error) throw error;
  if (!data || count === null) throw new Error('Native history unavailable');
  if (data.some(row => row.phase_id !== phaseId || row.round?.phase_id !== phaseId)) throw new Error('Native history ownership mismatch');
  return {
    matches: data.map(row => ({ id: row.id,
      round_id: row.round_id, opponent_id: row.player_1_id === playerId ? row.player_2_id : row.player_1_id,
      result: row.winner_id === null ? null : row.winner_id === playerId ? 'win' as const : 'loss' as const,
      date_played: row.date_played })),
    total: count, truncated: count > data.length,
  };
}
