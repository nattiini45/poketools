/**
 * The refusals of the live-format routes that no database signal or class already carries: a plain `UserFacingError` per
 * code, built by `refuse(code)`. One status table (`FORMAT_REFUSALS`) is the whole contract: a `Record` over the code union
 * makes a missing status a type error. Every code is a key of the `errors/seasons` catalog (`en` is the English message,
 * `de` the German one), so a client renders it from `code`.
 *
 * `REFUSAL_OF_ISSUE` maps each `AdjustIssue` of `applyAdjustment` (an `ok: false` result, not an exception) to the refusal
 * the route throws into `safeErrorResponse`, so one code path answers every failure. It is a `Record` over the issue
 * union, so a new issue is a type error until it is mapped here.
 *
 * Not here: the action-issue body (`format_action_invalid`, built by `actionRejectedResponse`), the database signals
 * (`FormatRuntimeError`, `FormatChallengeError`) and the `INVALID_*_ID` path codes (`rejectInvalidPathId`).
 */
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { AdjustIssue } from './adjust';

export type RefusalCode =
  | 'format_not_running'
  | 'format_not_participant'
  | 'format_season_closed'
  | 'format_action_unknown'
  | 'format_action_already_submitted'
  | 'format_adjust_not_allowed'
  | 'format_adjust_unknown_target'
  | 'format_adjust_invalid_amount'
  | 'format_adjust_invalid_links'
  | 'format_adjust_invalid_order'
  | 'format_adjust_unknown_item'
  | 'format_adjust_item_required'
  | 'format_adjust_item_not_allowed'
  | 'format_adjust_attr_missing'
  | 'format_adjust_insufficient_holding'
  | 'format_adjust_domain_too_large'
  | 'format_adjust_amendment_limit'
  | 'format_adjust_relation_has_links'
  | 'format_adjust_action_unchanged'
  | 'format_adjust_domain_in_use'
  | 'format_check_not_found'
  | 'format_check_not_open'
  | 'format_request_too_large';

/** HTTP status of every refusal. */
export const FORMAT_REFUSALS: Readonly<Record<RefusalCode, number>> = {
  format_not_running: 409,
  format_not_participant: 403,
  format_season_closed: 409,
  format_action_unknown: 404,
  format_action_already_submitted: 409,
  format_adjust_not_allowed: 422,
  format_adjust_unknown_target: 422,
  format_adjust_invalid_amount: 422,
  format_adjust_invalid_links: 422,
  format_adjust_invalid_order: 422,
  format_adjust_unknown_item: 422,
  format_adjust_item_required: 422,
  format_adjust_item_not_allowed: 422,
  format_adjust_attr_missing: 422,
  format_adjust_insufficient_holding: 409,
  format_adjust_domain_too_large: 422,
  format_adjust_amendment_limit: 409,
  format_adjust_relation_has_links: 409,
  format_adjust_action_unchanged: 409,
  format_adjust_domain_in_use: 409,
  format_check_not_found: 404,
  format_check_not_open: 409,
  format_request_too_large: 413,
};

/** The refusal as a `UserFacingError`: English catalog message, the code and the status of the table. */
export function refuse(code: RefusalCode): UserFacingError<RefusalCode> {
  return new UserFacingError<RefusalCode>(errorsSeasons.en[code], { code, status: FORMAT_REFUSALS[code] });
}

/** What `applyAdjustment` answers (`ok: false`) -> the refusal the route throws. */
export const REFUSAL_OF_ISSUE: Readonly<Record<AdjustIssue, RefusalCode>> = {
  format_not_running: 'format_not_running',
  adjust_not_allowed: 'format_adjust_not_allowed',
  unknown_target: 'format_adjust_unknown_target',
  invalid_amount: 'format_adjust_invalid_amount',
  invalid_links: 'format_adjust_invalid_links',
  invalid_order: 'format_adjust_invalid_order',
  // Three different causes, three codes: a domain resource without an item, a counter with one, and an item that is not an
  // entry of the domain the resource holds.
  item_required: 'format_adjust_item_required',
  item_not_allowed: 'format_adjust_item_not_allowed',
  item_outside_domain: 'format_adjust_unknown_item',
  attr_missing: 'format_adjust_attr_missing',
  insufficient_holding: 'format_adjust_insufficient_holding',
  domain_too_large: 'format_adjust_domain_too_large',
  amendment_limit: 'format_adjust_amendment_limit',
  relation_has_links: 'format_adjust_relation_has_links',
  action_state_unchanged: 'format_adjust_action_unchanged',
  domain_in_use: 'format_adjust_domain_in_use',
};
