import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAnyAdmin } from '@/lib/auth/helpers';
import { getAdminScope, scopeAllowsSeason, scopeAllowsTournament, type AdminScope } from '@/lib/auth/admin-scope';
import { safeErrorResponse } from '@/lib/api/error-response';
import { formatZodErrors } from '@/lib/validation';
import { ADMIN_MATCH_SCOPE_CAP, adminMatchListQuerySchema, type AdminMatchListResponse } from '@/lib/admin/match-list';
import { isValidUuid } from '@/lib/utils/uuid';
import {
  findPlayerIdsForMatchSearch,
  listAdminMatchesPage,
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
 * GET /api/admin/matches — one page of matches, filtered on the server.
 *
 * Query: status (one match status or a comma separated list), season_id,
 * tournament_id, standalone=true (tournaments without a league), q (player
 * name or Showdown username, or a full match id), page (default 1),
 * page_size (25 | 50 | 100, default 50). Site admins read every match;
 * resource admins read the matches of their own leagues and tournaments.
 * Rows are full match rows (admins and resource admins may receive them,
 * see `src/lib/match/public-match.ts`) with players in the narrow shape.
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

    const empty = (searchTruncated = false): AdminMatchListResponse => ({
      rows: [],
      total: 0,
      page: query.page,
      pageSize: query.page_size,
      searchTruncated,
    });
    const respond = (data: AdminMatchListResponse) =>
      NextResponse.json<ApiResult<AdminMatchListResponse>>({ success: true, data });

    if (tournamentIds !== null && tournamentIds.length === 0) return respond(empty());
    if (tournamentIds !== null && tournamentIds.length > ADMIN_MATCH_SCOPE_CAP) {
      // One `IN` list per request: a scope this wide would overflow the URL, so ask for a narrower filter. A league
      // filter only helps while the league's own stages fit under the cap.
      const issues = `Your scope covers more than ${ADMIN_MATCH_SCOPE_CAP} tournaments; pick one tournament, or a league with at most ${ADMIN_MATCH_SCOPE_CAP} stages`;
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

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

    const result = await listAdminMatchesPage({
      tournamentIds,
      standaloneOnly: query.standalone === 'true',
      statuses: query.status,
      playerIds,
      matchId,
      page: query.page,
      pageSize: query.page_size,
    });

    return respond({
      rows: result.rows,
      total: result.total,
      page: query.page,
      pageSize: query.page_size,
      searchTruncated,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to list matches');
  }
}
