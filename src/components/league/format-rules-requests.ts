import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import type { FormatRules, FormatRulesFormData } from '@/types/format-rules';

/**
 * Requests of the format rules editor against /api/seasons/[id]/format-rules.
 *
 * The load result keeps "nothing configured yet" apart from "could not read": only a successful
 * answer that says there is no row is `empty` (and may offer the default rules). Anything else the
 * route or the network does is `failed`, so a failed read can never turn into an overwrite.
 */

export type FormatRulesLoadResult =
  | { kind: 'loaded'; rules: FormatRules }
  | { kind: 'empty' }
  | { kind: 'failed'; error: ApiErrorLike | null };

export type FormatRulesSaveResult = { ok: true; rules: FormatRules } | { ok: false; error: ApiErrorLike };

function formatRulesUrl(seasonId: string): string {
  return `/api/seasons/${encodeURIComponent(seasonId)}/format-rules`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** A stored row the form can be built from (the numbers and lists it reads are all there). */
function isFormatRules(value: unknown): value is FormatRules {
  return (
    isRecord(value) &&
    typeof value.draft_budget === 'number' &&
    typeof value.draft_picks === 'number' &&
    typeof value.draft_token_ratio === 'number' &&
    typeof value.draft_token_max === 'number' &&
    typeof value.draft_token_max_per_line === 'number' &&
    isStringList(value.banned_moves) &&
    isStringList(value.banned_items) &&
    isStringList(value.tiebreaker_order)
  );
}

/** The error a body carries, or null when it names none (the caller then shows its own fallback). */
function errorOf(body: unknown): ApiErrorLike | null {
  const error = toApiErrorLike(body);
  return error.error || error.code ? error : null;
}

/** The parsed JSON body, or `undefined` when the response is not JSON. */
async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * GET the league's format rules. `empty` only for an ok response that says `success: true, data: null`;
 * a network error, a non-JSON body, a refusal (401, 403, 500, not a point-buy league) and a row that
 * lacks the fields the form reads are all `failed`.
 */
export async function loadFormatRules(
  seasonId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FormatRulesLoadResult> {
  let res: Response;
  try {
    res = await fetchImpl(formatRulesUrl(seasonId));
  } catch (err) {
    return { kind: 'failed', error: errorOf(toApiErrorLike(err)) };
  }

  const body = await readJson(res);
  if (!res.ok || !isRecord(body) || body.success !== true) {
    return { kind: 'failed', error: errorOf(body) };
  }
  if (body.data === null) return { kind: 'empty' };
  if (!isFormatRules(body.data)) return { kind: 'failed', error: null };
  return { kind: 'loaded', rules: body.data };
}

/**
 * PUT the full rules object (requireResourceAdmin-guarded, formatRulesSchema-validated). Resolves
 * with the stored row, else the API error (`{ error, code, params }`) or a network failure as `ApiErrorLike`.
 */
export async function saveFormatRules(
  seasonId: string,
  payload: FormatRulesFormData,
  fetchImpl: typeof fetch = fetch,
): Promise<FormatRulesSaveResult> {
  let res: Response;
  try {
    res = await fetchImpl(formatRulesUrl(seasonId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, error: toApiErrorLike(err) };
  }

  const body = await readJson(res);
  if (res.ok && isRecord(body) && body.success === true && isFormatRules(body.data)) {
    return { ok: true, rules: body.data };
  }
  // An answer that is no JSON, or an ok answer without the stored row, is the generic failure.
  return { ok: false, error: errorOf(body) ?? { code: 'unknown_error' } };
}
