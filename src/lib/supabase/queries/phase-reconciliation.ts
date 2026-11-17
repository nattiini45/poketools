import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';

export async function getPhaseSeasonKosForLine(
  seasonId: string,
  playerId: string,
  formNames: string[]
): Promise<number> {
  if (formNames.length === 0) return 0;
  const rows = await readAllPages((from, to) => supabase
    .from('phase_battle_stats')
    .select('id, kos_dealt, phase_games!inner(phase_matches!inner(league_phases!inner(season_id)))')
    .eq('phase_games.phase_matches.league_phases.season_id', seasonId)
    .eq('player_id', playerId)
    .in('pokemon_name', formNames)
    .order('id')
    .range(from, to));
  return rows.reduce((total, row) => total + row.kos_dealt, 0);
}

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
