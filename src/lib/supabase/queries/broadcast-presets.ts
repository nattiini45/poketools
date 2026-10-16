import { supabase } from '../client';
import type { Tables, Json } from '@/types/database';
import type {
  BroadcastPreset,
  BroadcastPresetInsert,
  BroadcastPresetConfig,
  BroadcastPresetType,
} from '@/types/broadcast';

type BroadcastPresetRow = Tables<'broadcast_presets'>;

function toBroadcastPreset(row: BroadcastPresetRow): BroadcastPreset {
  return {
    id: row.id,
    name: row.name,
    owner_id: row.owner_id,
    preset_type: row.preset_type as BroadcastPresetType,
    config: row.config as unknown as BroadcastPresetConfig,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Read ───────────────────────────────────────────────────────────

export async function getPresetById(id: string): Promise<BroadcastPreset | null> {
  const { data, error } = await supabase
    .from('broadcast_presets')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toBroadcastPreset(data) : null;
}

export async function getPresetsByOwner(ownerId: string): Promise<BroadcastPreset[]> {
  const { data, error } = await supabase
    .from('broadcast_presets')
    .select('*')
    .eq('owner_id', ownerId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(toBroadcastPreset);
}

// ─── Write ──────────────────────────────────────────────────────────

export async function createPreset(input: BroadcastPresetInsert): Promise<BroadcastPreset> {
  const { data, error } = await supabase
    .from('broadcast_presets')
    .insert({
      name: input.name,
      owner_id: input.owner_id,
      preset_type: input.preset_type,
      config: input.config as unknown as Json,
    })
    .select()
    .single();

  if (error) throw error;
  return toBroadcastPreset(data);
}

export async function updatePreset(
  id: string,
  updates: Partial<Pick<BroadcastPreset, 'name' | 'config'>>
): Promise<BroadcastPreset> {
  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.config !== undefined) updateData.config = updates.config;

  const { data, error } = await supabase
    .from('broadcast_presets')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toBroadcastPreset(data);
}

// ─── Delete ─────────────────────────────────────────────────────────

export async function deletePreset(id: string): Promise<void> {
  const { error } = await supabase
    .from('broadcast_presets')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
