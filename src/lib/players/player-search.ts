import type { PublicPlayerRef } from '@/lib/players/public-player';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';

/**
 * Client-safe pieces of the admin player picker (`GET /api/admin/player-search`):
 * the hit type, the search URL, the response parser and the rules that grey a
 * hit out. The roster, substitute, link and enrolment pickers all use these, so
 * the parser and the rules cannot drift apart between screens.
 */

/** One picker hit: the public player ref plus the guest flag. Nothing else of a player row reaches the client. */
export type PlayerSearchHit = PublicPlayerRef & { is_guest: boolean };

/** Hits one search asks for (the route's maximum page size). */
export const PLAYER_SEARCH_LIMIT = 20;

/** Characters typed before a picker searches: the route accepts one, so a one-letter name can be found. */
export const PLAYER_SEARCH_MIN_QUERY = 1;

/** What a search is scoped to: the route lets a scoped admin search only for a resource they administer. */
export type PlayerSearchScope = { seasonId: string } | { tournamentId: string };

/**
 * The picker's search URL. `{q}` is the placeholder `Combobox` fills with the
 * encoded query; the scope id is always sent so a league or tournament admin
 * is accepted by the route. `registeredOnly` asks the server for active,
 * non-guest players with a Discord or email login only (the link picker): the
 * identity and status columns never reach the client, so this filter can only
 * run server-side.
 */
export function playerSearchUrl(scope: PlayerSearchScope, options?: { registeredOnly?: boolean }): string {
  const target =
    'seasonId' in scope
      ? `season_id=${encodeURIComponent(scope.seasonId)}`
      : `tournament_id=${encodeURIComponent(scope.tournamentId)}`;
  const registered = options?.registeredOnly ? '&registered=1' : '';
  return `/api/admin/player-search?${target}${registered}&limit=${PLAYER_SEARCH_LIMIT}&q={q}`;
}

/** The picker error for a search that got no JSON answer at all (network failure, an HTML 502). */
export const PLAYER_SEARCH_NETWORK_ERROR: ApiErrorLike = { code: 'network_error' };

/** A player search answer: the hits and all matches, or the API's refusal (never an empty list for a failure). */
export type PlayerSearchOutcome =
  | { ok: true; hits: PlayerSearchHit[]; total: number }
  | { ok: false; error: ApiErrorLike };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Read the body of `GET /api/admin/player-search`. A refusal (403, 400, 500)
 * keeps its code so the picker shows why it is empty; a body that is neither a
 * success nor an error is an error too, not "no matches". Only `id`, `name` and
 * `is_guest` are read from a row, whatever else the body carries.
 */
export function parsePlayerSearch(json: unknown): PlayerSearchOutcome {
  if (isRecord(json) && json.success === true && Array.isArray(json.data)) {
    const hits: PlayerSearchHit[] = [];
    for (const row of json.data) {
      if (isRecord(row) && typeof row.id === 'string' && typeof row.name === 'string') {
        hits.push({ id: row.id, name: row.name, is_guest: row.is_guest === true });
      }
    }
    return { ok: true, hits, total: typeof json.total === 'number' ? json.total : hits.length };
  }
  return { ok: false, error: toApiErrorLike(json) };
}

/** The "showing N of M" hint of a success, or `null` when the page holds every match. */
export function searchTruncation(outcome: Extract<PlayerSearchOutcome, { ok: true }>): { shown: number; total: number } | null {
  return outcome.total > outcome.hits.length ? { shown: outcome.hits.length, total: outcome.total } : null;
}

/** Why a hit cannot be picked in a league roster picker (add, substitute, link). */
export type RosterUnavailable = 'onRoster' | 'selected' | 'inPhase' | 'outgoing' | 'guest';

/** Why a search hit cannot be picked, for the label beside its greyed-out name. */
export type PlayerUnavailable = RosterUnavailable | 'enrolled';

/** Roster "Add players": anyone not already on the roster or staged for it. */
export function unavailableForAdd(
  hit: PlayerSearchHit,
  rosterIds: ReadonlySet<string>,
  stagedIds: ReadonlySet<string>,
): RosterUnavailable | null {
  if (rosterIds.has(hit.id)) return 'onRoster';
  if (stagedIds.has(hit.id)) return 'selected';
  return null;
}

/**
 * A substitution's replacement comes from outside the roster; for one phase,
 * also not from players already enrolled there (`enrolledInScope` is empty for
 * a league-wide substitution), and never the player being replaced.
 */
export function unavailableForSubstitute(
  hit: PlayerSearchHit,
  outId: string | undefined,
  rosterIds: ReadonlySet<string>,
  enrolledInScope: ReadonlySet<string>,
): RosterUnavailable | null {
  if (hit.id === outId) return 'outgoing';
  if (rosterIds.has(hit.id)) return 'onRoster';
  if (enrolledInScope.has(hit.id)) return 'inPhase';
  return null;
}

/**
 * A guest links to an account: not another guest, not the guest itself. The
 * link picker searches with `registeredOnly`, so the server already drops
 * players without a Discord or email login and banned or suspended accounts
 * (the claim refuses them as a source); the hit carries no identity or status
 * columns, so the client cannot tell them apart.
 */
export function unavailableForLink(hit: PlayerSearchHit, guestId: string | undefined): RosterUnavailable | null {
  return hit.id === guestId || hit.is_guest ? 'guest' : null;
}

/** Tournament / phase enrolment: anyone not already enrolled (the server still decides duplicates and locked brackets). */
export function unavailableForEnrolment(hit: PlayerSearchHit, enrolledIds: ReadonlySet<string>): 'enrolled' | null {
  return enrolledIds.has(hit.id) ? 'enrolled' : null;
}
