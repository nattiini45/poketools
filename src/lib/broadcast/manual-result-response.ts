/**
 * Reads the body of a `POST /api/manual-result` response for the battle
 * tracker. Pure (no hooks, no fetch) so the tracker's branching is testable
 * without a DOM.
 *
 * - A failure keeps its API error (`error` / `code` / `params`), or `null`
 *   when the body carries neither, so the tracker shows its own fallback.
 * - A success carries the recorded game id and, when the server could not
 *   save something attached to the game (its marked moments), the catalogued
 *   warning: the game counts, and the caster sees what was lost.
 *
 * `submitManualResult` is the tracker's whole submit round trip (POST, body
 * read, outcome), with `fetch` injectable so tests drive it without a DOM.
 */
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';

export type ManualResultSubmitOutcome =
  | { ok: false; error: ApiErrorLike | null }
  | { ok: true; gameId: string | null; warning: ApiErrorLike | null };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function readManualResultResponse(body: unknown): ManualResultSubmitOutcome {
  if (!isRecord(body) || body.success !== true) {
    const error = toApiErrorLike(body);
    return { ok: false, error: error.error || error.code ? error : null };
  }
  const data = isRecord(body.data) ? body.data : {};
  const gameId = typeof data.game_id === 'string' ? data.game_id : null;
  let warning: ApiErrorLike | null = null;
  if (data.warning !== undefined) {
    const parsed = toApiErrorLike(data.warning);
    if (parsed.error || parsed.code) warning = parsed;
  }
  return { ok: true, gameId, warning };
}

/**
 * POSTs one tracked game to `/api/manual-result` and reads the outcome. A
 * thrown fetch or body read (network failure, non-JSON answer) is a failed
 * outcome carrying the normalised error, never a silent success.
 */
export async function submitManualResult(
  payload: unknown,
  fetchFn: typeof fetch = fetch
): Promise<ManualResultSubmitOutcome> {
  try {
    const res = await fetchFn('/api/manual-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return readManualResultResponse(await res.json());
  } catch (err) {
    return { ok: false, error: toApiErrorLike(err) };
  }
}

/** What changes the tracker's warning banner: a new submit, its outcome, or the caster's dismiss. */
export type TrackerWarningEvent =
  | { type: 'submit' }
  | { type: 'outcome'; outcome: ManualResultSubmitOutcome }
  | { type: 'dismiss' };

/**
 * The tracker's warning banner state (pure, so its wiring is tested without a
 * DOM): a new submit clears the previous warning, a recorded game with a
 * warning shows it, a failed submit shows none (the error line covers it),
 * and dismissing clears it.
 */
export function nextTrackerWarning(current: ApiErrorLike | null, event: TrackerWarningEvent): ApiErrorLike | null {
  switch (event.type) {
    case 'submit':
    case 'dismiss':
      return null;
    case 'outcome':
      return event.outcome.ok ? event.outcome.warning : current;
  }
}
