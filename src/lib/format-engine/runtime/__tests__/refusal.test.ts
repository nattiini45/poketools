import { describe, expect, it } from 'vitest';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { FORMAT_CHALLENGE_ERROR_CODES } from '@/lib/supabase/queries/format-challenges';
import { FORMAT_RUNTIME_ERROR_CODES } from '@/lib/supabase/queries/format-runtime';
import { classifyFormatRuntimeError, FORMAT_RUNTIME_NO_REVISION_CODE } from '../client-api';
import { FORMAT_REFUSALS, REFUSAL_OF_ISSUE, refuse, type RefusalCode } from '../refusal';

const CODES = Object.keys(FORMAT_REFUSALS) as RefusalCode[];

describe('refusals', () => {
  it('every refusal is a catalog key with an English and a German message', () => {
    for (const code of CODES) {
      expect(errorsSeasons.en, code).toHaveProperty(code);
      expect(errorsSeasons.de, code).toHaveProperty(code);
    }
  });

  it('refuse() builds a user-facing error with the catalog text, the code and the status of the table', () => {
    const error = refuse('format_adjust_relation_has_links');
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error.code).toBe('format_adjust_relation_has_links');
    expect(error.statusCode).toBe(409);
    expect(error.message).toBe(errorsSeasons.en.format_adjust_relation_has_links);
    expect(refuse('format_not_participant').statusCode).toBe(403);
    expect(refuse('format_request_too_large').statusCode).toBe(413);
  });

  it('answers with a client or conflict status only', () => {
    for (const code of CODES) expect([403, 404, 409, 413, 422]).toContain(FORMAT_REFUSALS[code]);
  });

  it('maps every adjustment issue to a refusal of the table', () => {
    for (const [issue, code] of Object.entries(REFUSAL_OF_ISSUE)) expect(CODES, issue).toContain(code);
    // Both rounds of S6: the issues that already exist.
    expect(REFUSAL_OF_ISSUE.relation_has_links).toBe('format_adjust_relation_has_links');
    expect(REFUSAL_OF_ISSUE.domain_in_use).toBe('format_adjust_domain_in_use');
    expect(REFUSAL_OF_ISSUE.action_state_unchanged).toBe('format_adjust_action_unchanged');
    expect(FORMAT_REFUSALS.format_adjust_action_unchanged).toBe(409);
    expect(errorsSeasons.de.format_adjust_action_unchanged).not.toBe(errorsSeasons.en.format_adjust_action_unchanged);
    expect(REFUSAL_OF_ISSUE.format_not_running).toBe('format_not_running');
  });

  it('keeps the three item mistakes of a resource adjustment apart: each issue has its own refusal and message', () => {
    const codes = [REFUSAL_OF_ISSUE.item_required, REFUSAL_OF_ISSUE.item_not_allowed, REFUSAL_OF_ISSUE.item_outside_domain];
    expect(new Set(codes).size).toBe(3);
    expect(new Set(codes.map((code) => errorsSeasons.en[code])).size).toBe(3);
    expect(new Set(codes.map((code) => errorsSeasons.de[code])).size).toBe(3);
  });
});

describe('classifyFormatRuntimeError', () => {
  it('classes every refusal, database signal and path id of the live-format routes', () => {
    const codes = [...CODES, ...FORMAT_RUNTIME_ERROR_CODES, ...FORMAT_CHALLENGE_ERROR_CODES, 'format_action_invalid', 'INVALID_SEASON_ID', 'INVALID_CHALLENGE_ID', 'INVALID_CHECK_ID'];
    for (const code of codes) expect(classifyFormatRuntimeError({ code }).kind, code).not.toBe('other');
  });

  it('reads the dispositions of the design', () => {
    expect(classifyFormatRuntimeError({ code: 'challenge_cooldown' }).kind).toBe('conflict');
    expect(classifyFormatRuntimeError({ code: 'action_locked' }).kind).toBe('conflict');
    expect(classifyFormatRuntimeError({ code: 'format_adjust_invalid_order' }).kind).toBe('invalid');
    expect(classifyFormatRuntimeError({ code: 'format_not_participant' }).kind).toBe('forbidden');
    expect(classifyFormatRuntimeError({ code: 'format_check_not_found' }).kind).toBe('not_found');
    expect(classifyFormatRuntimeError({ code: 'format_request_too_large' }).kind).toBe('too_large');
    expect(classifyFormatRuntimeError({ code: 'rate_limited', params: { seconds: 3 } })).toEqual({ kind: 'rate_limited', retryAfter: 3 });
  });

  it('has no stale revision: the code that would mean one is never sent', () => {
    expect(FORMAT_RUNTIME_NO_REVISION_CODE).not.toBe('');
    expect(Object.keys(errorsSeasons.en)).not.toContain(FORMAT_RUNTIME_NO_REVISION_CODE);
  });
});
