/**
 * The HTTP side of the live-format routes: the rejected-submission answer (status priority, body shape, what it logs), the
 * no-store header, the bounded body reader, and the exhaustive refusal tables.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { logger } from '@/lib/logger';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import type { ActionIssue, ActionIssueCode } from '../actions';
import { readBoundedJson, readBoundedJsonOrEmpty } from '../api-body';
import { actionRejectedResponse, actionRejectedStatus, noStore, NO_STORE_HEADERS } from '../http';
import { FORMAT_REFUSALS, REFUSAL_OF_ISSUE, type RefusalCode } from '../refusal';

beforeEach(() => vi.clearAllMocks());

const issue = (code: ActionIssueCode, extra: Partial<ActionIssue> = {}): ActionIssue => ({ code, ...extra });

describe('actionRejectedStatus', () => {
  it('answers 422 for a pick that is wrong in itself', () => {
    for (const code of ['wrong_count', 'step_unknown', 'where_false', 'duplicate_item', 'item_outside_domain', 'domain_locked', 'capacity_exceeded', 'distinct_attr_duplicate', 'resource_unknown', 'domain_unknown'] as const) {
      expect(actionRejectedStatus([issue(code)]), code).toBe(422);
    }
  });

  it('answers the state of the league first, in the priority of the design', () => {
    expect(actionRejectedStatus([issue('wrong_count'), issue('action_unknown')])).toBe(404);
    expect(actionRejectedStatus([issue('format_not_running')])).toBe(409);
    expect(actionRejectedStatus([issue('wrong_count'), issue('actor_without_link')])).toBe(403);
    expect(actionRejectedStatus([issue('window_closed')])).toBe(409);
    expect(actionRejectedStatus([issue('resource_item_taken', { step: 0, item_id: 'x' })])).toBe(409);
  });

  it('puts the earlier entry of the priority list first, whatever the order of the issues', () => {
    expect(actionRejectedStatus([issue('window_closed'), issue('actor_without_link')])).toBe(403);
    expect(actionRejectedStatus([issue('resource_item_taken'), issue('window_closed'), issue('format_not_running')])).toBe(409);
    expect(actionRejectedStatus([issue('wrong_count'), issue('window_closed'), issue('action_unknown')])).toBe(404);
    expect(actionRejectedStatus([issue('wrong_count'), issue('wrong_count')])).toBe(422);
  });
});

describe('actionRejectedResponse', () => {
  it('answers with the catalog code, the count and the problems the actor can fix', async () => {
    const issues = [issue('wrong_count', { step: 0 }), issue('where_false', { step: 1, item_id: 'pikachu' }), issue('window_closed')];
    const response = actionRejectedResponse(issues);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: errorsSeasons.en.format_action_invalid,
      code: 'format_action_invalid',
      params: { count: 3 },
      issues: [{ code: 'wrong_count', step: 0 }, { code: 'where_false', step: 1, item_id: 'pikachu' }, { code: 'window_closed' }],
    });
  });

  it('copies only code, step and item_id of an issue', async () => {
    const response = actionRejectedResponse([{ code: 'wrong_count', step: 2, secret: 'leak' } as unknown as ActionIssue]);
    const body = (await response.json()) as { issues: Record<string, unknown>[] };
    expect(body.issues).toEqual([{ code: 'wrong_count', step: 2 }]);
  });

  it('logs the codes only, never the picks', () => {
    actionRejectedResponse([issue('where_false', { step: 1, item_id: 'pikachu' }), issue('wrong_count', { step: 0 })]);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('format-runtime', 'action rejected', { codes: ['where_false', 'wrong_count'] });
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('pikachu');
  });
});

describe('noStore', () => {
  it('adds the private no-store header and keeps the caller’s status and headers', () => {
    expect(NO_STORE_HEADERS['Cache-Control']).toBe('private, no-store');
    expect(noStore()).toEqual({ headers: { 'Cache-Control': 'private, no-store' } });
    expect(noStore({ status: 201, headers: { 'X-A': '1' } })).toEqual({ status: 201, headers: { 'X-A': '1', 'Cache-Control': 'private, no-store' } });
  });
});

describe('the bounded body readers', () => {
  const request = (body: string, headers: Record<string, string> = {}) => new Request('http://localhost/x', { method: 'POST', body, headers });

  it('parses a body within the cap', async () => {
    await expect(readBoundedJson(request('{"a":1}'), 100)).resolves.toEqual({ a: 1 });
  });

  it('answers an oversized body with a 413 format_request_too_large, before parsing', async () => {
    const big = request(JSON.stringify({ a: 'x'.repeat(200) }), { 'content-length': '300' });
    await expect(readBoundedJson(big, 100)).rejects.toMatchObject({ code: 'format_request_too_large', statusCode: 413 });
    await expect(readBoundedJson(request(JSON.stringify({ a: 'x'.repeat(200) })), 100)).rejects.toMatchObject({ code: 'format_request_too_large', statusCode: 413 });
  });

  it('answers an empty or unparsable body with a 400 invalid_json, and reads a blank body as {} where it is optional', async () => {
    await expect(readBoundedJson(request(''), 100)).rejects.toMatchObject({ code: 'invalid_json', statusCode: 400 });
    await expect(readBoundedJson(request('{nope'), 100)).rejects.toMatchObject({ code: 'invalid_json', statusCode: 400 });
    await expect(readBoundedJsonOrEmpty(request(''), 100)).resolves.toEqual({});
  });
});

describe('the refusal tables', () => {
  const CODES = Object.keys(FORMAT_REFUSALS) as RefusalCode[];

  it('gives every refusal a status of the client or conflict class', () => {
    for (const code of CODES) expect([403, 404, 409, 413, 422], code).toContain(FORMAT_REFUSALS[code]);
  });

  it('fixes the statuses of the design', () => {
    expect(FORMAT_REFUSALS.format_not_participant).toBe(403);
    expect(FORMAT_REFUSALS.format_action_unknown).toBe(404);
    expect(FORMAT_REFUSALS.format_check_not_found).toBe(404);
    for (const code of ['format_not_running', 'format_season_closed', 'format_action_already_submitted', 'format_adjust_insufficient_holding', 'format_adjust_amendment_limit', 'format_adjust_relation_has_links', 'format_adjust_action_unchanged', 'format_adjust_domain_in_use', 'format_check_not_open'] as const) {
      expect(FORMAT_REFUSALS[code], code).toBe(409);
    }
    expect(FORMAT_REFUSALS.format_request_too_large).toBe(413);
    for (const code of ['format_adjust_not_allowed', 'format_adjust_unknown_target', 'format_adjust_invalid_amount', 'format_adjust_invalid_links', 'format_adjust_invalid_order', 'format_adjust_unknown_item', 'format_adjust_item_required', 'format_adjust_item_not_allowed', 'format_adjust_domain_too_large'] as const) {
      expect(FORMAT_REFUSALS[code], code).toBe(422);
    }
  });

  it('maps every adjustment issue to a refusal of the table (the map is exhaustive, so a new issue is a type error)', () => {
    const issues = Object.keys(REFUSAL_OF_ISSUE);
    expect(issues.length).toBeGreaterThanOrEqual(12);
    for (const code of Object.values(REFUSAL_OF_ISSUE)) expect(CODES).toContain(code);
  });
});
