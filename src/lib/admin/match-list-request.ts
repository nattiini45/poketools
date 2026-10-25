import 'server-only';

/**
 * The request side of the admin match list, shared by `GET /api/admin/matches`
 * and `GET /api/admin/matches/export`: the strict query parse, and the scope
 * and filter resolution that turns a validated query into query-layer filters.
 * One implementation means the export can never disagree with the list about
 * what a filter or the caller's scope allows.
 */
import { NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth/helpers';
import { scopeAllowsSeason, scopeAllowsTournament, type AdminScope } from '@/lib/auth/admin-scope';
import { formatZodErrors } from '@/lib/validation';
import {
  ADMIN_MATCH_DEFAULT_DATE_FIELD,
  ADMIN_MATCH_SCOPE_CAP,
  adminMatchListQuerySchema,
  type AdminMatchListQuery,
  type AdminMatchListResponse,
} from '@/lib/admin/match-list';
import { isValidUuid } from '@/lib/utils/uuid';
import {
  findPlayerIdsForMatchSearch,
  listMatchFilterPlayers,
  listTournamentIdsBySeason,
  type AdminMatchListParams,
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

/** The 400 every list-shaped route answers for an invalid query or a scope that is too wide. */
export function validationFailedResponse(issues: string): NextResponse<ApiResult<never>> {
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: issues, code: 'validation_failed', params: { issues } },
    { status: 400 }
  );
}

export type ParsedAdminMatchListSearch =
  | { ok: true; query: AdminMatchListQuery }
  | { ok: false; response: NextResponse<ApiResult<never>> };

/**
 * Parses the query string against the strict list schema: unknown keys and
 * repeated keys are a 400 `validation_failed` with the issues.
 */
export function parseAdminMatchListSearch(searchParams: URLSearchParams): ParsedAdminMatchListSearch {
  // fromEntries defines own properties only, so a `__proto__` key cannot reach the prototype.
  const raw: Record<string, string | string[]> = Object.fromEntries(
    [...new Set(searchParams.keys())].map((key) => {
      const values = searchParams.getAll(key);
      return [key, values.length === 1 ? values[0] : values];
    })
  );
  const parsed = adminMatchListQuerySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: validationFailedResponse(formatZodErrors(parsed.error)) };
  return { ok: true, query: parsed.data };
}

export type AdminMatchListFilters = Omit<AdminMatchListParams, 'page' | 'pageSize'>;

export type ResolvedAdminMatchListRequest =
  /** The caller's scope is wider than one `IN` list can carry: ask for a narrower filter. */
  | { kind: 'invalid'; issues: string }
  /** Nothing can match (empty scope, or a player search that found nobody). */
  | { kind: 'empty'; players: AdminMatchListResponse['players']; searchTruncated: boolean }
  | {
      kind: 'ok';
      filters: AdminMatchListFilters;
      players: AdminMatchListResponse['players'];
      searchTruncated: boolean;
    };

/**
 * Turns a validated list query into query-layer filters for the caller's
 * scope. Throws the 403 `AuthError` for a league or phase outside the scope.
 * A resource admin only ever resolves their own leagues and tournaments, and a
 * player filter never widens that.
 */
export async function resolveAdminMatchListRequest(
  scope: AdminScope,
  query: AdminMatchListQuery
): Promise<ResolvedAdminMatchListRequest> {
  const tournamentIds = await resolveTournamentIds(scope, {
    seasonId: query.season_id,
    tournamentId: query.tournament_id,
  });

  const noScope = tournamentIds !== null && tournamentIds.length === 0;
  if (!noScope && tournamentIds !== null && tournamentIds.length > ADMIN_MATCH_SCOPE_CAP) {
    // One `IN` list per request: a scope this wide would overflow the URL, so ask for a narrower filter. A league
    // filter only helps while the league's own stages fit under the cap.
    const issues = `Your scope covers more than ${ADMIN_MATCH_SCOPE_CAP} tournaments; pick one tournament, or a league with at most ${ADMIN_MATCH_SCOPE_CAP} stages`;
    return { kind: 'invalid', issues };
  }

  // The chips get their names on every success body, including the empty ones.
  const filterPlayerIds = [query.player_id, query.player2_id].filter((id): id is string => Boolean(id));
  const players =
    filterPlayerIds.length > 0 ? await listMatchFilterPlayers(filterPlayerIds, { visibleOnly: !scope.isSiteAdmin }) : [];

  if (noScope) return { kind: 'empty', players, searchTruncated: false };

  // A full uuid is a match id; anything else is a player search.
  let matchId: string | undefined;
  let playerIds: string[] | undefined;
  let searchTruncated = false;
  if (query.q) {
    if (isValidUuid(query.q)) {
      matchId = query.q;
    } else {
      const found = await findPlayerIdsForMatchSearch(query.q);
      if (found.ids.length === 0) return { kind: 'empty', players, searchTruncated: false };
      playerIds = found.ids;
      searchTruncated = found.truncated;
    }
  }

  // An explicit pick (a league, a phase or one match) shows its matches, hidden or not.
  const explicitPick = Boolean(query.season_id || query.tournament_id || matchId);
  const hasDate = Boolean(query.date_from || query.date_to || query.date_none);

  return {
    kind: 'ok',
    players,
    searchTruncated,
    filters: {
      tournamentIds,
      standaloneOnly: query.standalone === 'true',
      statuses: query.status,
      playerIds,
      matchId,
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
    },
  };
}
