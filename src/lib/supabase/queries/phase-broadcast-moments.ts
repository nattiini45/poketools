import 'server-only';
import type { TablesInsert } from '@/types/database';
import { supabase } from '../client';

export async function createPhaseMomentsBatch(
  rows: Array<TablesInsert<'phase_broadcast_moments'> & { game_id: string }>,
): Promise<void> {
  if (!rows.length) return;
  const { error } = await supabase.from('phase_broadcast_moments').insert(rows);
  if (error) throw error;
}
