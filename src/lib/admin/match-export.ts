/**
 * CSV export of the admin match list (`GET /api/admin/matches/export`). Pure:
 * one row per match, English machine values (column names, round and status
 * names, ISO UTC dates), no private columns and no notes. The cell escaping is
 * `recordsToCsv`, which already neutralises formula prefixes, so there is no
 * second escaper here.
 */
import { computeMatchGamesWon } from '@/lib/match/aggregation';
import type { AdminMatchRow } from '@/lib/supabase/queries/matches';
import { recordsToCsv } from '@/lib/utils/csv';

/** Most rows one export holds; a larger filtered set is cut and reported as "N of M". */
export const ADMIN_MATCH_EXPORT_CAP = 5000;

export const MATCH_EXPORT_COLUMNS = [
  'match_id',
  'league',
  'phase',
  'round',
  'round_number',
  'player_1',
  'player_2',
  'status',
  'winner',
  'games_p1',
  'games_p2',
  'best_of',
  'scheduled_at',
  'date_played',
] as const;

export type MatchExportColumn = (typeof MATCH_EXPORT_COLUMNS)[number];
export type MatchExportRecord = Record<MatchExportColumn, string | number | null>;

/** Byte order mark, so Excel reads the file as UTF-8 (umlauts in names). */
export const MATCH_EXPORT_BOM = '﻿';

/** An instant as ISO UTC (`2026-10-25T10:00:00.000Z`), or null; a value that does not parse is kept as stored. */
function isoUtc(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
}

/**
 * One row of the file. The score is two numeric columns (empty when no game is recorded): a cell like `2-1` is turned
 * into a date by spreadsheets.
 */
export function matchExportRecord(row: AdminMatchRow): MatchExportRecord {
  const games = row.games.length > 0 ? computeMatchGamesWon(row.games, row.player_1_id, row.player_2_id) : null;
  return {
    match_id: row.id,
    league: row.season_name,
    phase: row.tournament_name,
    round: row.round_name,
    round_number: row.round_number,
    player_1: row.player_1_name,
    player_2: row.player_2_name,
    status: row.status,
    winner: row.winner_name,
    games_p1: games ? games.p1 : null,
    games_p2: games ? games.p2 : null,
    best_of: row.best_of,
    scheduled_at: isoUtc(row.scheduled_at),
    date_played: isoUtc(row.date_played),
  };
}

/** The CSV text (without the byte order mark): the header line, then one line per match. Never empty. */
export function matchesToCsv(rows: readonly AdminMatchRow[]): string {
  if (rows.length === 0) return MATCH_EXPORT_COLUMNS.map((column) => `"${column}"`).join(',');
  return recordsToCsv(rows.map(matchExportRecord));
}

/** `matches-YYYY-MM-DD.csv`, or `matches-YYYY-MM-DD-2500-of-3412.csv` when the export is cut at the cap. */
export function matchExportFileName(now: Date, counts: { exported: number; total: number }): string {
  const day = now.toISOString().slice(0, 10);
  const suffix = counts.total > counts.exported ? `-${counts.exported}-of-${counts.total}` : '';
  return `matches-${day}${suffix}.csv`;
}
