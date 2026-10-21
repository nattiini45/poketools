/**
 * The admin panel's write port (draft-frontend §7.1): one function per admin
 * route of draft-backend §8.1 (#1, #3–#6, #11, #12, #14, #20–#23, #28; #13 is retired) plus the
 * audit read (#15). The only module of `draft-admin` that knows these URLs.
 *
 * Client-safe (plain `fetch`, no React). Failures are values: every API
 * error becomes an `ApiErrorLike` (a network failure becomes
 * `network_error`), rendered with `useApiErrorText(errorsDraft)`. Callers
 * `refresh()` the snapshot after a successful write. Nothing here produces
 * display text.
 */
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import type { ApiCall } from '@/components/draft-tool/data-source';
import type { DraftSnapshotDTO } from '@/lib/draft-ui/snapshot-types';
import type {
  AdminRedraftSubmissionsDTO,
  AdminSubmissionDTO,
  AuditEntryDTO,
  DraftAuditAction,
  DraftConfigInput,
  LineId,
} from '@/types/draft-queue';

export type { ApiCall };

/** Most admin writes answer `{ state_version }`. */
export interface StateVersion {
  state_version: number;
}

/** BE #21 `PATCH /api/drafts/[id]/redraft` (submission phase only; no `open` field). */
export interface RedraftPatch {
  deadline_at?: string;
  redraft_max_lines?: number;
  participant_order?: string[];
}

export interface AuditQuery {
  actions?: readonly DraftAuditAction[];
  player?: string | null;
  cursor?: string | null;
  limit?: number;
}

export interface AuditPage {
  entries: AuditEntryDTO[];
  next_cursor: string | null;
}

