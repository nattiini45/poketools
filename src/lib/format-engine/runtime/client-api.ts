/**
 * The player-side request layer of a running kit league: one small function per route of the live-format surface, each over
 * the studio core's `request` with an injectable `fetch` so the tests run without a network. Client-safe: library types and
 * the core's request layer only, no server code (every import of a server module below is `import type`, erased).
 *
 * Every function resolves to an `ApiOutcome` and never throws: a failed response gives the server's `code` and `params`
 * (the UI renders them with `useApiErrorText`), a request that never reached the server gives `network_error` with
 * status 0. A failed save or submit also carries the problems of the pick (`issues`), read by an `extras` hook of
 * `request`. Every path segment is URL-encoded. There are no retries here (the UI decides) and a body is never logged.
 */
import type { ApiErrorLike } from '@/i18n/api-errors';
import type { ActionIssue } from './actions';
import type { RefusalCode } from './refusal';
import type { ChallengeResponse, PlayerFormatView, SubmissionResponse } from './view-types';
import type { FormatChallengeErrorCode } from '@/lib/supabase/queries/format-challenges';
import type { FormatRuntimeErrorCode } from '@/lib/supabase/queries/format-runtime';
import type { ActionPick } from './types';
import { makeClassifier, request, type ApiErrorKind, type ClassifiedError, type ApiOutcome, type ErrorExtras, type FetchLike } from '@/lib/studio-core/request';

/** A failed save or submit: the usual members plus the problems of the pick (`format_action_invalid`, status 422/404/409/403). */
export interface ActionApiError extends ApiErrorLike {
  issues?: ActionIssue[];
}

/** The outcome of a save or submit. */
export type ActionOutcome = ApiOutcome<SubmissionResponse, ActionApiError>;

export type ChallengeWithdrawAs = 'self' | 'admin';

// ─── Routes ──────────────────────────────────────────────────────────────────────────────────────

const base = (seasonId: string): string => `/api/seasons/${encodeURIComponent(seasonId)}/format`;

const isIssue = (value: unknown): value is ActionIssue =>
  typeof value === 'object' && value !== null && typeof (value as { code?: unknown }).code === 'string';

/** Copies the problems of a rejected pick (`body.issues`) when the body has them in the right shape. */
const issuesOf: ErrorExtras<ActionApiError> = (body) => {
  const issues = typeof body === 'object' && body !== null ? (body as { issues?: unknown }).issues : undefined;
  return Array.isArray(issues) && issues.every(isIssue) ? { issues: issues.map(copyIssue) } : {};
};

function copyIssue(issue: ActionIssue): ActionIssue {
  const out: ActionIssue = { code: issue.code };
  const { step, item_id: itemId } = issue as { step?: unknown; item_id?: unknown };
  if (typeof step === 'number') out.step = step;
  if (typeof itemId === 'string') out.item_id = itemId;
  return out;
}

const picksBody = (picks: readonly ActionPick[]): { picks: ActionPick[] } => ({
  picks: picks.map((pick) => ({ step: pick.step, item_id: pick.item_id })),
});

// ─── Routes ──────────────────────────────────────────────────────────────────────────────────────

/** `GET /api/seasons/{id}/format/me`: the viewer's whole live view; the single read and the single reload path of the player page. */
export function loadMyFormatView(seasonId: string, f?: FetchLike): Promise<ApiOutcome<PlayerFormatView>> {
  return request<PlayerFormatView>(f, 'GET', `${base(seasonId)}/me`);
}

/** `PUT /api/seasons/{id}/format/actions/{actionId}`: save a draft pick (refused with `format_action_already_submitted` for a submitted one). */
export function saveActionRequest(
  seasonId: string,
  actionId: string,
  picks: readonly ActionPick[],
  f?: FetchLike,
): Promise<ActionOutcome> {
  return request<SubmissionResponse, ActionApiError>(f, 'PUT', `${base(seasonId)}/actions/${encodeURIComponent(actionId)}`, picksBody(picks), issuesOf);
}

/** `POST /api/seasons/{id}/format/actions/{actionId}/submit`: submit a pick (idempotent: it replaces the viewer's own). */
export function submitActionRequest(
  seasonId: string,
  actionId: string,
  picks: readonly ActionPick[],
  f?: FetchLike,
): Promise<ActionOutcome> {
  return request<SubmissionResponse, ActionApiError>(
    f,
    'POST',
    `${base(seasonId)}/actions/${encodeURIComponent(actionId)}/submit`,
    picksBody(picks),
    issuesOf,
  );
}

/** `POST /api/seasons/{id}/format/challenges`: the viewer challenges `defenderId` in the ladder phase `phaseId`. */
export function makeChallengeRequest(
  seasonId: string,
  phaseId: string,
  defenderId: string,
  f?: FetchLike,
): Promise<ApiOutcome<ChallengeResponse>> {
  return request<ChallengeResponse>(f, 'POST', `${base(seasonId)}/challenges`, { phase_id: phaseId, defender_id: defenderId });
}

/** `POST /api/seasons/{id}/format/challenges/{challengeId}/answer`: the defender accepts or declines. */
export function answerChallengeRequest(
  seasonId: string,
  challengeId: string,
  accept: boolean,
  f?: FetchLike,
): Promise<ApiOutcome<ChallengeResponse>> {
  return request<ChallengeResponse>(f, 'POST', `${base(seasonId)}/challenges/${encodeURIComponent(challengeId)}/answer`, { accept });
}

