/**
 * What the Calc tab shows after one `/api/calc/batch` round trip.
 *
 * A non-success body (400 for an unknown attacker item, ability, nature or
 * Tera type, 429, 5xx) and a failed read both clear the previous attacker's
 * numbers and carry an error to render, so stale results never stay on
 * screen without a message.
 */
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import type { BatchCalcResponse, ThreatEntry } from '@/types/calc';

export type BatchCalcResults = BatchCalcResponse['data']['results'];

export type BatchCalcOutcome =
  | { results: BatchCalcResults; error: null }
  | { results: null; error: ApiErrorLike };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The outcome for a parsed response body. */
export function batchCalcOutcome(json: unknown): BatchCalcOutcome {
  if (isRecord(json) && json.success === true && isRecord(json.data) && Array.isArray(json.data.results)) {
    return { results: json.data.results as BatchCalcResults, error: null };
  }
  const error: ApiErrorLike = isRecord(json) ? toApiErrorLike(json) : {};
  // A body without an error or code (or not an API body at all) still gets a message.
  return { results: null, error: error.code || error.error ? error : { code: 'unknown_error' } };
}

/**
 * The outcome for a thrown fetch or body read: a fetch `TypeError` is a
 * network error; anything else (a non-JSON body) has no catalogued code.
 */
export function batchCalcFailure(thrown: unknown): BatchCalcOutcome {
  return {
    results: null,
    error: thrown instanceof TypeError ? toApiErrorLike(thrown) : { code: 'unknown_error' },
  };
}

/** The `fetch` shape the request helpers take (the global one by default; tests inject theirs). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const globalFetch: FetchLike = (input, init) => fetch(input, init);

/**
 * One `/api/calc/batch` round trip. `null` once `signal` is aborted: a newer
 * run (another attacker, move or field) superseded this one, so its answer must
 * not overwrite the newer numbers, whatever order the responses arrive in.
 */
export async function requestBatchCalc(
  body: unknown,
  signal: AbortSignal,
  fetchImpl: FetchLike = globalFetch,
): Promise<BatchCalcOutcome | null> {
  try {
    const res = await fetchImpl('/api/calc/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const json: unknown = await res.json();
    return signal.aborted ? null : batchCalcOutcome(json);
  } catch (thrown) {
    return signal.aborted ? null : batchCalcFailure(thrown);
  }
}

export type ThreatsOutcome = { threats: ThreatEntry[]; error: null } | { threats: null; error: ApiErrorLike };

/** The outcome for a parsed `/api/calc/threats` body. */
export function threatsOutcome(json: unknown): ThreatsOutcome {
  if (isRecord(json) && json.success === true && isRecord(json.data) && Array.isArray(json.data.threats)) {
    return { threats: json.data.threats as ThreatEntry[], error: null };
  }
  const error: ApiErrorLike = isRecord(json) ? toApiErrorLike(json) : {};
  return { threats: null, error: error.code || error.error ? error : { code: 'unknown_error' } };
}

/**
 * Load the meta threats of `format`. A failed load is an outcome with an
 * error to render (never swallowed); `null` once `signal` is aborted (the
 * format changed or the tab unmounted).
 */
export async function requestThreats(
  format: string,
  signal: AbortSignal,
  fetchImpl: FetchLike = globalFetch,
): Promise<ThreatsOutcome | null> {
  try {
    const res = await fetchImpl(`/api/calc/threats?format=${encodeURIComponent(format)}&limit=12`, { signal });
    const json: unknown = await res.json();
    return signal.aborted ? null : threatsOutcome(json);
  } catch (thrown) {
    if (signal.aborted) return null;
    return { threats: null, error: thrown instanceof TypeError ? toApiErrorLike(thrown) : { code: 'unknown_error' } };
  }
}
