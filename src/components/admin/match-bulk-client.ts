/**
 * Browser side of the matches list bulk actions: the batch request and the CSV download. Both return a typed
 * result instead of throwing, so the UI stores the error object and translates it at render.
 */
import type { AdminMatchBatchInput, AdminMatchBatchResponse } from '@/lib/admin/match-bulk';
import type { ApiResult } from '@/types/api';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { saveBlob } from '@/components/admin/save-blob';

/** What the response headers say about a finished export. */
export interface MatchExportInfo {
  /** Matches in the file. */
  count: number;
  /** Matches that fit the filters; more than `count` when the file was cut at the limit. */
  total: number;
  truncated: boolean;
  /** The player search matched more players than it expands, so the file is a partial result. */
  searchTruncated: boolean;
  fileName: string;
}

export type MatchExportResult = { ok: true; info: MatchExportInfo } | { ok: false; error: ApiErrorLike };

const NETWORK_ERROR: ApiResult<never> = { success: false, error: 'Network error', code: 'network_error' };
const FALLBACK_FILE_NAME = 'matches.csv';

/** `POST /api/admin/matches/batch`. A network or parse failure comes back as `{ code: 'network_error' }`. */
export async function postMatchBatch(
  body: AdminMatchBatchInput,
  signal?: AbortSignal,
): Promise<ApiResult<AdminMatchBatchResponse>> {
  try {
    const res = await fetch('/api/admin/matches/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    return (await res.json()) as ApiResult<AdminMatchBatchResponse>;
  } catch {
    // An aborted request lands here too; the caller checks its signal before it reads the answer.
    return NETWORK_ERROR;
  }
}

/** The file name of a `Content-Disposition: attachment; filename="..."` header, without any path part. */
export function fileNameFromDisposition(header: string | null): string {
  const quoted = header ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header)?.[1] : undefined;
  if (!quoted) return FALLBACK_FILE_NAME;
  let name = quoted;
  try {
    name = decodeURIComponent(quoted);
  } catch {
    // Keep the raw value.
  }
  const base = name.split(/[\\/]/).pop()?.trim();
  return base ? base : FALLBACK_FILE_NAME;
}

function numberHeader(headers: Headers, name: string): number {
  const value = Number(headers.get(name));
  return Number.isFinite(value) ? value : 0;
}

/**
 * `GET /api/admin/matches/export?<query>`: downloads the CSV of the filtered set. The route answers errors as JSON,
 * so a response that is not CSV is read as an `ApiResult` error. `query` is the list's own API query, so the file
 * holds what the screen filters.
 */
export async function downloadMatchExport(query: string, signal?: AbortSignal): Promise<MatchExportResult> {
  try {
    const res = await fetch(`/api/admin/matches/export${query ? `?${query}` : ''}`, { signal });
    const contentType = res.headers.get('Content-Type') ?? '';
    if (!contentType.toLowerCase().includes('text/csv')) {
      const result = (await res.json()) as ApiResult<unknown>;
      return { ok: false, error: result.success ? { code: 'unknown_error' } : toApiErrorLike(result) };
    }
    const fileName = fileNameFromDisposition(res.headers.get('Content-Disposition'));
    const blob = await res.blob();
    saveBlob(blob, fileName);
    return {
      ok: true,
      info: {
        count: numberHeader(res.headers, 'X-Export-Count'),
        total: numberHeader(res.headers, 'X-Export-Total'),
        truncated: res.headers.get('X-Export-Truncated') === 'true',
        searchTruncated: res.headers.has('X-Export-Search-Truncated'),
        fileName,
      },
    };
  } catch {
    return { ok: false, error: { code: 'network_error' } };
  }
}
