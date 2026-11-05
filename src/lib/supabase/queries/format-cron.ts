/**
 * The read behind the format engine's cron pass: the phases of running kit leagues whose stage has a calendar.
 * Server only.
 */
import 'server-only';

import { supabase } from '../client';
import { readBoundedPages } from '../read-bounded-pages';
import type { Json } from '@/types/database';

export interface KitCronPhase {
  id: string;
  season_id: string;
  /** `upcoming` or `active`. */
  status: string;
  format_stage_key: string;
  /** `seasons.start_date`: what `start: season_start` of a calendar means. */
  season_start_date: string | null;
}

interface CronPhaseRow {
  id: string;
  season_id: string | null;
  status: string;
  format_stage_key: string | null;
  stage_spec: Json | null;
  seasons: { start_date: string | null } | { start_date: string | null }[] | null;
}

function hasCalendar(spec: Json | null): boolean {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return false;
  const stage = spec.stage;
  if (stage === null || typeof stage !== 'object' || Array.isArray(stage)) return false;
  const calendar = stage.calendar;
  return calendar !== null && typeof calendar === 'object' && !Array.isArray(calendar);
}

/**
 * The upcoming and active phases of upcoming and active, not archived leagues on the `kit` engine whose frozen stage
 * declares a calendar. Paged under `max_rows`.
 */
export async function listKitCronPhases(): Promise<KitCronPhase[]> {
  const { rows } = await readBoundedPages<CronPhaseRow>(
    (from, to) =>
      supabase
        .from('tournaments')
        .select('id, season_id, status, format_stage_key, stage_spec, seasons!inner ( start_date, status, archived, season_formats!inner ( engine ) )')
        .not('format_stage_key', 'is', null)
        .in('status', ['upcoming', 'active'])
        .in('seasons.status', ['upcoming', 'active'])
        .eq('seasons.archived', false)
        .eq('seasons.season_formats.engine', 'kit')
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: CronPhaseRow[] | null; error: unknown }>,
    { label: 'format-cron phases' },
  );
  return rows.flatMap((row) => {
    if (row.season_id === null || row.format_stage_key === null || !hasCalendar(row.stage_spec)) return [];
    const season = Array.isArray(row.seasons) ? row.seasons[0] : row.seasons;
    return [
      {
        id: row.id,
        season_id: row.season_id,
        status: row.status,
        format_stage_key: row.format_stage_key,
        season_start_date: season?.start_date ?? null,
      },
    ];
  });
}
