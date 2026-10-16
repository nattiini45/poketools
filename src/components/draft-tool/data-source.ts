/**
 * The pick screen's data port (draft-frontend §5.1, §2.5). The only module
 * of the draft UI that knows the draft API URLs; the dev preview injects an
 * in-memory implementation of the same interface (DF3 `fake-source.ts`).
 *
 * Client-safe (plain `fetch`, no React). Failures are values: every API error
 * becomes an `ApiErrorLike` (`toApiErrorLike`; a network failure becomes
 * `network_error`), rendered with `useApiErrorText(errorsDraft)`. No method
 * here produces display text.
 */
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import type { DraftSearchIndex } from '@/lib/draft-finder/index-types';
import type { DraftSnapshotDTO, LineId, MyTurnDTO } from '@/lib/draft-ui/snapshot-types';

export type SnapshotResult =
  | { kind: 'full'; dto: DraftSnapshotDTO }
  | { kind: 'unchanged'; version: number; serverNow: string }
  /** 401/403: stop polling and fall back to the spectator view. */
  | { kind: 'auth' }
  | { kind: 'error'; error: ApiErrorLike };

/**
 * A my-turn read. `stop` (401/403/404/409: signed out, not a participant, no
 * such pool, pool gone) ends the watch; `error` (network, 5xx, bad payload) is
 * transient and the watch tries again on its next tick.
 */
export type MyTurnResult = { kind: 'ok'; dto: MyTurnDTO } | { kind: 'stop' } | { kind: 'error' };

/** The statuses that end the my-turn watch (retrying cannot change the answer). */
const MY_TURN_STOP_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 409]);

/** A write's outcome; a rule error may carry a fresh snapshot to apply first. */
export type ApiCall<T> = { ok: true; data: T } | { ok: false; error: ApiErrorLike; snapshot?: DraftSnapshotDTO };

export interface PickRequest {
  slot_id: string;
  line_id: LineId;
  /** Created when the confirm dialog opens; reused for retries (idempotent). */
  client_request_id: string;
  redraft_slot_id?: string;
  /** Admin pick-on-behalf (§5.10). */
  on_behalf_of?: string;
  override_reason?: string;
}

export interface PickResult {
  state_version: number;
  /** true when the server recognised `client_request_id` and replayed the earlier pick. */
  replay: boolean;
  /** Absent when the pick committed but the server's snapshot read failed; the caller refreshes. */
  snapshot?: DraftSnapshotDTO;
}

export interface ExtensionResult {
  deadline_at: string;
  state_version: number;
}

/**
 * `Index` is the search-index payload (DF1 `DraftSearchIndex` by default);
 * the port only transports it.
 */
export interface DraftDataSource<Index = DraftSearchIndex> {
  fetchSnapshot(since: number | null, signal: AbortSignal): Promise<SnapshotResult>;
  /** Never rejects; see `MyTurnResult` for which failures end the watch. */
  fetchMyTurn(signal: AbortSignal): Promise<MyTurnResult>;
  /** Rejects with a `DraftDataSourceError` on failure. */
  fetchIndex(url: string): Promise<Index>;
  /** [] on failure (favourites are a convenience). */
  getFavorites(): Promise<LineId[]>;
  setFavorite(lineId: LineId, on: boolean): Promise<ApiCall<LineId[]>>;
  postPick(body: PickRequest): Promise<ApiCall<PickResult>>;
  postExtension(kind: 'plus120' | 'plus60', slotId: string): Promise<ApiCall<ExtensionResult>>;
}

/** Thrown by `fetchIndex`; carries the API error for `useApiErrorText`. */
export class DraftDataSourceError extends Error {
  readonly apiError: ApiErrorLike;
  readonly status: number | null;

