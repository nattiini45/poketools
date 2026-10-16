import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';

/**
 * Why `POST /api/drafts` did not create a draft:
 * - `api`: the server refused it (its `code`), or the request never reached it
 *   (`toApiErrorLike` turns a fetch `TypeError` into `network_error`);
 * - `unreadable`: a non-2xx reply whose body is not JSON (e.g. a gateway error page).
 */
export type DraftCreateError = { kind: 'api'; error: ApiErrorLike } | { kind: 'unreadable' };

export type DraftCreateOutcome = { created: true } | { created: false; error: DraftCreateError };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * POSTs a create body to `/api/drafts`: the legacy `PoolCreateBody`
 * (`DraftPoolManager`) or the queue body `{ season_id, kind }` (EPB). Never
 * throws: even a missing `fetch` resolves as an `api` error.
 *
 * A 2xx reply means the draft exists unless its body says `success: false`,
 * whatever else the body holds (or when it cannot be read at all), so callers
 * re-render instead of reporting a failure that a retry would turn into
 * `POOL_EXISTS`. A non-2xx reply is a refusal unless its body says
 * `success: true`.
 */
export async function postDraftCreate(body: unknown, fetchImpl?: typeof fetch): Promise<DraftCreateOutcome> {
  let res: Response;
  try {
    res = await (fetchImpl ?? fetch)('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { created: false, error: { kind: 'api', error: toApiErrorLike(err) } };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return res.ok ? { created: true } : { created: false, error: { kind: 'unreadable' } };
  }
  const success = isRecord(json) ? json.success : undefined;
  if (success === true || (res.ok && success !== false)) return { created: true };
  return { created: false, error: { kind: 'api', error: toApiErrorLike(json) } };
}
