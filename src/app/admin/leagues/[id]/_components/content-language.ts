import type { ApiResult } from '@/types/api';
import type { Locale } from '@/i18n/config';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';

/**
 * PATCHes only `{ language }` to /api/seasons/[id] (requireResourceAdmin-guarded,
 * seasonUpdateSchema-validated). Resolves with `null` on success, else the API
 * error (`{ error, code, params }`) or a network failure as `ApiErrorLike`.
 */
export async function patchContentLanguage(
  seasonId: string,
  language: Locale,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiErrorLike | null> {
  try {
    const res = await fetchImpl(`/api/seasons/${encodeURIComponent(seasonId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language }),
    });
    const data: ApiResult<unknown> = await res.json();
    return data.success ? null : data;
  } catch (err) {
    return toApiErrorLike(err);
  }
}