export interface AdminDraftActions {
  /** BE #1: a redraft pool for the season (`force` skips the first-half check). */
  createRedraft(force: boolean): Promise<ApiCall<{ pool_id: string }>>;
  /** BE #3 (setup / redraft submission phase). */
  saveConfig(input: DraftConfigInput): Promise<ApiCall<StateVersion>>;
  /** BE #21. */
  patchRedraft(body: RedraftPatch): Promise<ApiCall<StateVersion>>;
  start(): Promise<ApiCall<StateVersion>>;
  end(reason: string): Promise<ApiCall<StateVersion>>;
  pause(paused: boolean, reason?: string): Promise<ApiCall<StateVersion>>;
  /** BE #11: always `requeue: true` (no forfeit). */
  voidPick(pickId: string, reason: string): Promise<ApiCall<StateVersion>>;
  correctPick(
    pickId: string,
    lineId: LineId,
    reason: string,
    requestId: string,
    redraftSlotId?: string,
  ): Promise<ApiCall<StateVersion>>;
  setPenalty(playerId: string, stage: number, reason: string): Promise<ApiCall<StateVersion>>;
  /** BE #20: every player's submission (contents visible to admins). */
  /** Every player's Redraft drop list plus the pool's refused automatic publish (`publish_refused_at`). */
  submissions(): Promise<ApiCall<AdminRedraftSubmissionsDTO>>;
  publishRedraft(input: { force: boolean; reason?: string }): Promise<ApiCall<StateVersion & { drops: number }>>;
  restoreDrop(redraftSlotId: string, reason: string): Promise<ApiCall<StateVersion>>;
  /** BE #28 (season-scoped). */
  setComebackOpen(open: boolean): Promise<ApiCall<{ open: boolean }>>;
  /** BE #15 (read). */
  audit(query: AuditQuery): Promise<ApiCall<AuditPage>>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function errorOf(body: unknown): ApiErrorLike {
  const err = toApiErrorLike(body);
  return err.error !== undefined || err.code !== undefined ? err : { code: 'unknown_error' };
}

/** Same shape check as the room's data source: a rule error may carry a fresh snapshot. */
function snapshotOf(body: unknown): DraftSnapshotDTO | undefined {
  const v = isRecord(body) ? body.snapshot : undefined;
  return isRecord(v) &&
    typeof v.state_version === 'number' &&
    typeof v.server_now === 'string' &&
    isRecord(v.pool) &&
    Array.isArray(v.participants) &&
    isRecord(v.viewer)
    ? (v as unknown as DraftSnapshotDTO)
    : undefined;
}

type Accept<T> = (data: unknown) => data is T;

/** Sends one request; `{ success: true, data }` + 2xx + a matching shape is the only success. */
export async function adminCall<T>(
  url: string,
  method: 'GET' | 'POST' | 'PATCH',
  body: unknown,
  accept: Accept<T>,
): Promise<ApiCall<T>> {
  try {
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed: unknown = null;
    try {
      parsed = (await res.json()) as unknown;
    } catch {
      parsed = null;
    }
    const data = isRecord(parsed) && parsed.success === true ? parsed.data : undefined;
    if (res.ok && accept(data)) return { ok: true, data };
    const snapshot = snapshotOf(parsed);
    return snapshot ? { ok: false, error: errorOf(parsed), snapshot } : { ok: false, error: errorOf(parsed) };
  } catch (e) {
    return { ok: false, error: toApiErrorLike(e) };
  }
}

export function isStateVersion(v: unknown): v is StateVersion {
  return isRecord(v) && typeof v.state_version === 'number';
}

function isPublishResult(v: unknown): v is StateVersion & { drops: number } {
  return isRecord(v) && typeof v.state_version === 'number' && typeof v.drops === 'number';
}

function isPoolCreated(v: unknown): v is { pool_id: string } {
  return isRecord(v) && typeof v.pool_id === 'string';
}

function isOpenResult(v: unknown): v is { open: boolean } {
  return isRecord(v) && typeof v.open === 'boolean';
}

export function isAdminSubmissionList(v: unknown): v is AdminSubmissionDTO[] {
  return (
    Array.isArray(v) &&
    v.every(
      (s) =>
        isRecord(s) &&
        typeof s.player_id === 'string' &&
        Array.isArray(s.line_ids) &&
        typeof s.updated_at === 'string',
    )
  );
}

/** `GET …/redraft/submissions`: `{ submissions, publish_refused_at }` (an instant or null). */
export function isAdminRedraftSubmissions(v: unknown): v is AdminRedraftSubmissionsDTO {
  return (
    isRecord(v) &&
    isAdminSubmissionList(v.submissions) &&
    (v.publish_refused_at === null || typeof v.publish_refused_at === 'string')
  );
}

export function isAuditPage(v: unknown): v is AuditPage {
  return (
    isRecord(v) &&
    Array.isArray(v.entries) &&
    v.entries.every((e) => isRecord(e) && typeof e.id === 'string' && typeof e.action === 'string') &&
    (v.next_cursor === null || typeof v.next_cursor === 'string')
  );
}

/** The audit query string (repeatable `action`). Exported for tests. */
export function auditQueryString(query: AuditQuery): string {
  const params = new URLSearchParams();
  for (const action of query.actions ?? []) params.append('action', action);
  if (query.player) params.set('player', query.player);
  if (query.cursor) params.set('cursor', query.cursor);
  params.set('limit', String(query.limit ?? 50));
  return params.toString();
}

/** BE #28: open or close Comeback Token spending for a season (no pool needed, used by `TokenAdminSummary`). */
export function setComebackSpendOpen(seasonId: string, open: boolean): Promise<ApiCall<{ open: boolean }>> {
  return adminCall(`/api/seasons/${encodeURIComponent(seasonId)}/comeback-tokens/open`, 'POST', { open }, isOpenResult);
}

/**
 * The writes of one pool. `seasonGroupId`: the league group of that pool (null in a league without groups). Its
 * "Create Redraft" names that group (`POST /api/drafts` refuses a Redraft without a group in a league with groups,
 * SEASON_GROUP_REQUIRED), so the Redraft is the group's own; a league without groups sends the body as before.
 */
export function createAdminDraftActions(
  poolId: string,
  seasonId: string,
  seasonGroupId: string | null = null,
): AdminDraftActions {
  const base = `/api/drafts/${encodeURIComponent(poolId)}`;
  const post = <T>(url: string, body: unknown, accept: Accept<T>) => adminCall(url, 'POST', body, accept);

  return {
    createRedraft(force) {
      const body = {
        season_id: seasonId,
        kind: 'redraft',
        ...(force ? { force: true } : {}),
        ...(seasonGroupId ? { season_group_id: seasonGroupId } : {}),
      };
      return post('/api/drafts', body, isPoolCreated);
    },
    saveConfig(input) {
      return adminCall(`${base}/config`, 'PATCH', input, isStateVersion);
    },
    patchRedraft(body) {
      return adminCall(`${base}/redraft`, 'PATCH', body, isStateVersion);
    },
    start() {
      return post(`${base}/start`, {}, isStateVersion);
    },
    end(reason) {
      return post(`${base}/end`, { reason }, isStateVersion);
    },
    pause(paused, reason) {
      const trimmed = reason?.trim();
      return post(`${base}/pause`, trimmed ? { paused, reason: trimmed } : { paused }, isStateVersion);
    },
    voidPick(pickId, reason) {
      return post(`${base}/picks/${encodeURIComponent(pickId)}/void`, { reason, requeue: true }, isStateVersion);
    },
    correctPick(pickId, lineId, reason, requestId, redraftSlotId) {
      const body = {
        line_id: lineId,
        reason,
        client_request_id: requestId,
        ...(redraftSlotId ? { redraft_slot_id: redraftSlotId } : {}),
      };
      return post(`${base}/picks/${encodeURIComponent(pickId)}/correct`, body, isStateVersion);
    },
    setPenalty(playerId, stage, reason) {
      return post(`${base}/participants/${encodeURIComponent(playerId)}/penalty`, { stage, reason }, isStateVersion);
    },
    submissions() {
      return adminCall(`${base}/redraft/submissions`, 'GET', undefined, isAdminRedraftSubmissions);
    },
    publishRedraft({ force, reason }) {
      const trimmed = reason?.trim();
      const body = force ? { force: true, ...(trimmed ? { reason: trimmed } : {}) } : {};
      return post(`${base}/redraft/publish`, body, isPublishResult);
    },
    restoreDrop(redraftSlotId, reason) {
      return post(`${base}/redraft/slots/${encodeURIComponent(redraftSlotId)}/restore`, { reason }, isStateVersion);
    },
    setComebackOpen(open) {
      return setComebackSpendOpen(seasonId, open);
    },
    audit(query) {
      return adminCall(`${base}/audit?${auditQueryString(query)}`, 'GET', undefined, isAuditPage);
    },
  };
}
