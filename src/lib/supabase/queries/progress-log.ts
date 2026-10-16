import { supabase } from '../client';
import type { Tables, TablesInsert } from '@/types/database';
import type { EvoProgressEntry } from '@/types/evolution';
import type { ProgressSourceType } from '@/types/format-rules';

type ProgressLogRow = Tables<'evo_progress_log'>;

function toEntry(row: ProgressLogRow): EvoProgressEntry {
  return {
    id: row.id,
    tracker_id: row.tracker_id,
    season_id: row.season_id,
    matchday: row.matchday,
    source: row.source as EvoProgressEntry['source'],
    amount: row.amount,
    note: row.note,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

/** Get the most recent log entry for a tracker (used after atomic RPC writes). */
export async function getLatestProgressEntry(
  trackerId: string
): Promise<EvoProgressEntry | null> {
  const { data, error } = await supabase
    .from('evo_progress_log')
    .select('*')
    .eq('tracker_id', trackerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? toEntry(data) : null;
}

/** Insert a progress log entry. */
export async function insertProgressLog(entry: {
  tracker_id: string;
  season_id: string;
  matchday?: number | null;
  source: ProgressSourceType;
  amount: number;
  note?: string | null;
  created_by?: string | null;
}): Promise<EvoProgressEntry> {
  const insert: TablesInsert<'evo_progress_log'> = {
    tracker_id: entry.tracker_id,
    season_id: entry.season_id,
    matchday: entry.matchday ?? null,
    source: entry.source,
    amount: entry.amount,
    note: entry.note ?? null,
    created_by: entry.created_by ?? null,
  };

  const { data, error } = await supabase
    .from('evo_progress_log')
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return toEntry(data);
}

/** Get all progress log entries for a season, optionally filtered by matchday. */
export async function getSeasonProgressLog(
  seasonId: string,
  matchday?: number
): Promise<EvoProgressEntry[]> {
  let query = supabase
    .from('evo_progress_log')
    .select('*')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: false });

  if (matchday !== undefined) {
    query = query.eq('matchday', matchday);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data.map(toEntry);
}

/**
 * Matchdays for which a tracker was awarded a Participation Token, ascending: every
 * matchday with a positive `cosmo_point` row, regardless of later negative
 * rows. Mirrors the partial unique index `evo_progress_log_cosmo_matchday_uniq`
 * (tracker_id, matchday) WHERE source = 'cosmo_point' AND matchday IS NOT NULL
 * AND amount > 0: at most one positive Participation Token row per tracker and
 * matchday; a reversal does not re-open the matchday; a re-award is an admin
 * correction without a matchday. Feeds the once-per-matchday fast path of
 * `awardCosmoPoint` and `TokenOverviewDTO.cosmo.matchdays_brought`.
 */
export async function getCosmoMatchdays(trackerId: string): Promise<number[]> {
  const { data, error } = await supabase
    .from('evo_progress_log')
    .select('matchday, amount')
    .eq('tracker_id', trackerId)
    .eq('source', 'cosmo_point')
    .not('matchday', 'is', null);

  if (error) throw error;

  const awarded = new Set<number>();
  for (const row of data) {
    if (row.matchday !== null && row.amount > 0) awarded.add(row.matchday);
  }
  return [...awarded].sort((a, b) => a - b);
}
