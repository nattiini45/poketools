/**
 * The redraft submission port (draft-frontend §6.1): BE §8.1 #18 (GET own
 * submission) and #19 (PUT the full drop set; withdraw = `[]`). The dev
 * preview injects an in-memory implementation of the same interface (DF3
 * `fake-source.ts`).
 *
 * Client-safe (plain `fetch`, no React). Failures are values (`ApiCall`),
 * rendered with `useApiErrorText(errorsDraft)`; nothing here produces text.
 * The submission is secret until the deadline: it is only ever read here,
 * from the owner-guarded route, never server-rendered.
 */
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import type { LineId, RedraftSubmissionDTO } from '@/types/draft-queue';
import type { ApiCall } from '@/components/draft-tool/data-source';

export interface RedraftSource {
  getSubmission(): Promise<ApiCall<RedraftSubmissionDTO>>;
  putSubmission(lineIds: LineId[]): Promise<ApiCall<RedraftSubmissionDTO>>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isOwnLine(v: unknown): v is RedraftSubmissionDTO['own_lines'][number] {
  return (
    isRecord(v) &&
    typeof v.line_id === 'string' &&
    typeof v.real_kills === 'number' &&
    typeof v.price === 'number' &&
    typeof v.droppable === 'boolean'
  );
}

/** Shape guard for `RedraftSubmissionDTO` (exported for tests). */
export function isRedraftSubmission(v: unknown): v is RedraftSubmissionDTO {
  return (
    isRecord(v) &&
    Array.isArray(v.line_ids) &&
    v.line_ids.every((x) => typeof x === 'string') &&
    (v.updated_at === null || typeof v.updated_at === 'string') &&
    typeof v.locked === 'boolean' &&
    typeof v.deadline_at === 'string' &&
    typeof v.max === 'number' &&
    Array.isArray(v.own_lines) &&
    v.own_lines.every(isOwnLine) &&
    typeof v.leftover_budget === 'number'
  );
}

function errorOf(body: unknown): ApiErrorLike {
  const err = toApiErrorLike(body);
  return err.error !== undefined || err.code !== undefined ? err : { code: 'unknown_error' };
}

async function call(url: string, init: RequestInit): Promise<ApiCall<RedraftSubmissionDTO>> {
  try {
    const res = await fetch(url, { ...init, cache: 'no-store' });
    let body: unknown = null;
    try {
      body = (await res.json()) as unknown;
    } catch {
      body = null;
    }
    const data = isRecord(body) && body.success === true ? body.data : undefined;
    if (res.ok && isRedraftSubmission(data)) return { ok: true, data };
    return { ok: false, error: errorOf(body) };
  } catch (e) {
    return { ok: false, error: toApiErrorLike(e) };
  }
}

/** The HTTP implementation for one redraft pool. */
export function createHttpRedraftSource(poolId: string): RedraftSource {
  const url = `/api/drafts/${encodeURIComponent(poolId)}/redraft/submission`;
  return {
    getSubmission() {
      return call(url, { method: 'GET' });
    },
    putSubmission(lineIds) {
      return call(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_ids: lineIds }),
      });
    },
  };
}
