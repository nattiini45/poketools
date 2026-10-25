import type { ApiResult } from '@/types/api';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import type { LeagueSettingsPatch } from '@/lib/league-admin/settings-patch';

/**
 * PATCHes only the changed league details to /api/seasons/[id] (requireResourceAdmin-guarded,
 * seasonUpdateSchema-validated; the route refuses a league type change after the league started).
 * Resolves with `null` on success, else the API error (`{ error, code, params }`) or a network
 * failure as `ApiErrorLike`.
 */
export async function patchLeagueSettings(
  seasonId: string,
  patch: LeagueSettingsPatch,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiErrorLike | null> {
  try {
    const res = await fetchImpl(`/api/seasons/${encodeURIComponent(seasonId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data: ApiResult<unknown> = await res.json();
    return data.success ? null : data;
  } catch (err) {
    return toApiErrorLike(err);
  }
}