  constructor(apiError: ApiErrorLike, status: number | null) {
    super(apiError.error ?? apiError.code ?? 'draft data source request failed');
    this.name = 'DraftDataSourceError';
    this.apiError = apiError;
    this.status = status;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSnapshot(v: unknown): v is DraftSnapshotDTO {
  return (
    isRecord(v) &&
    typeof v.state_version === 'number' &&
    typeof v.server_now === 'string' &&
    isRecord(v.pool) &&
    Array.isArray(v.participants) &&
    isRecord(v.viewer)
  );
}

function isLineIdList(v: unknown): v is LineId[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/** `{ success: true, data }` → data; anything else → undefined. */
function dataOf(body: unknown): unknown {
  return isRecord(body) && body.success === true && 'data' in body ? body.data : undefined;
}

function errorOf(body: unknown): ApiErrorLike {
  const err = toApiErrorLike(body);
  return err.error !== undefined || err.code !== undefined ? err : { code: 'unknown_error' };
}

function snapshotOf(body: unknown): DraftSnapshotDTO | undefined {
  return isRecord(body) && isSnapshot(body.snapshot) ? body.snapshot : undefined;
}

type Send = { method: 'GET' | 'POST' | 'PUT'; body?: unknown; signal?: AbortSignal };

async function send(url: string, { method, body, signal }: Send): Promise<{ res: Response; body: unknown }> {
  const res = await fetch(url, {
    method,
    signal,
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { res, body: await readBody(res) };
}

async function call<T>(url: string, init: Send, accept: (data: unknown) => data is T): Promise<ApiCall<T>> {
  try {
    const { res, body } = await send(url, init);
    const data = dataOf(body);
    if (res.ok && accept(data)) return { ok: true, data };
    const snapshot = snapshotOf(body);
    return snapshot ? { ok: false, error: errorOf(body), snapshot } : { ok: false, error: errorOf(body) };
  } catch (e) {
    return { ok: false, error: toApiErrorLike(e) };
  }
}

function isPickResult(v: unknown): v is PickResult {
  return (
    isRecord(v) &&
    typeof v.state_version === 'number' &&
    typeof v.replay === 'boolean' &&
    (v.snapshot === undefined || isSnapshot(v.snapshot))
  );
}

function isExtensionResult(v: unknown): v is ExtensionResult {
  return isRecord(v) && typeof v.deadline_at === 'string' && typeof v.state_version === 'number';
}

function isFavorites(v: unknown): v is { line_ids: LineId[] } {
  return isRecord(v) && isLineIdList(v.line_ids);
}

function isMyTurn(v: unknown): v is MyTurnDTO {
  return isRecord(v) && typeof v.state_version === 'number' && typeof v.on_clock === 'boolean';
}

/**
 * The HTTP implementation (BE §8.1 routes #7–#10, #16, #17). Every route is
 * pool-scoped. `_seasonId` is ignored and only kept so existing callers
 * still type-check; drop it once they pass the pool id alone.
 */
export function createHttpDataSource<Index = DraftSearchIndex>(poolId: string, _seasonId?: string): DraftDataSource<Index> {
  const pool = encodeURIComponent(poolId);
  const base = `/api/drafts/${pool}`;

  return {
    async fetchSnapshot(since, signal) {
      const query = since === null ? '' : `?since=${encodeURIComponent(String(since))}`;
      try {
        const { res, body } = await send(`${base}/state${query}`, { method: 'GET', signal });
        if (res.status === 401 || res.status === 403) return { kind: 'auth' };
        const data = dataOf(body);
        if (res.ok && isRecord(data) && data.unchanged === true) {
          if (typeof data.state_version === 'number' && typeof data.server_now === 'string') {
            return { kind: 'unchanged', version: data.state_version, serverNow: data.server_now };
          }
        } else if (res.ok && isSnapshot(data)) {
          return { kind: 'full', dto: data };
        }
        return { kind: 'error', error: errorOf(body) };
      } catch (e) {
        return { kind: 'error', error: toApiErrorLike(e) };
      }
    },

    async fetchMyTurn(signal) {
      try {
        const { res, body } = await send(`${base}/my-turn`, { method: 'GET', signal });
        if (MY_TURN_STOP_STATUSES.has(res.status)) return { kind: 'stop' };
        const data = dataOf(body);
        return res.ok && isMyTurn(data) ? { kind: 'ok', dto: data } : { kind: 'error' };
      } catch {
        return { kind: 'error' };
      }
    },

    async fetchIndex(url) {
      let res: Response;
      let body: unknown;
      try {
        ({ res, body } = await send(url, { method: 'GET' }));
      } catch (e) {
        throw new DraftDataSourceError(toApiErrorLike(e), null);
      }
      if (!res.ok || !isRecord(body) || body.success === false) throw new DraftDataSourceError(errorOf(body), res.status);
      // The route may answer with the bare payload or inside the `{ success, data }` envelope.
      const payload = body.success === true && 'data' in body ? body.data : body;
      return payload as Index;
    },

    async getFavorites() {
      const result = await call(`${base}/favorites`, { method: 'GET' }, isFavorites);
      return result.ok ? result.data.line_ids : [];
    },

    async setFavorite(lineId, on) {
      const result = await call(
        `${base}/favorites`,
        { method: 'PUT', body: { line_id: lineId, favorite: on } },
        isFavorites,
      );
      return result.ok ? { ok: true, data: result.data.line_ids } : result;
    },

    postPick(body) {
      return call(`${base}/picks`, { method: 'POST', body }, isPickResult);
    },

    postExtension(kind, slotId) {
      return call(`${base}/extensions`, { method: 'POST', body: { kind, slot_id: slotId } }, isExtensionResult);
    },
  };
}
