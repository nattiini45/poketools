import { supabase } from '../client';
import type { Tables, TablesInsert } from '@/types/database';
import type { DraftPoolEntry, DraftPoolEntryFormData } from '@/types/draft-pool';

type EntryRow = Tables<'draft_pool_entries'>;

function toEntry(row: EntryRow): DraftPoolEntry {
  return {
    id: row.id,
    season_id: row.season_id,
    pokemon_name: row.pokemon_name,
    power_tier: row.power_tier,
    point_cost: row.point_cost,
    created_at: row.created_at,
  };
}

/** Get all pool entries for a season. */
export async function getPoolEntries(seasonId: string): Promise<DraftPoolEntry[]> {
  const { data, error } = await supabase
    .from('draft_pool_entries')
    .select('*')
    .eq('season_id', seasonId)
    .order('power_tier')
    .order('pokemon_name');

  if (error) throw error;
  return data.map(toEntry);
}

/** Get a single pool entry by season + pokemon name. */
export async function getPoolEntry(
  seasonId: string,
  pokemonName: string
): Promise<DraftPoolEntry | null> {
  const { data, error } = await supabase
    .from('draft_pool_entries')
    .select('*')
    .eq('season_id', seasonId)
    .eq('pokemon_name', pokemonName)
    .maybeSingle();

  if (error) throw error;
  return data ? toEntry(data) : null;
}

/** Add a single Pokemon to the draft pool. */
export async function createPoolEntry(
  input: DraftPoolEntryFormData
): Promise<DraftPoolEntry> {
  const insert: TablesInsert<'draft_pool_entries'> = {
    season_id: input.season_id,
    pokemon_name: input.pokemon_name,
    power_tier: input.power_tier ?? null,
    point_cost: input.point_cost ?? null,
  };

  const { data, error } = await supabase
    .from('draft_pool_entries')
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return toEntry(data);
}

/** Bulk add Pokemon to the draft pool. */
export async function bulkCreatePoolEntries(
  entries: DraftPoolEntryFormData[]
): Promise<DraftPoolEntry[]> {
  if (entries.length === 0) return [];

  const inserts: TablesInsert<'draft_pool_entries'>[] = entries.map((e) => ({
    season_id: e.season_id,
    pokemon_name: e.pokemon_name,
    power_tier: e.power_tier ?? null,
    point_cost: e.point_cost ?? null,
  }));

  const { data, error } = await supabase
    .from('draft_pool_entries')
    .insert(inserts)
    .select();

  if (error) throw error;
  return data.map(toEntry);
}

/** Update a pool entry's tier or cost. */
export async function updatePoolEntry(
  id: string,
  updates: Partial<Pick<DraftPoolEntryFormData, 'power_tier' | 'point_cost'>>
): Promise<DraftPoolEntry> {
  const { data, error } = await supabase
    .from('draft_pool_entries')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toEntry(data);
}

/** Remove a single entry from the pool. */
export async function deletePoolEntry(id: string): Promise<void> {
  const { error } = await supabase
    .from('draft_pool_entries')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/** Clear the entire pool for a season (for reimport). */
export async function deleteAllPoolEntries(seasonId: string): Promise<void> {
  const { error } = await supabase
    .from('draft_pool_entries')
    .delete()
    .eq('season_id', seasonId);

  if (error) throw error;
}
