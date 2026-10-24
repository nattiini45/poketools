import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAnyAdmin } from '@/lib/auth/helpers';
import { getAdminScope, scopeAllowsSeason, scopeAllowsTournament, type AdminScope } from '@/lib/auth/admin-scope';
import { safeErrorResponse } from '@/lib/api/error-response';
import { formatZodErrors } from '@/lib/validation';
import {
  ADMIN_MATCH_DEFAULT_DATE_FIELD,
  ADMIN_MATCH_SCOPE_CAP,
  adminMatchListQuerySchema,
  type AdminMatchListResponse,
} from '@/lib/admin/match-list';
import { isValidUuid } from '@/lib/utils/uuid';
import {
  findPlayerIdsForMatchSearch,
  listAdminMatchesPage,
  listMatchFilterPlayers,
  listTournamentIdsBySeason,
} from '@/lib/supabase/queries/matches';
import type { ApiResult } from '@/types/api';

/** The 403 for a league or tournament outside the caller's scope (not an empty list). */
function outOfScope(): AuthError {
  return new AuthError('Admin access required for this resource', 403, 'forbidden');
}

/** `ids` restricted to `allowed`; a null side is unrestricted. */
function intersect(ids: string[] | null, allowed: string[] | null): string[] | null {
  if (ids === null) return allowed;
  if (allowed === null) return ids;
  const keep = new Set(allowed);
  return ids.filter((id) => keep.has(id));
}

/**
 * The tournaments a request may read: the caller's scope narrowed by
 * `tournament_id` / `season_id`. null = every tournament. A league or
 * tournament the caller cannot manage is a 403, never an empty list.
 */
async function resolveTournamentIds(
  scope: AdminScope,
  filters: { seasonId?: string; tournamentId?: string }
): Promise<string[] | null> {
  let ids = scope.tournamentIds;

  if (filters.tournamentId) {
    if (!scopeAllowsTournament(scope, filters.tournamentId)) throw outOfScope();
    ids = intersect(ids, [filters.tournamentId]);
  }

  if (filters.seasonId) {
    const phaseIds = await listTournamentIdsBySeason(filters.seasonId);
    const inScope = intersect(phaseIds, scope.tournamentIds) ?? [];
    // A tournament-only admin has no season assignment but may filter by the league of their phase.
    if (scope.tournamentIds !== null && !scopeAllowsSeason(scope, filters.seasonId) && inScope.length === 0) {
      throw outOfScope();
    }
    ids = intersect(ids, inScope);
  }

  return ids;
}

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

    const searchParams = new URL(request.url).searchParams;
    // fromEntries defines own properties only, so a `__proto__` key cannot reach the prototype.
    const raw: Record<string, string | string[]> = Object.fromEntries(
      [...new Set(searchParams.keys())].map((key) => {
        const values = searchParams.getAll(key);
        return [key, values.length === 1 ? values[0] : values];
      })
    );
    const parsed = adminMatchListQuerySchema.safeParse(raw);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const query = parsed.data;

    const tournamentIds = await resolveTournamentIds(scope, {
      seasonId: query.season_id,
      tournamentId: query.tournament_id,
    });

    const noScope = tournamentIds !== null && tournamentIds.length === 0;
    if (!noScope && tournamentIds !== null && tournamentIds.length > ADMIN_MATCH_SCOPE_CAP) {
      // One `IN` list per request: a scope this wide would overflow the URL, so ask for a narrower filter. A league
      // filter only helps while the league's own stages fit under the cap.
      const issues = `Your scope covers more than ${ADMIN_MATCH_SCOPE_CAP} tournaments; pick one tournament, or a league with at most ${ADMIN_MATCH_SCOPE_CAP} stages`;
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    // The chips get their names on every success body, including the empty ones.
    const filterPlayerIds = [query.player_id, query.player2_id].filter((id): id is string => Boolean(id));
    const players =
      filterPlayerIds.length > 0 ? await listMatchFilterPlayers(filterPlayerIds, { visibleOnly: !scope.isSiteAdmin }) : [];
    const empty = (searchTruncated = false): AdminMatchListResponse => ({
      rows: [],
      total: 0,
      page: query.page,
      pageSize: query.page_size,
      searchTruncated,
      players,
    });
    const respond = (data: AdminMatchListResponse) =>
      NextResponse.json<ApiResult<AdminMatchListResponse>>({ success: true, data });

    if (noScope) return respond(empty());

    // A full uuid is a match id; anything else is a player search.
    let matchId: string | undefined;
    let playerIds: string[] | undefined;
    let searchTruncated = false;
    if (query.q) {
      if (isValidUuid(query.q)) {
        matchId = query.q;
      } else {
        const found = await findPlayerIdsForMatchSearch(query.q);
        if (found.ids.length === 0) return respond(empty());
        playerIds = found.ids;
        searchTruncated = found.truncated;
      }
    }

    // An explicit pick (a league, a phase or one match) shows its matches, hidden or not.
    const explicitPick = Boolean(query.season_id || query.tournament_id || matchId);
    const hasDate = Boolean(query.date_from || query.date_to || query.date_none);

    const result = await listAdminMatchesPage({
      tournamentIds,
      standaloneOnly: query.standalone === 'true',
      statuses: query.status,
      playerIds,
      matchId,
      page: query.page,
      pageSize: query.page_size,
      roundId: query.round_id,
      formatType: query.format_type,
      bracketType: query.bracket_type,
      bestOf: query.best_of,
      rulesetId: query.ruleset_id,
      date: hasDate
        ? {
            field: query.date_field ?? ADMIN_MATCH_DEFAULT_DATE_FIELD,
            from: query.date_from,
            to: query.date_to,
            none: query.date_none === 'true',
          }
        : undefined,
      playerId: query.player_id,
      player2Id: query.player2_id,
      replay: query.replay,
      handEdited: query.hand_edited === 'true',
      hasNotes: query.has_notes === 'true',
      noGames: query.no_games === 'true',
      preset: query.preset,
      includeTest: query.include_test === 'true' || explicitPick,
      includeArchived: query.include_archived === 'true' || explicitPick,
      sort: query.sort,
    });

    return respond({
      rows: result.rows,
      total: result.total,
      page: query.page,
      pageSize: query.page_size,
      searchTruncated,
      players,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to list matches');
  }
}
