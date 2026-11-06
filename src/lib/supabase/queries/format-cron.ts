/**
 * The reads behind the format engine's cron pass: the phases of running kit leagues whose stage has a calendar, the
 * running kit leagues with or without one, and the finalized matches of a league's phases (the `match_completed`
 * backfill). Server only.
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

interface SeasonIdRow {
  id: string;
}

/**
 * The upcoming and active, not archived leagues on the `kit` engine, whether or not any stage has a calendar: the cron
 * pass repairs lost `action_locked` events and backfills `match_completed` for these too. Paged under `max_rows`.
 */
export async function listKitSeasonIds(): Promise<string[]> {
  const { rows } = await readBoundedPages<SeasonIdRow>(
    (from, to) =>
      supabase
        .from('seasons')
        .select('id, season_formats!inner ( engine )')
        .in('status', ['upcoming', 'active'])
        .eq('archived', false)
        .eq('season_formats.engine', 'kit')
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: SeasonIdRow[] | null; error: unknown }>,
    { label: 'format-cron kit seasons' },
  );
  return rows.map((row) => row.id);
}

/** A completed match whose finalize stamped its marker: the slice the `match_completed` backfill needs. */
export interface FinalizedMatchRow {
  id: string;
  tournament_id: string;
  round_id: string;
  player_1_id: string;
  player_2_id: string;
  winner_id: string;
}

/**
 * The completed, finalized matches of the given phases that have a winner, in the order they finished (`finalized_at`, the
 * id breaks a tie), so the `match_completed` backfill replays the completions in the order the live hook would have applied
 * them (a capacity-limited or exclusive grant goes to the earlier finisher). Paged under `max_rows`. A match whose
 * finalize is still unfinished is the heal's (`listMatchesNeedingFinalize`), not listed here.
 */
export async function listFinalizedMatches(phaseIds: readonly string[]): Promise<FinalizedMatchRow[]> {
  if (phaseIds.length === 0) return [];
  const { rows } = await readBoundedPages<FinalizedMatchRow>(
    (from, to) =>
      supabase
        .from('matches')
        .select('id, tournament_id, round_id, player_1_id, player_2_id, winner_id')
        .in('tournament_id', [...phaseIds])
        .eq('status', 'completed')
        .not('finalized_at', 'is', null)
        .not('winner_id', 'is', null)
        .order('finalized_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: FinalizedMatchRow[] | null; error: unknown }>,
    { label: 'format-cron finalized matches' },
  );
  return rows;
}

/** A match of a kit league's phases that is not `completed`: the slice the pending-revert sweep needs. */
export interface UncompletedMatchRow {
  id: string;
  tournament_id: string;
  status: string;
}

/** Ids per read: the list rides in the URL of the request. */
export const UNCOMPLETED_MATCH_CHUNK = 100;

/**
 * Of the given matches, those of the given phases whose status is not `completed` (a match that is gone is not listed).
 * The cron pass asks it about the matches whose `match_completed` key is still the current one: such a match that is not
 * completed has a revert (`match_reverted`) that never applied. Read in chunks of `UNCOMPLETED_MATCH_CHUNK` ids, in the
 * order given; one chunk is far under `max_rows`.
 */
export async function listUncompletedMatches(phaseIds: readonly string[], matchIds: readonly string[]): Promise<UncompletedMatchRow[]> {
  if (phaseIds.length === 0 || matchIds.length === 0) return [];
  const out: UncompletedMatchRow[] = [];
  for (let from = 0; from < matchIds.length; from += UNCOMPLETED_MATCH_CHUNK) {
    const { data, error } = (await supabase
      .from('matches')
      .select('id, tournament_id, status')
      .in('tournament_id', [...phaseIds])
      .in('id', matchIds.slice(from, from + UNCOMPLETED_MATCH_CHUNK))
      .neq('status', 'completed')
      .order('id', { ascending: true })) as unknown as { data: UncompletedMatchRow[] | null; error: unknown };
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out;
}
