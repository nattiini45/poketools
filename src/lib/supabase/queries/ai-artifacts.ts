import { supabase } from '../client';
import type { TablesUpdate } from '@/types/database';
import { logger } from '@/lib/logger';
import { aiArtifactMachine } from '@/lib/ai/artifact-state';

export type AiArtifactTable = 'match_analyses' | 'match_prep_analyses' | 'tournament_reports';

/** The columns a settle writes: the shared result columns plus each table's own payload column. */
export type AiArtifactSettleValues = Omit<
  TablesUpdate<'match_analyses'> & TablesUpdate<'match_prep_analyses'> & TablesUpdate<'tournament_reports'>,
  'id' | 'status' | 'updated_at'
>;

/**
 * Settles a pending AI artifact (`ai_artifact.status`, docs/state-machines.md): pending → completed or failed, as a
 * compare-and-set (`WHERE id = ? AND status IN sourcesOf(to)`, i.e. still pending). Returns false when no row
 * matched: the row was deleted or replaced (a forced regenerate, a match reset) while the generation ran, so its
 * result is dropped instead of being written over a row it no longer owns. A failed query throws.
 */
export async function settleAiArtifact(
  table: AiArtifactTable,
  id: string,
  to: 'completed' | 'failed',
  values: AiArtifactSettleValues,
): Promise<boolean> {
  aiArtifactMachine.assertTransition('pending', to, 'system');
  const { data, error } = await supabase
    .from(table)
    .update({ ...values, status: to, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', aiArtifactMachine.sourcesOf(to))
    .select('id');

  if (error) throw error;
  if ((data?.length ?? 0) > 0) return true;
  logger.warn('ai/artifact', 'settle matched no pending row: the artifact was deleted or replaced meanwhile', { table, id, to });
  return false;
}
