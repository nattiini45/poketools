/**
 * The reads behind the live-format routes and pages that `format-runtime.ts` does not carry: one check of a league, the
 * pageable check and adjustment histories, and the play state of a league (is it still open for player writes?). Every
 * read is scoped to the league: a check id of another league is `null`, a list never mixes leagues. A malformed id names
 * nothing and answers empty without a request. Server only (service-role client).
 *
 * A separate file on purpose, so edits to `format-runtime.ts` (the writes and the full-state read) do not collide.
 */
import 'server-only';

import { supabase } from '../client';
import { readBoundedPages } from '../read-bounded-pages';
import { isValidUuid } from '@/lib/utils/uuid';
import type { FormatAdjustmentRow, FormatCheckRow } from './format-runtime';
import type { FiredEventRecord } from '@/lib/format-engine/runtime/late-joiners';

/** The largest page a list read returns. */
export const FORMAT_LIST_MAX_LIMIT = 100;

/** PostgREST answers an offset past the last row with this code when a count is requested: an empty page, not a failure. */
const RANGE_NOT_SATISFIABLE = 'PGRST103';

export type FormatCheckListStatus = 'open' | 'confirmed' | 'rejected' | 'all';

export interface FormatListPage {
  /** 1..100 (clamped). */
  limit: number;
  /** 0 and up (clamped). */
  offset: number;
}

export interface FormatListResult<T> {
  rows: T[];
  /** Every row of the filter, not only this page. */
  total: number;
}

function pageOf(page: FormatListPage): { from: number; to: number } {
  const limit = Number.isFinite(page.limit) ? Math.min(FORMAT_LIST_MAX_LIMIT, Math.max(1, Math.trunc(page.limit))) : FORMAT_LIST_MAX_LIMIT;
  const offset = Number.isFinite(page.offset) ? Math.max(0, Math.trunc(page.offset)) : 0;
  return { from: offset, to: offset + limit - 1 };
}

/** One check of the league, or null (unknown, or a check of another league). */
export async function getFormatCheck(seasonId: string, checkId: string): Promise<FormatCheckRow | null> {
  if (!isValidUuid(seasonId) || !isValidUuid(checkId)) return null;
  const { data, error } = await supabase
    .from('format_checks')
    .select('*')
    .eq('season_id', seasonId)
    .eq('id', checkId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** A page of the league's checks, newest first (`opened_at` descending, then `id`), and the number of checks the filter matches. */
export async function listFormatChecks(
  seasonId: string,
  filter: { status: FormatCheckListStatus } & FormatListPage,
): Promise<FormatListResult<FormatCheckRow>> {
  if (!isValidUuid(seasonId)) return { rows: [], total: 0 };
  const { from, to } = pageOf(filter);
  let query = supabase.from('format_checks').select('*', { count: 'exact' }).eq('season_id', seasonId);
  if (filter.status !== 'all') query = query.eq('status', filter.status);
  const { data, error, count } = await query.order('opened_at', { ascending: false }).order('id').range(from, to);
  if (error?.code === RANGE_NOT_SATISFIABLE) {
    let recount = supabase.from('format_checks').select('id', { count: 'exact', head: true }).eq('season_id', seasonId);
    if (filter.status !== 'all') recount = recount.eq('status', filter.status);
    const { error: countError, count: total } = await recount;
    if (countError) throw countError;
    return { rows: [], total: total ?? 0 };
  }
  if (error) throw error;
  return { rows: data ?? [], total: count ?? data?.length ?? 0 };
}

/** A page of the league's adjustment history, newest first (`created_at` descending, then `id`), and the total. */
export async function listFormatAdjustments(seasonId: string, page: FormatListPage): Promise<FormatListResult<FormatAdjustmentRow>> {
  if (!isValidUuid(seasonId)) return { rows: [], total: 0 };
  const { from, to } = pageOf(page);
  const { data, error, count } = await supabase
    .from('format_adjustments')
    .select('*', { count: 'exact' })
    .eq('season_id', seasonId)
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, to);
  if (error?.code === RANGE_NOT_SATISFIABLE) {
    const { error: countError, count: total } = await supabase
      .from('format_adjustments')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', seasonId);
    if (countError) throw countError;
    return { rows: [], total: total ?? 0 };
  }
  if (error) throw error;
  return { rows: data ?? [], total: count ?? data?.length ?? 0 };
}

/**
 * The league's event log without the per-match events (`match_completed`, one row per completed match): the key, kind,
 * payload and applied ops of every one-time event (stage and round starts and ends, locks, calendar marks), oldest first.
 * The admin overview reads it to list the late joiners; a league without a format or a malformed id answers empty.
 */
export async function listFiredFormatEvents(seasonId: string): Promise<FiredEventRecord[]> {
  if (!isValidUuid(seasonId)) return [];
  const { rows } = await readBoundedPages<FiredEventRecord>(
    (from, to) =>
      supabase
        .from('format_event_log')
        .select('event_key, event, payload, ops')
        .eq('season_id', seasonId)
        .neq('event', 'match_completed')
        .order('fired_at')
        .order('event_key')
        .range(from, to),
    { label: 'format-runtime fired events' },
  );
  return rows;
}

export interface SeasonPlayState {
  status: 'upcoming' | 'active' | 'completed';
  archived: boolean;
}

/** Whether a league still takes player writes: its status and the archive flag, or null for an unknown league. */
export async function getSeasonPlayState(seasonId: string): Promise<SeasonPlayState | null> {
  if (!isValidUuid(seasonId)) return null;
  const { data, error } = await supabase.from('seasons').select('status, archived').eq('id', seasonId).maybeSingle();
  if (error) throw error;
  return data === null ? null : { status: data.status, archived: data.archived };
}
