import type { ApiResult } from '@/types/api';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';

/**
 * PATCHes only `{ status }` to /api/tournaments/[id] (the endpoint "Mark
 * completed" uses). `'active'` on a completed phase or tournament reopens it:
 * the endpoint writes the status column only. Resolves with `null` on
 * success, else the API error (`{ error, code, params }`) or a network
 * failure as `ApiErrorLike`.
 */
export async function patchTournamentStatus(
  tournamentId: string,
  status: 'completed' | 'active',
  fetchImpl: typeof fetch = fetch,
): Promise<ApiErrorLike | null> {
  try {
    const res = await fetchImpl(`/api/tournaments/${encodeURIComponent(tournamentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data: ApiResult<unknown> = await res.json();
    return data.success ? null : data;
  } catch (err) {
    return toApiErrorLike(err);
  }
}
