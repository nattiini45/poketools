/**
 * What the league trash page (`/admin/leagues/trash`) needs on the client, without touching the server-only queries:
 *
 * - the row and pending-rebuild views the server page hands to `LeagueTrashPanel`;
 * - `headlineCounts` (the counts column) and `isSchemaChanged` ("schema changed since delete");
 * - the two requests of the page (`requestLeagueRestore` = POST /api/admin/league-trash/[id]/restore, the answer is
 *   `LeagueRestoreResult` of that route; `requestLeagueRebuild` = POST .../rebuild, `LeagueRebuildRunResult`), parsed
 *   defensively into plain views, with the catalogued API error of a refusal. A network failure rejects;
 * - the page's state: `leagueTrashReducer` keeps the notices (restore outcomes with their warnings, rebuild results,
 *   errors) and which rows and pending rebuilds are done, so a refresh of the server data never loses what the
 *   superadmin still has to read.
 *
 * Pure and client-safe: no reads, no `server-only`.
 */
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { isRecord, type JsonRecord } from './json';
import { parseRestoreWarnings, type LeagueTrashRestoreWarning } from './restore-warnings';

/** The counts column: what the league held, from the captured row counts (table name -> rows). */
export interface LeagueTrashHeadlineCounts {
  players: number;
  phases: number;
  matches: number;
  games: number;
  draftPools: number;
}

/** One trashed league as the table shows it (the server page translates the format label). */
export interface LeagueTrashRowView {
  id: string;
  seasonId: string;
  name: string;
  formatLabel: string;
  deletedAt: string;
  deletedByName: string | null;
  purgeAfter: string;
  counts: LeagueTrashHeadlineCounts;
  /** The delete's derived-data rebuild was not confirmed: the league cannot be restored until it ran. */
  rebuildPending: boolean;
  /** The database schema changed after the delete (a restore checks the saved copy against it). */
  schemaChanged: boolean;
}

/** A rebuild after a delete or a restore that nobody confirmed yet. */
export interface LeagueTrashPendingView {
  kind: 'delete' | 'restore';
  trashId: string;
  seasonId: string;
  name: string;
  /** When the delete or the restore happened. */
  at: string;
}

/** Rows per captured table (`LeagueTrashCounts` of the queries). */
export type LeagueTrashCountsView = Readonly<Record<string, number>>;

export function headlineCounts(counts: LeagueTrashCountsView): LeagueTrashHeadlineCounts {
  const n = (rel: string) => counts[rel] ?? 0;
  return {
    players: n('season_participants'),
    phases: n('tournaments'),
    matches: n('matches'),
    games: n('games'),
    draftPools: n('draft_pools'),
  };
}

/**
 * True when the schema version stored at delete time differs from the current one. Unknown on either side (a database
 * without a migration ledger) is not a change.
 */
export function isSchemaChanged(atDelete: string | null, current: string | null): boolean {
  return atDelete !== null && current !== null && atDelete !== current;
}

/** Key of a pending rebuild (a trash id carries one delete rebuild and, after its restore, one restore rebuild). */
export function pendingKey(kind: 'delete' | 'restore', trashId: string): string {
  return `${kind}:${trashId}`;
}

// ─── Requests ────────────────────────────────────────────────────────────────

export interface LeagueRestoreView {
  seasonId: string;
  seasonName: string;
  /** Running drafts that came back paused; null when the restore was settled after a request deadline (unknown). */
  pausedPools: number | null;
  warnings: LeagueTrashRestoreWarning[];
  /** Null when the rebuild after the restore finished; otherwise it stays pending. */
  rebuildWarning: ApiErrorLike | null;
}

export interface LeagueRebuildView {
  kind: 'delete' | 'restore';
  rebuildWarning: ApiErrorLike | null;
}

/** `ok`: the route answered 2xx; `refused`: nothing happened (or not completely), with the catalogued error. */
export type LeagueTrashRequestOutcome<T> = { kind: 'ok'; value: T } | { kind: 'refused'; error: ApiErrorLike | null };

/** `data.rebuild_warning` of a route body (`DeleteRebuildWarning`), or null. */
function rebuildWarningOf(data: JsonRecord): ApiErrorLike | null {
  const warning = data.rebuild_warning;
  if (!isRecord(warning) || typeof warning.code !== 'string') return null;
  const params = isRecord(warning.params)
    ? Object.fromEntries(
        Object.entries(warning.params).filter(
          (entry): entry is [string, string | number] => typeof entry[1] === 'string' || typeof entry[1] === 'number',
        ),
      )
    : undefined;
  return {
    code: warning.code,
    ...(typeof warning.error === 'string' ? { error: warning.error } : {}),
    ...(params ? { params } : {}),
  };
}

