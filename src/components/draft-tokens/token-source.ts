/**
 * The token port (draft-frontend §6.2): BE §8.1 #25 (overview), #26 (buy one
 * Draft Kill Token) and #27 (spend Comeback Tokens). The dev preview injects
 * an in-memory implementation of the same interface (DF3 `fake-source.ts`).
 *
 * Client-safe (plain `fetch`, no React). Failures are values (`ApiCall`),
 * rendered with `useApiErrorText(errorsDraft)`; nothing here produces text.
 * Both writes answer with the player's fresh `TokenOverviewDTO`.
 */
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import type { LineId, TokenOverviewDTO } from '@/types/draft-queue';
import type { ApiCall } from '@/components/draft-tool/data-source';
import type { ComebackAllocation } from './token-view';

export interface TokenSource {
  /** `playerId` = admin view of another player (read only). */
  overview(playerId?: string): Promise<ApiCall<TokenOverviewDTO>>;
  /**
   * Every participant's overview in one request (BE §8.1 #25b, season admins only;
   * `TokenAdminSummary`). Optional so in-memory sources may omit it: callers then
   * fall back to `overview(playerId)` per player.
   */
  overviewAll?(): Promise<ApiCall<TokenOverviewDTO[]>>;
  buyDraftKill(lineId: LineId, requestId: string): Promise<ApiCall<TokenOverviewDTO>>;
  spendComeback(allocs: ComebackAllocation[], requestId: string): Promise<ApiCall<TokenOverviewDTO>>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNullableNumber(v: unknown): v is number | null {
  return v === null || isNumber(v);
}

function isPositiveInt(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 1;
}

function isDraftKill(v: unknown): v is TokenOverviewDTO['draft_kill'] {
  return (
    isRecord(v) &&
    (v.window === 'before' || v.window === 'open' || v.window === 'closed') &&
    (v.cutoff_at === null || typeof v.cutoff_at === 'string') &&
    isNumber(v.cost) &&
    isNumber(v.max) &&
    isNumber(v.owned) &&
    isNumber(v.unspent_points) &&
    Array.isArray(v.lines) &&
    v.lines.every(
      (l) =>
        isRecord(l) &&
        typeof l.line_id === 'string' &&
        typeof l.has_token === 'boolean' &&
        isPositiveInt(l.tokens_used) &&
        isNumber(l.cost) &&
        isNumber(l.progress) &&
        isNullableNumber(l.next_threshold) &&
        typeof l.eligible === 'boolean' &&
        (l.reason === null || typeof l.reason === 'string'),
    )
  );
}

function isComeback(v: unknown): v is TokenOverviewDTO['comeback'] {
  return (
    isRecord(v) &&
    isNumber(v.earned) &&
    isNumber(v.spent) &&
    isNumber(v.unspent) &&
    typeof v.spend_open === 'boolean' &&
    (v.earn_window === 'season' || v.earn_window === 'first_half') &&
    Array.isArray(v.history) &&
    v.history.every((h) => isRecord(h) && isNumber(h.matchday) && typeof h.score === 'string' && isNumber(h.tokens))
  );
}

function isCosmo(v: unknown): v is TokenOverviewDTO['cosmo'] {
  return (
    v === null ||
    (isRecord(v) &&
      typeof v.line_id === 'string' &&
      isNumber(v.tokens) &&
      Array.isArray(v.matchdays_brought) &&
      v.matchdays_brought.every(isNumber))
  );
}

function isLine(v: unknown): v is TokenOverviewDTO['lines'][number] {
  return (
    isRecord(v) &&
    typeof v.line_id === 'string' &&
    (v.stage === 1 || v.stage === 2 || v.stage === 3) &&
    isNumber(v.self_earned_kills) &&
    isNumber(v.transferred_evo_progress) &&
    isNumber(v.draft_token_progress) &&
    isNumber(v.comeback_token_progress) &&
    isNumber(v.cosmo_token_progress) &&
    isNumber(v.total_progress) &&
    isNullableNumber(v.next_threshold) &&
    isPositiveInt(v.comeback_tokens_per_progress)
  );
}

/** Shape guard for `TokenOverviewDTO` (exported for tests). */
export function isTokenOverview(v: unknown): v is TokenOverviewDTO {
  return (
    isRecord(v) &&
    typeof v.season_id === 'string' &&
    typeof v.player_id === 'string' &&
    typeof v.initial_draft_complete === 'boolean' &&
    typeof v.redraft_complete === 'boolean' &&
    isDraftKill(v.draft_kill) &&
    isComeback(v.comeback) &&
    isCosmo(v.cosmo) &&
    Array.isArray(v.lines) &&
    v.lines.every(isLine)
  );
}

function errorOf(body: unknown): ApiErrorLike {
  const err = toApiErrorLike(body);
  return err.error !== undefined || err.code !== undefined ? err : { code: 'unknown_error' };
}

/** `{ overviews: TokenOverviewDTO[] }` payload of BE #25b, unwrapped (exported for tests). */
export function parseOverviewList(v: unknown): TokenOverviewDTO[] | null {
  if (!isRecord(v) || !Array.isArray(v.overviews)) return null;
  const out: TokenOverviewDTO[] = [];
  for (const item of v.overviews as unknown[]) {
    if (!isTokenOverview(item)) return null;
    out.push(item);
  }
  return out;
}

function call(url: string, init: RequestInit): Promise<ApiCall<TokenOverviewDTO>> {
  return request(url, init, (data) => (isTokenOverview(data) ? data : null));
}

async function request<T>(url: string, init: RequestInit, parse: (data: unknown) => T | null): Promise<ApiCall<T>> {
  try {
    const res = await fetch(url, { ...init, cache: 'no-store' });
    let body: unknown = null;
    try {
      body = (await res.json()) as unknown;
    } catch {
      body = null;
    }
    const data = isRecord(body) && body.success === true ? body.data : undefined;
    const parsed = res.ok ? parse(data) : null;
    if (parsed !== null) return { ok: true, data: parsed };
    return { ok: false, error: errorOf(body) };
  } catch (e) {
    return { ok: false, error: toApiErrorLike(e) };
  }
}

function post(url: string, body: unknown): Promise<ApiCall<TokenOverviewDTO>> {
  return call(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The HTTP implementation for one season. */
export function createHttpTokenSource(seasonId: string): TokenSource {
  const base = `/api/seasons/${encodeURIComponent(seasonId)}`;
  return {
    overview(playerId) {
      const query = playerId ? `?player_id=${encodeURIComponent(playerId)}` : '';
      return call(`${base}/tokens/me${query}`, { method: 'GET' });
    },
    overviewAll() {
      return request(`${base}/tokens`, { method: 'GET' }, parseOverviewList);
    },
    buyDraftKill(lineId, requestId) {
      return post(`${base}/draft-kill-tokens`, { line_id: lineId, client_request_id: requestId });
    },
    spendComeback(allocs, requestId) {
      return post(`${base}/comeback-tokens/spend`, {
        allocations: allocs.map((a) => ({ line_id: a.line_id, count: a.tokens })),
        client_request_id: requestId,
      });
    },
  };
}
