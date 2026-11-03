import { supabase } from '../client';
import { readExportRows, type ExportRowsResult } from '@/lib/admin/export-rows';

/** The tables the admin export may read. */
export type ExportTable = 'players' | 'tournaments' | 'matches' | 'seasons' | 'games' | 'battle_stats';

/**
 * Up to `limit` rows of an exportable table, paged under PostgREST `max_rows` in a total order (`created_at`,
 * then `id`) so pages neither overlap nor skip. Every exportable table carries both columns.
 */
export function readExportTable(table: ExportTable, limit: number): Promise<ExportRowsResult> {
  return readExportRows(
    (from, to, withCount) =>
      supabase
        .from(table)
        .select('*', withCount ? { count: 'exact' } : undefined)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    limit,
  );
}
