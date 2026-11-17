import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';
import type { Tables } from '@/types/database';

export type PhaseAdmin = Tables<'phase_admins'>;

export async function hasPhaseAdminRole(playerId: string): Promise<boolean> {
  const { count, error } = await supabase.from('phase_admins')
    .select('id', { count: 'exact', head: true }).eq('player_id', playerId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function isPhaseAdminFor(playerId: string, phaseId: string): Promise<boolean> {
  const { data: phase, error: phaseError } = await supabase.from('league_phases')
    .select('season_id').eq('id', phaseId).maybeSingle();
  if (phaseError) throw phaseError;
  if (!phase) return false;

  const { count, error } = await supabase.from('phase_admins')
    .select('id', { count: 'exact', head: true }).eq('player_id', playerId).eq('phase_id', phaseId);
  if (error) throw error;
  if ((count ?? 0) > 0) return true;

  const { count: seasonCount, error: seasonError } = await supabase.from('resource_admins')
    .select('id', { count: 'exact', head: true }).eq('player_id', playerId)
    .eq('resource_type', 'season').eq('resource_id', phase.season_id);
  if (seasonError) throw seasonError;
  return (seasonCount ?? 0) > 0;
}

export async function getPhaseAdmins(phaseId: string): Promise<PhaseAdmin[]> {
  return readAllPages((from, to) => supabase.from('phase_admins')
    .select('id,player_id,phase_id,created_at').eq('phase_id', phaseId).order('id').range(from, to));
}

export async function addPhaseAdmin(playerId: string, phaseId: string): Promise<PhaseAdmin> {
  const { data, error } = await supabase.from('phase_admins')
    .insert({ player_id: playerId, phase_id: phaseId })
    .select('id,player_id,phase_id,created_at').single();
  if (error) throw error;
  return data;
}

export async function removePhaseAdmin(playerId: string, phaseId: string): Promise<void> {
  const { error } = await supabase.from('phase_admins').delete()
    .eq('player_id', playerId).eq('phase_id', phaseId);
  if (error) throw error;
}

export async function getPhaseAdminScopeIds(playerId: string): Promise<{ seasonIds: string[]; phaseIds: string[] }> {
  const [assignments, seasons] = await Promise.all([
    readAllPages((from, to) => supabase.from('phase_admins').select('id,phase_id')
      .eq('player_id', playerId).order('id').range(from, to)),
    readAllPages((from, to) => supabase.from('resource_admins').select('id,resource_id')
      .eq('player_id', playerId).eq('resource_type', 'season').order('id').range(from, to)),
  ]);
  const seasonIds = [...new Set(seasons.map((row) => row.resource_id))];
  const phaseIds = new Set(assignments.map((row) => row.phase_id));
  for (let start = 0; start < seasonIds.length; start += 100) {
    const rows = await readAllPages((from, to) => supabase.from('league_phases').select('id')
      .in('season_id', seasonIds.slice(start, start + 100)).order('id').range(from, to));
    for (const row of rows) phaseIds.add(row.id);
  }
  return { seasonIds, phaseIds: [...phaseIds] };
}