async function post(endpoint: string, fetchImpl: typeof fetch): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetchImpl(endpoint, { method: 'POST' });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch (parseError) {
    // The status still decides the outcome; the unreadable body is logged, not hidden.
    console.error(`[league-trash] POST ${endpoint} answered ${res.status} with a body that is not JSON`, parseError);
  }
  return { ok: res.ok, status: res.status, body };
}

function refusal(body: unknown): { kind: 'refused'; error: ApiErrorLike | null } {
  const error = toApiErrorLike(body);
  return { kind: 'refused', error: error.error || error.code ? error : null };
}

const endpointOf = (trashId: string, action: 'restore' | 'rebuild') => `/api/admin/league-trash/${encodeURIComponent(trashId)}/${action}`;

/** Restores a league from the trash (superadmin). A network failure rejects. */
export async function requestLeagueRestore(
  trashId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LeagueTrashRequestOutcome<LeagueRestoreView>> {
  const { ok, body } = await post(endpointOf(trashId, 'restore'), fetchImpl);
  if (!ok) return refusal(body);
  const data = isRecord(body) && isRecord(body.data) ? body.data : null;
  if (!data || typeof data.season_id !== 'string') return { kind: 'refused', error: null };
  return {
    kind: 'ok',
    value: {
      seasonId: data.season_id,
      seasonName: typeof data.season_name === 'string' ? data.season_name : '',
      pausedPools: typeof data.paused_pools === 'number' ? data.paused_pools : null,
      warnings: parseRestoreWarnings(data.warnings),
      rebuildWarning: rebuildWarningOf(data),
    },
  };
}

/** Runs the derived-data rebuild a delete or restore left pending (superadmin). A network failure rejects. */
export async function requestLeagueRebuild(
  trashId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LeagueTrashRequestOutcome<LeagueRebuildView>> {
  const { ok, body } = await post(endpointOf(trashId, 'rebuild'), fetchImpl);
  if (!ok) return refusal(body);
  const data = isRecord(body) && isRecord(body.data) ? body.data : null;
  if (!data || (data.kind !== 'delete' && data.kind !== 'restore')) return { kind: 'refused', error: null };
  return { kind: 'ok', value: { kind: data.kind, rebuildWarning: rebuildWarningOf(data) } };
}

// ─── Page state ──────────────────────────────────────────────────────────────

/** The two things the page can do to a trashed league. */
export type LeagueTrashAction = 'restore' | 'rebuild';

/** What the superadmin still has to read after an action. Stores data, never translated text. */
export type LeagueTrashNotice =
  | { id: number; kind: 'restored'; trashId: string; restore: LeagueRestoreView }
  | { id: number; kind: 'rebuilt'; trashId: string; name: string; rebuild: LeagueRebuildView }
  | { id: number; kind: 'error'; action: LeagueTrashAction; name: string; error: ApiErrorLike | null };

export interface LeagueTrashPageState {
  /** Newest first. */
  notices: readonly LeagueTrashNotice[];
  /** Trash ids restored in this visit: their rows are gone from the table at once, before the data refreshes. */
  restored: readonly string[];
  /** Pending rebuilds that finished (`pendingKey`): off the pending list, off the row badge. */
  rebuilt: readonly string[];
  nextId: number;
}

export type LeagueTrashPageEvent =
  | { type: 'restored'; trashId: string; restore: LeagueRestoreView }
  | { type: 'rebuilt'; trashId: string; name: string; rebuild: LeagueRebuildView }
  | { type: 'failed'; action: LeagueTrashAction; name: string; error: ApiErrorLike | null }
  | { type: 'dismiss'; id: number };

export const INITIAL_LEAGUE_TRASH_STATE: LeagueTrashPageState = { notices: [], restored: [], rebuilt: [], nextId: 1 };

export function leagueTrashReducer(state: LeagueTrashPageState, event: LeagueTrashPageEvent): LeagueTrashPageState {
  switch (event.type) {
    case 'restored':
      return {
        ...state,
        notices: [{ id: state.nextId, kind: 'restored', trashId: event.trashId, restore: event.restore }, ...state.notices],
        restored: [...state.restored, event.trashId],
        // A restore rebuild that did not finish stays pending: it is listed by the refreshed server data.
        nextId: state.nextId + 1,
      };
    case 'rebuilt':
      return {
        ...state,
        notices: [{ id: state.nextId, kind: 'rebuilt', trashId: event.trashId, name: event.name, rebuild: event.rebuild }, ...state.notices],
        // A rebuild that came back with a warning is still pending.
        rebuilt: event.rebuild.rebuildWarning ? state.rebuilt : [...state.rebuilt, pendingKey(event.rebuild.kind, event.trashId)],
        nextId: state.nextId + 1,
      };
    case 'failed':
      return {
        ...state,
        notices: [{ id: state.nextId, kind: 'error', action: event.action, name: event.name, error: event.error }, ...state.notices],
        nextId: state.nextId + 1,
      };
    case 'dismiss':
      return { ...state, notices: state.notices.filter((notice) => notice.id !== event.id) };
  }
}
