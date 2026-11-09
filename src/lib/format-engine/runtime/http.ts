/**
 * HTTP helpers of the live-format routes. `actionRejectedResponse` answers the one failure that is not an exception: a
 * rejected action submission (`ActionWrite` is `{ ok: false, issues }`). Server only.
 */
import { NextResponse } from 'next/server';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { logger } from '@/lib/logger';
import type { ApiResult } from '@/types/api';
import type { ActionIssue } from './actions';

/** `Cache-Control` of every viewer-specific read: the answer depends on who asks and must not be shared or stored. */
export const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

/** A `ResponseInit` with the no-store header (and the caller's own status / headers). */
export function noStore(init: ResponseInit = {}): ResponseInit {
  return { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...NO_STORE_HEADERS } };
}

/**
 * The status of a rejected submission: the first of these that any issue names, else 422. The other statuses are for the
 * state of the league (not found, not running, no access to the action, a closed window, an item taken meanwhile), the
 * 422 for a pick that is wrong in itself.
 */
const STATUS_PRIORITY: readonly (readonly [string, number])[] = [
  ['action_unknown', 404],
  ['format_not_running', 409],
  ['actor_without_link', 403],
  ['actor_not_in_league', 403],
  ['window_closed', 409],
  ['resource_item_taken', 409],
];

export function actionRejectedStatus(issues: readonly ActionIssue[]): number {
  for (const [issueCode, status] of STATUS_PRIORITY) {
    if (issues.some((issue) => issue.code === issueCode)) return status;
  }
  return 422;
}

/**
 * The body of a rejected action submission: the usual `{ success, error, code, params }` plus the problems the actor can
 * fix (`issues`: codes, step indexes and item ids that the actor just sent; nothing else). Logs the codes only, never the
 * picks, so no error branch is silent.
 */
export function actionRejectedResponse(issues: readonly ActionIssue[]): NextResponse<ApiResult<never>> {
  logger.info('format-runtime', 'action rejected', { codes: issues.map((issue) => issue.code) });
  return NextResponse.json<ApiResult<never>>(
    {
      success: false,
      error: errorsSeasons.en.format_action_invalid,
      code: 'format_action_invalid',
      params: { count: issues.length },
      issues: issues.map((issue) => ({
        code: issue.code,
        ...(issue.step !== undefined ? { step: issue.step } : {}),
        ...(issue.item_id !== undefined ? { item_id: issue.item_id } : {}),
      })),
    },
    { status: actionRejectedStatus(issues) },
  );
}
