/**
 * Reads for the format drift report (`GET /api/admin/format-drift`, see `src/lib/admin/format-drift.ts`).
 *
 * Read-only. Both lists cover every league, so they page with `.range()` (PostgREST answers at most 1000 rows per
 * request) in a stable order and stop at `FORMAT_DRIFT_MAX_ROWS`, reporting `truncated` instead of looping on a very
 * large install. Only league and phase names, ids and rules are selected; no player data.
 */
import 'server-only';
import { supabase } from '../client';
import type { TiebreakerStep } from '@/types/format-rules';
import {
  FORMAT_DRIFT_MAX_ROWS,
  normalizeAdvancementRule,
  type DriftPhaseRow,
  type FormatRulesOrderRow,
} from '@/lib/admin/format-drift';

export { FORMAT_DRIFT_MAX_ROWS };
export type { DriftPhaseRow, FormatRulesOrderRow };

/** Rows per request: PostgREST's `max_rows`. */
export const FORMAT_DRIFT_PAGE_SIZE = 1000;

interface Page<T> {
  data: T[] | null;
  error: { message?: string } | null;
}

/**
 * Pages through `fetchPage(from, to)` until a page is empty or short (the list ended), or the cap is reached.
 * A full page that lands exactly on the cap counts as truncated: there may be more rows behind it.
 */
async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  while (rows.length < FORMAT_DRIFT_MAX_ROWS) {
    const from = rows.length;
    const { data, error } = await fetchPage(from, from + FORMAT_DRIFT_PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = data ?? [];
    if (chunk.length === 0) return { rows, truncated: false };
    rows.push(...chunk);
    if (chunk.length < FORMAT_DRIFT_PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** The embedded league of a row: PostgREST returns a to-one embed as an object, an array in some typings. */
function embeddedLeague(value: unknown): { name: string; archived: boolean; is_test_season: boolean } {
  const league = (Array.isArray(value) ? value[0] : value) as
    | { name?: string; archived?: boolean; is_test_season?: boolean }
    | null
    | undefined;
  return {
    name: league?.name ?? '',
    archived: league?.archived === true,
    is_test_season: league?.is_test_season === true,
  };
}

/** Every `format_rules` row's stored tiebreaker order with its league, ordered by league id. */
export async function listFormatRulesOrders(): Promise<{ rows: FormatRulesOrderRow[]; truncated: boolean }> {
  const { rows, truncated } = await readAllPages((from, to) =>
    supabase
      .from('format_rules')
      .select('season_id, tiebreaker_order, seasons ( name, archived, is_test_season )')
      .order('season_id')
      .range(from, to),
  );
  return {
    rows: rows.map((row) => {
      const league = embeddedLeague(row.seasons);
      return {
        season_id: row.season_id,
        season_name: league.name,
        archived: league.archived,
        is_test: league.is_test_season,
        tiebreaker_order: Array.isArray(row.tiebreaker_order) ? (row.tiebreaker_order as TiebreakerStep[]) : [],
      };
    }),
    truncated,
  };
}

/** Every phase that belongs to a league, with its advancement rule, ordered by league, stage order and id. */
export async function listLeaguePhasesForDrift(): Promise<{ rows: DriftPhaseRow[]; truncated: boolean }> {
  const { rows, truncated } = await readAllPages((from, to) =>
    supabase
      .from('tournaments')
      .select('id, season_id, name, stage_order, status, advancement_rule, seasons ( name, archived, is_test_season )')
      .not('season_id', 'is', null)
      .order('season_id')
      .order('stage_order')
      .order('id')
      .range(from, to),
  );
  return {
    rows: rows.flatMap((row) => {
      if (!row.season_id) return [];
      const league = embeddedLeague(row.seasons);
      return [
        {
          id: row.id,
          season_id: row.season_id,
          season_name: league.name,
          archived: league.archived,
          is_test: league.is_test_season,
          name: row.name,
          stage_order: row.stage_order,
          status: row.status,
          advancement_rule: normalizeAdvancementRule(row.advancement_rule),
        },
      ];
    }),
    truncated,
  };
}
