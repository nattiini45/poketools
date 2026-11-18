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
