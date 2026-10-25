import { NextRequest, NextResponse } from 'next/server';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { getAdminScope } from '@/lib/auth/admin-scope';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { AdminMatchListResponse } from '@/lib/admin/match-list';
import {
  parseAdminMatchListSearch,
  resolveAdminMatchListRequest,
  validationFailedResponse,
} from '@/lib/admin/match-list-request';
import { listAdminMatchesPage } from '@/lib/supabase/queries/matches';
import type { ApiResult } from '@/types/api';

/**
 * GET /api/admin/matches — one page of matches, filtered and sorted on the server.
 *
 * Query (all optional, unknown keys are a 400): status (one match status or a
 * comma separated list), season_id, tournament_id, standalone=true
 * (tournaments without a league), round_id (needs tournament_id), q (player
 * name or Showdown username, or a full match id), format_type (league
 * format), bracket_type, best_of (1-15), ruleset_id, date_field
 * (scheduled | played | created | updated, default scheduled) with date_from
 * (inclusive) and date_to (exclusive) as ISO instants with an offset, or
 * date_none=true (the date is not set; scheduled and played only), player_id
 * (either seat) with player2_id for a head-to-head, replay (has | none),
 * hand_edited=true, has_notes=true, no_games=true, preset
 * (awaiting_confirmation | auto_confirms_soon | stale_in_progress | overdue,
 * narrows the status set), include_test=true / include_archived=true, sort
 * (created_desc default | status_priority | scheduled_asc | scheduled_desc |
 * deadline_asc | deadline_desc | updated_desc | updated_asc), page (default
 * 1), page_size (25 | 50 | 100, default 50).
 *
 * Matches of test leagues and of archived leagues and tournaments are hidden
 * unless the matching include_* flag is set, or the request names a league
 * (season_id), a phase (tournament_id) or a match id: an explicit pick shows
 * its matches. Site admins read every match; resource admins read the matches
 * of their own leagues and tournaments, and a player filter never widens
 * that. Rows are full match rows (admins and resource admins may receive
 * them, see `src/lib/match/public-match.ts`) with players in the narrow
 * shape. `players` carries the names of player_id / player2_id for the filter
 * chips; a resource admin resolves only players the public directory shows.
 */
export async function GET(request: NextRequest) {
  try {
    const player = await requireAnyAdmin();
    const scope = await getAdminScope(player);

    const parsed = parseAdminMatchListSearch(new URL(request.url).searchParams);
    if (!parsed.ok) return parsed.response;
    const query = parsed.query;

    const respond = (data: AdminMatchListResponse) =>
      NextResponse.json<ApiResult<AdminMatchListResponse>>({ success: true, data });

    const resolved = await resolveAdminMatchListRequest(scope, query);
    if (resolved.kind === 'invalid') return validationFailedResponse(resolved.issues);
    if (resolved.kind === 'empty') {
      return respond({
        rows: [],
        total: 0,
        page: query.page,
        pageSize: query.page_size,
        searchTruncated: resolved.searchTruncated,
        players: resolved.players,
      });
    }

    const result = await listAdminMatchesPage({ ...resolved.filters, page: query.page, pageSize: query.page_size });

    return respond({
      rows: result.rows,
      total: result.total,
      page: query.page,
      pageSize: query.page_size,
      searchTruncated: resolved.searchTruncated,
      players: resolved.players,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to list matches');
  }
}
