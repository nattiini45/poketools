import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';

export async function listPhaseSeasonCompletedMatchPlayerIds(seasonId: string): Promise<string[]> {
  const rows = await readAllPages((from, to) => supabase
    .from('phase_matches')
    .select('id, player_1_id, player_2_id, league_phases!inner(season_id)')
    .eq('league_phases.season_id', seasonId)
    .eq('status', 'completed')
    .order('id')
    .range(from, to));
  return [...new Set(rows.flatMap((row) => [row.player_1_id, row.player_2_id]))];
}
