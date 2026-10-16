import { supabase } from '../client';
import type { Tables, TablesInsert } from '@/types/database';
import type { PlayerSignatures, SignaturePokemon } from '@/types/signature';

type PlayerSignaturesRow = Tables<'player_signatures'>;

function toPlayerSignatures(row: PlayerSignaturesRow): PlayerSignatures {
  const raw = row.signatures;
  const signatures = Array.isArray(raw) ? (raw as unknown as SignaturePokemon[]) : [];

  return {
    id: row.id,
    player_id: row.player_id,
    signatures,
    updated_at: row.updated_at,
  };
}

export async function getPlayerSignatures(playerId: string): Promise<PlayerSignatures | null> {
  const { data, error } = await supabase
    .from('player_signatures')
    .select('*')
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) throw error;
  return data ? toPlayerSignatures(data) : null;
}

/**
 * Batch-fetch signatures for multiple players in a single query.
 * Used by standings endpoint to avoid N+1 per-player queries.
 */
export async function getPlayerSignaturesBatch(
  playerIds: string[]
): Promise<Map<string, SignaturePokemon[]>> {
  if (playerIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('player_signatures')
    .select('player_id, signatures')
    .in('player_id', playerIds);

  if (error) throw error;

  const result = new Map<string, SignaturePokemon[]>();
  for (const row of data as Pick<PlayerSignaturesRow, 'player_id' | 'signatures'>[]) {
    const raw = row.signatures;
    result.set(
      row.player_id,
      Array.isArray(raw) ? (raw as unknown as SignaturePokemon[]) : []
    );
  }
  return result;
}

export async function upsertPlayerSignatures(
  playerId: string,
  signatures: SignaturePokemon[]
): Promise<PlayerSignatures> {
  const payload: TablesInsert<'player_signatures'> = {
    player_id: playerId,
    signatures: signatures as unknown as TablesInsert<'player_signatures'>['signatures'],
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('player_signatures')
    .upsert(payload, { onConflict: 'player_id' })
    .select()
    .single();

  if (error) throw error;
  return toPlayerSignatures(data);
}
