import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';
import type { PinMoveState } from '@/lib/ruleset-studio/pin-move-core';
import type { Tables } from '@/types/database';

export interface PhasePinState extends PinMoveState<'phase'> {
  status: Tables<'league_phases'>['status'];
  season_id: string;
  ruleset_id: string;
  archived: boolean;
}

export async function getPhasePinStates(ids: readonly string[]): Promise<PhasePinState[]> {
  const rows: PhasePinState[] = [];
  for (let start = 0; start < ids.length; start += 50) {
    const chunk = ids.slice(start, start + 50);
    const found = await readAllPages((from, to) => supabase.from('league_phases')
      .select('id,name,status,season_id,ruleset_id,archived').in('id', [...chunk]).order('id').range(from, to));
    rows.push(...found.map((row) => ({ ...row, kind: 'phase' as const })));
  }
  return rows;
}

export async function listPhasePins(versionIds: readonly string[]): Promise<PhasePinState[]> {
  const rows = new Map<string, PhasePinState>();
  for (let start = 0; start < versionIds.length; start += 50) {
    const chunk = versionIds.slice(start, start + 50);
    const found = await readAllPages((from, to) => supabase.from('league_phases')
      .select('id,name,status,season_id,ruleset_id,archived').in('ruleset_id', [...chunk]).order('id').range(from, to));
    for (const row of found) rows.set(row.id, { ...row, kind: 'phase' });
  }
  return [...rows.values()];
}

export async function repinPhaseTarget(state: PhasePinState, to: string): Promise<boolean> {
  const { data, error } = await supabase.from('league_phases').update({ ruleset_id: to })
    .eq('id', state.id).eq('ruleset_id', state.ruleset_id).eq('status', state.status)
    .eq('archived', state.archived).select('id');
  if (error) throw error;
  return (data ?? []).length === 1;
}

export async function isVersionPhasePinned(versionId: string): Promise<boolean> {
  const { count, error } = await supabase.from('league_phases')
    .select('id', { count: 'exact', head: true }).eq('ruleset_id', versionId);
  if (error) throw error;
  return (count ?? 0) > 0;
}
