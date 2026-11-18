import 'server-only';

import { assertValidUuid } from '@/lib/utils/uuid';
import type { CompetitionOwner } from '@/types/competition-owner';
import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';

export async function getPhaseScoutingMatch(
  matchId: string,
  owner: Extract<CompetitionOwner, { kind: 'phase' }>,
) {
  const { data, error } = await supabase.from('phase_matches')
    .select(`id, phase_id, player_1_id, player_2_id,
      player_1:players!phase_matches_player_1_id_fkey(name),
      player_2:players!phase_matches_player_2_id_fkey(name),
      phase:league_phases!phase_matches_phase_id_fkey!inner(season_id, ruleset_id)`)
    .eq('id', matchId)
    .eq('phase_id', owner.phase_id)
    .eq('phase.season_id', owner.season_id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.id !== matchId || data.phase_id !== owner.phase_id || data.phase?.season_id !== owner.season_id) return null;
  return {
    phase_id: data.phase_id,
    player_1_id: data.player_1_id,
    player_2_id: data.player_2_id,
    player_1_name: data.player_1.name,
    player_2_name: data.player_2.name,
    ruleset_id: data.phase.ruleset_id,
  };
}

export async function getOpponentBattleStatsInPhase(opponentId: string, phaseId: string) {
  assertValidUuid(opponentId, 'opponentId');
  assertValidUuid(phaseId, 'phaseId');
  const rows = await readAllPages((from, to) => supabase.from('phase_battle_stats')
    .select(`game_id, pokemon_name, was_brought, was_lead, kos_dealt, match_won, moves_used,
      phase_games!inner(phase_matches!inner(id))`)
    .eq('player_id', opponentId)
    .eq('phase_games.phase_matches.phase_id', phaseId)
    .eq('phase_games.phase_matches.status', 'completed')
    .or(`player_1_id.eq.${opponentId},player_2_id.eq.${opponentId}`, { referencedTable: 'phase_games.phase_matches' })
    .order('id').range(from, to));

  return rows.map(row => ({
    game_id: row.game_id,
    pokemon_name: row.pokemon_name,
    was_brought: row.was_brought,
    was_lead: row.was_lead,
    kos_dealt: row.kos_dealt,
    match_won: row.match_won,
    moves_used: Array.isArray(row.moves_used) ? row.moves_used.filter(move => typeof move === 'string') : [],
  }));
}
