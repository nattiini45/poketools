import 'server-only';
import { isValidUuid } from '@/lib/utils/uuid';
import type { CompetitionOwner } from '@/types/competition-owner';
import { supabase } from '../client';
import type { PhaseStorageMode } from './phase-storage';

type NativePhaseOwner = Extract<CompetitionOwner, { kind: 'phase' }>;
export type PhaseAliasInput = { phaseId: string; matchId?: string } | { matchId: string; phaseId?: never };

export async function resolveLeaguePhaseRoute(
  seasonId: string,
  phaseId: string,
  mode: PhaseStorageMode,
): Promise<CompetitionOwner | null> {
  if (!isValidUuid(seasonId) || !isValidUuid(phaseId)) return null;
  if (mode === 'phase') {
    const { data, error } = await supabase.from('league_phases').select('id, season_id')
      .eq('id', phaseId).eq('season_id', seasonId).maybeSingle();
    if (error) throw error;
    return data ? { kind: 'phase', phase_id: data.id, season_id: data.season_id } : null;
  }
  if (mode === 'legacy') {
    const { data, error } = await supabase.from('tournaments').select('id, season_id')
      .eq('id', phaseId).eq('season_id', seasonId).maybeSingle();
    if (error) throw error;
    return data && data.season_id !== null
      ? { kind: 'tournament', tournament_id: data.id, season_id: data.season_id }
      : null;
  }
  return null;
}

export async function findNativePhaseAliasOwner(input: PhaseAliasInput): Promise<NativePhaseOwner | null> {
  const { phaseId, matchId } = input;
  if ((phaseId !== undefined && !isValidUuid(phaseId)) || (matchId !== undefined && !isValidUuid(matchId))) {
    return null;
  }
  if (matchId !== undefined) {
    let query = supabase.from('phase_matches')
      .select('phase_id, phase:league_phases!phase_matches_phase_id_fkey!inner(season_id)')
      .eq('id', matchId);
    if (phaseId !== undefined) query = query.eq('phase_id', phaseId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data?.phase ? { kind: 'phase', phase_id: data.phase_id, season_id: data.phase.season_id } : null;
  }
  if (phaseId === undefined) return null;
  const { data, error } = await supabase.from('league_phases').select('id, season_id').eq('id', phaseId).maybeSingle();
  if (error) throw error;
  return data ? { kind: 'phase', phase_id: data.id, season_id: data.season_id } : null;
}

export async function findLegacyPhaseAliasOwner({ phaseId, matchId }: PhaseAliasInput) {
  if ((phaseId !== undefined && !isValidUuid(phaseId)) || (matchId !== undefined && !isValidUuid(matchId))) return null;
  if (matchId !== undefined) {
    let query = supabase.from('matches')
      .select('tournament_id, tournament:tournaments!matches_tournament_id_fkey!inner(season_id)')
      .eq('id', matchId).not('tournament.season_id', 'is', null);
    if (phaseId !== undefined) query = query.eq('tournament_id', phaseId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data?.tournament?.season_id ? {
      tournament_id: data.tournament_id, season_id: data.tournament.season_id,
    } : null;
  }
  if (phaseId === undefined) return null;
  const { data, error } = await supabase.from('tournaments').select('id, season_id').eq('id', phaseId)
    .not('season_id', 'is', null).maybeSingle();
  if (error) throw error;
  return data?.season_id ? { tournament_id: data.id, season_id: data.season_id } : null;
}

export async function standaloneTournamentAliasExists({ phaseId, matchId }: PhaseAliasInput): Promise<boolean> {
  if (phaseId === undefined) return false;
  if (matchId !== undefined) return standaloneMatchAliasExists(matchId, phaseId);
  return (await findStandaloneTournamentAlias(phaseId)) !== null;
}

export async function findStandaloneTournamentAlias(phaseId: string) {
  const { data, error } = await supabase.from('tournaments').select('id').eq('id', phaseId).is('season_id', null).maybeSingle();
  if (error) throw error;
  return data;
}

export async function standaloneMatchAliasExists(matchId: string, tournamentId?: string): Promise<boolean> {
  let query = supabase.from('matches')
    .select('id, tournament:tournaments!matches_tournament_id_fkey!inner(id)')
    .eq('id', matchId).is('tournament.season_id', null);
  if (tournamentId !== undefined) query = query.eq('tournament_id', tournamentId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data !== null;
}
