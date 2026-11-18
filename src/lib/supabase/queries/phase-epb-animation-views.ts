import 'server-only';
import { supabase } from '../client';

export async function hasViewedPhaseEpbReplay(playerId: string, matchId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('phase_epb_animation_views')
    .select('id')
    .eq('player_id', playerId)
    .eq('match_id', matchId)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

export async function markPhaseEpbReplayViewed(playerId: string, matchId: string): Promise<void> {
  const { error } = await supabase.from('phase_epb_animation_views')
    .upsert({ player_id: playerId, match_id: matchId }, { onConflict: 'player_id,match_id', ignoreDuplicates: true });
  if (error) throw error;
}
