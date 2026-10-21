import { supabase } from '../client';
import type { Json } from '@/types/database';
import type { TrainerConfig } from '@/lib/draft-room/trainer-config';

/**
 * 3D trainer avatar configuration (draft room). One row per player
 * (`trainer_avatars_3d`, PK player_id). The route validates the config
 * shape before persisting; this module only stores/retrieves it.
 */

/** Fetch a player's saved 3D trainer config, or null if never customized. */
export async function getTrainerAvatar3D(
  playerId: string
): Promise<TrainerConfig | null> {
  const { data, error } = await supabase
    .from('trainer_avatars_3d')
    .select('config')
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) throw error;
  return (data?.config as unknown as TrainerConfig) ?? null;
}

/** Save (upsert) a player's 3D trainer config. */
export async function upsertTrainerAvatar3D(
  playerId: string,
  config: TrainerConfig
): Promise<void> {
  const { error } = await supabase
    .from('trainer_avatars_3d')
    .upsert(
      { player_id: playerId, config: config as unknown as Json, updated_at: new Date().toISOString() },
      { onConflict: 'player_id' }
    );

  if (error) throw error;
}