/** `DELETE /api/seasons/{id}/format/challenges/{challengeId}?as=self|admin`: withdraw an OPEN challenge. */
export function withdrawChallengeRequest(
  seasonId: string,
  challengeId: string,
  as: ChallengeWithdrawAs,
  f?: FetchLike,
): Promise<ApiOutcome<ChallengeResponse>> {
  return request<ChallengeResponse>(f, 'DELETE', `${base(seasonId)}/challenges/${encodeURIComponent(challengeId)}?as=${as}`);
}

// ─── Error classes ───────────────────────────────────────────────────────────────────────────────

/** The path-id codes of the live-format routes. */
type PathIdCode = 'INVALID_SEASON_ID' | 'INVALID_CHALLENGE_ID' | 'INVALID_CHECK_ID';

/**
 * Every code a live-format route answers with, besides the ones every route knows (`rate_limited`, `validation_failed`,
 * `unauthenticated`, `forbidden`, `network_error`). A `Record` over this union makes a new code a type error until it is
 * classified.
 */
export type FormatRuntimeApiCode =
  | RefusalCode
  | FormatRuntimeErrorCode
  | FormatChallengeErrorCode
  | 'format_action_invalid'
  | PathIdCode;

/**
 * The class of every code: `conflict` = refresh the view, then retry; `invalid` = the request itself is wrong; `forbidden`;
 * `not_found`; `too_large`.
 */
const FORMAT_RUNTIME_CODE_KINDS: Readonly<Record<FormatRuntimeApiCode, ApiErrorKind>> = {
  // refresh the view, then retry
  action_locked: 'conflict',
  resource_item_taken: 'conflict',
  resource_capacity_reached: 'conflict',
  format_context_stale: 'conflict',
  domain_amendment_locked: 'conflict',
  challenge_not_open: 'conflict',
  challenge_expired: 'conflict',
  challenge_player_not_enrolled: 'conflict',
  challenge_not_found: 'conflict',
  challenge_no_open_round: 'conflict',
  challenge_phase_closed: 'conflict',
  challenge_max_open: 'conflict',
  challenge_already_open: 'conflict',
  challenge_cooldown: 'conflict',
  challenge_not_ladder: 'conflict',
  format_check_not_open: 'conflict',
  format_not_running: 'conflict',
  format_action_already_submitted: 'conflict',
  format_season_closed: 'conflict',
  format_adjust_insufficient_holding: 'conflict',
  format_adjust_amendment_limit: 'conflict',
  format_adjust_relation_has_links: 'conflict',
  format_adjust_action_unchanged: 'conflict',
  format_adjust_domain_in_use: 'conflict',
  // the request itself is wrong
  format_action_invalid: 'invalid',
  format_adjust_not_allowed: 'invalid',
  format_adjust_unknown_target: 'invalid',
  format_adjust_invalid_amount: 'invalid',
  format_adjust_invalid_links: 'invalid',
  format_adjust_invalid_order: 'invalid',
  format_adjust_unknown_item: 'invalid',
  format_adjust_item_required: 'invalid',
  format_adjust_item_not_allowed: 'invalid',
  format_adjust_attr_missing: 'invalid',
  format_adjust_domain_too_large: 'invalid',
  challenge_self: 'invalid',
  challenge_rank_range: 'invalid',
  challenge_not_participant: 'invalid',
  challenge_phase_not_found: 'not_found',
  reason_required: 'invalid',
  reason_too_long: 'invalid',
  // not allowed for this viewer
  format_not_participant: 'forbidden',
  challenge_not_defender: 'forbidden',
  challenge_not_challenger: 'forbidden',
  // not there
  format_action_unknown: 'not_found',
  format_check_not_found: 'not_found',
  INVALID_SEASON_ID: 'not_found',
  INVALID_CHALLENGE_ID: 'not_found',
  INVALID_CHECK_ID: 'not_found',
  // too big
  format_request_too_large: 'too_large',
};

/**
 * The runtime has no revisions, so `stale_revision` cannot happen: the classifier is given this code, which no route
 * ever sends.
 */
export const FORMAT_RUNTIME_NO_REVISION_CODE = 'format_runtime_no_revision';

const classifyByCode = makeClassifier({
  codeKinds: FORMAT_RUNTIME_CODE_KINDS,
  staleRevisionCode: FORMAT_RUNTIME_NO_REVISION_CODE,
});

/**
 * The statuses under which a rejected pick (`format_action_invalid`) says the league changed, not that the pick is wrong
 * (`actionRejectedStatus`): 404 the action is gone, 403 the player lost their link, 409 the format is not running, the
 * window closed or an item was taken meanwhile. Only a 422 is a pick that is wrong in itself.
 */
const STALE_PICK_STATUSES: ReadonlySet<number> = new Set([403, 404, 409]);

/**
 * Sorts an API error of a live-format route into a class the UI reacts to (a refresh-and-retry hint, a sign-in prompt, ...).
 * One code covers every rejected pick, so for `format_action_invalid` the status decides: a stale-state status is a
 * `conflict` (the player view is reloaded, the draft stays), a 422 stays `invalid`.
 */
export function classifyFormatRuntimeError(error: ApiErrorLike, status?: number): ClassifiedError {
  if (error.code === 'format_action_invalid' && status !== undefined && STALE_PICK_STATUSES.has(status)) return { kind: 'conflict' };
  return classifyByCode(error, status);
}
