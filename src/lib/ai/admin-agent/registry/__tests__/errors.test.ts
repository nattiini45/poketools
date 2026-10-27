import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { RulesetStudioError } from '@/lib/ruleset-studio/errors';
import { isCataloguedCode, toolError, toolErrorFromThrown } from '../errors';

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

describe('isCataloguedCode', () => {
  it('knows keys of every catalog, the assistant catalog included', () => {
    for (const code of ['forbidden', 'validation_failed', 'rate_limited', 'tool_not_available', 'agent_harness_error', 'SEASON_NOT_FOUND', 'ruleset_not_found', 'format_not_found']) {
      expect(isCataloguedCode(code), code).toBe(true);
    }
  });

  it('rejects anything else, including non-strings', () => {
    for (const code of ['', 'definitely_not_a_code', 'FORBIDDEN', 42, null, undefined, {}]) expect(isCataloguedCode(code)).toBe(false);
  });
});

describe('toolErrorFromThrown', () => {
  it('maps a domain error to its code and params and logs nothing', () => {
    const err = new UserFacingError('League not found', { code: 'SEASON_NOT_FOUND', status: 404 });
    expect(toolErrorFromThrown(err, 'x')).toEqual({ ok: false, code: 'SEASON_NOT_FOUND' });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('maps subclasses such as the ruleset studio errors', () => {
    expect(toolErrorFromThrown(new RulesetStudioError('ruleset_not_found'), 'x')).toEqual({ ok: false, code: 'ruleset_not_found' });
    expect(toolErrorFromThrown(new RulesetStudioError('ruleset_forbidden'), 'x')).toMatchObject({ code: 'ruleset_forbidden' });
  });

  it('keeps only plain short params', () => {
    const err = new UserFacingError('x', { code: 'rate_limited', params: { seconds: 7, nested: { a: 1 } as never, long: 'y'.repeat(500) } as never, status: 429 });
    const mapped = toolErrorFromThrown(err, 'x');
    expect(mapped.params?.seconds).toBe(7);
    expect(mapped.params).not.toHaveProperty('nested');
    expect(String(mapped.params?.long).length).toBeLessThanOrEqual(201);
  });

  it('maps an auth error by its code (duck typed, as safeErrorResponse does)', () => {
    for (const code of ['unauthenticated', 'forbidden', 'account_banned', 'account_suspended'] as const) {
      expect(toolErrorFromThrown(Object.assign(new Error('Admin access required'), { statusCode: 403, code }), 'x')).toEqual({ ok: false, code });
    }
  });

  it('maps a Supabase request deadline to upstream_timeout, whatever wrapped it, and logs the original', () => {
    const deadline = new Error('Supabase rest request timed out after 10000 ms: GET /rest/v1/seasons');
    expect(toolErrorFromThrown(deadline, 'x')).toEqual({ ok: false, code: 'upstream_timeout' });
    expect(toolErrorFromThrown(new Error('wrapped', { cause: deadline }), 'x')).toEqual({ ok: false, code: 'upstream_timeout' });
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it('never forwards an uncatalogued code or any message text', () => {
    const rogue = new UserFacingError('Internal detail: relation "players" does not exist', { code: 'not_in_any_catalog' as never, status: 400 });
    expect(toolErrorFromThrown(rogue, 'x')).toEqual({ ok: false, code: 'agent_harness_error' });
    expect(toolErrorFromThrown(new Error('select * from players'), 'x')).toEqual({ ok: false, code: 'agent_harness_error' });
    expect(toolErrorFromThrown('a string', 'x')).toEqual({ ok: false, code: 'agent_harness_error' });
    expect(toolErrorFromThrown(null, 'x')).toEqual({ ok: false, code: 'agent_harness_error' });
    expect(errorSpy).toHaveBeenCalledTimes(4);
  });
});

describe('toolError', () => {
  it('omits params when there are none', () => {
    expect(toolError('forbidden')).toEqual({ ok: false, code: 'forbidden' });
    expect(toolError('rate_limited', { seconds: 3 })).toEqual({ ok: false, code: 'rate_limited', params: { seconds: 3 } });
  });
});
