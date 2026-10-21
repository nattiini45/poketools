import { supabase } from '../client';
import type { Tables, TablesInsert } from '@/types/database';
import type { PlayerStreaks } from '@/types/streak';

type PlayerStreaksRow = Tables<'player_streaks'>;

function toPlayerStreaks(row: PlayerStreaksRow): PlayerStreaks {
  return {
    id: row.id,
    player_id: row.player_id,
    current_win_streak: row.current_win_streak,
    best_win_streak: row.best_win_streak,
    current_loss_streak: row.current_loss_streak,
    best_loss_streak: row.best_loss_streak,
    current_ko_streak: row.current_ko_streak,
    best_ko_streak: row.best_ko_streak,
    current_flawless_streak: row.current_flawless_streak,
    best_flawless_streak: row.best_flawless_streak,
    last_match_id: row.last_match_id,
  };
}

export interface PlayerStreaksUpsertInput {
  current_win_streak: number;
  best_win_streak: number;
  current_loss_streak: number;
  best_loss_streak: number;
  current_ko_streak: number;
  best_ko_streak: number;
  current_flawless_streak: number;
  best_flawless_streak: number;
  last_match_id: string | null;
  updated_at?: string;
}

export async function getPlayerStreaks(playerId: string): Promise<PlayerStreaks | null> {
  const { data, error } = await supabase
    .from('player_streaks')
    .select('*')
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) throw error;
  return data ? toPlayerStreaks(data) : null;
}

export async function upsertPlayerStreaks(
  playerId: string,
  data: PlayerStreaksUpsertInput
): Promise<PlayerStreaks> {
  const payload: TablesInsert<'player_streaks'> = {
    player_id: playerId,
    current_win_streak: data.current_win_streak,
    best_win_streak: data.best_win_streak,
    current_loss_streak: data.current_loss_streak,
    best_loss_streak: data.best_loss_streak,
    current_ko_streak: data.current_ko_streak,
    best_ko_streak: data.best_ko_streak,
    current_flawless_streak: data.current_flawless_streak,
    best_flawless_streak: data.best_flawless_streak,
    last_match_id: data.last_match_id,
    updated_at: data.updated_at ?? new Date().toISOString(),
  };

  const { data: row, error } = await supabase
    .from('player_streaks')
    .upsert(payload, { onConflict: 'player_id' })
    .select()
    .single();

  if (error) throw error;
  return toPlayerStreaks(row);
}

export async function getStreakLeaderboard(): Promise<PlayerStreaks[]> {
  const { data, error } = await supabase
    .from('player_streaks')
    .select('*')
    .order('best_win_streak', { ascending: false });

  if (error) throw error;
  return data.map(toPlayerStreaks);
}
