import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiErrorText } from '@/i18n/api-errors';
import { createTranslator } from '@/i18n/core';
import { errorsCommon } from '@/i18n/messages/errors';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { ltext } from '@/lib/studio-core/ltext';
import {
  attachFormatRequest,
  classifyApiError,
  createFormatRequest,
  deleteFormatRequest,
  detachFormatRequest,
  forkFormatRequest,
  forkPresetRequest,
  loadFormatDetail,
  publishRequest,
  saveDraftRequest,
  visibilityRequest,
} from '../../editor/api';
import type { ApiErrorKind, FetchLike } from '@/lib/studio-core/request';
import { FORMAT_ERROR_CODES, FORMAT_ERROR_STATUS } from '../../errors';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A fake fetch that answers with the given responses in order and records what it was asked. */
function fakeFetch(...answers: Array<Response | Error>): { f: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...answers];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift() ?? new Response('{}', { status: 200 });
    if (next instanceof Error) throw next;
    return next;
  };
  return { f, calls };
}

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status });
const fail = (status: number, body: unknown, headers?: Record<string, string>) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

const bodyOf = (call: Call): unknown => JSON.parse(String(call.init?.body));
const headerOf = (call: Call, name: string): string | undefined =>
  (call.init?.headers as Record<string, string> | undefined)?.[name];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requests', () => {
  it('saveDraftRequest PUTs the revision and the document', async () => {
    const { f, calls } = fakeFetch(ok({ draft_rev: 4, updated_at: 'now', name: ltext('en', 'x'), check: { ok: true, hash: 'h', diagnostics: [], truncated: false } }));
    const doc = { schema_version: 1 };
    const outcome = await saveDraftRequest('abc', 3, doc, f);
    expect(outcome).toMatchObject({ ok: true, data: { draft_rev: 4 } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/formats/abc/draft');
    expect(calls[0].init?.method).toBe('PUT');
    expect(headerOf(calls[0], 'Content-Type')).toBe('application/json');
    expect(bodyOf(calls[0])).toEqual({ draft_rev: 3, document: doc });
  });

  it('loadFormatDetail GETs without a body or a content type', async () => {
    const { f, calls } = fakeFetch(ok({ definition: {}, draft: null, published: null, versions: [], check: null }));
    expect((await loadFormatDetail('abc', f)).ok).toBe(true);
    expect(calls[0].url).toBe('/api/formats/abc');
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.body).toBeUndefined();
    expect(calls[0].init?.headers).toBeUndefined();
  });

  it('publishRequest POSTs the revision and an optional changelog', async () => {
    const { f, calls } = fakeFetch(ok({}), ok({}));
    await publishRequest('abc', 5, undefined, f);
    const changelog = ltext('en', 'Fixed the bracket', 'Bracket repariert');
    await publishRequest('abc', 5, changelog, f);
    expect(calls[0].url).toBe('/api/formats/abc/publish');
    expect(calls[0].init?.method).toBe('POST');
    expect(bodyOf(calls[0])).toEqual({ draft_rev: 5 });
    expect(bodyOf(calls[1])).toEqual({ draft_rev: 5, changelog });
  });

  it('visibilityRequest PATCHes the visibility', async () => {
    const { f, calls } = fakeFetch(ok({}));
    await visibilityRequest('abc', 'league', f);
    expect(calls[0].url).toBe('/api/formats/abc');
    expect(calls[0].init?.method).toBe('PATCH');
    expect(bodyOf(calls[0])).toEqual({ visibility: 'league' });
  });

  it('deleteFormatRequest DELETEs', async () => {
    const { f, calls } = fakeFetch(ok({ deleted: true }));
    expect(await deleteFormatRequest('abc', f)).toEqual({ ok: true, data: { deleted: true } });
    expect(calls[0].url).toBe('/api/formats/abc');
    expect(calls[0].init?.method).toBe('DELETE');
  });

  it('forkFormatRequest and forkPresetRequest POST without a body', async () => {
    const { f, calls } = fakeFetch(ok({}, 201), ok({}, 201));
    await forkFormatRequest('abc', f);
    await forkPresetRequest('classic-league', undefined, f);
    expect(calls.map((c) => c.url)).toEqual(['/api/formats/abc/fork', '/api/formats/presets/classic-league/fork']);
    for (const call of calls) {
      expect(call.init?.method).toBe('POST');
      expect(call.init?.body).toBeUndefined();
      expect(call.init?.headers).toBeUndefined();
    }
  });

  it('forkPresetRequest sends the rule preset it was given', async () => {
    const { f, calls } = fakeFetch(ok({}, 201));
    await forkPresetRequest('classic-league', 'gen9ou', f);
    expect(calls[0].url).toBe('/api/formats/presets/classic-league/fork');
    expect(calls[0].init?.method).toBe('POST');
    expect(bodyOf(calls[0])).toEqual({ ruleset_preset: 'gen9ou' });
  });

  it('createFormatRequest POSTs a document or a name', async () => {
    const { f, calls } = fakeFetch(ok({}, 201), ok({}, 201));
    await createFormatRequest({ document: { a: 1 } }, f);
    await createFormatRequest({ name: 'Cup', base_locale: 'de' }, f);
    expect(calls.map((c) => c.url)).toEqual(['/api/formats', '/api/formats']);
    expect(bodyOf(calls[0])).toEqual({ document: { a: 1 } });
    expect(bodyOf(calls[1])).toEqual({ name: 'Cup', base_locale: 'de' });
    expect(calls[0].init?.method).toBe('POST');
  });

  it('attachFormatRequest and detachFormatRequest use the season route', async () => {
    const { f, calls } = fakeFetch(ok({ season_format: {}, stages: [], warnings: [] }), ok({ removed_stage_ids: ['s1'] }));
    expect((await attachFormatRequest('season-1', 'def-1', 3, f)).ok).toBe(true);
    expect(await detachFormatRequest('season-1', f)).toEqual({ ok: true, data: { removed_stage_ids: ['s1'] } });
    expect(calls[0].url).toBe('/api/seasons/season-1/format');
    expect(calls[0].init?.method).toBe('POST');
    expect(bodyOf(calls[0])).toEqual({ definition_id: 'def-1', version_no: 3 });
    expect(calls[1].url).toBe('/api/seasons/season-1/format');
    expect(calls[1].init?.method).toBe('DELETE');
  });

  it('encodes every path segment, so an id cannot change the path', async () => {
    const evil = 'a/../b?x=1#frag';
    const { f, calls } = fakeFetch(ok({}), ok({}), ok({}), ok({}), ok({}), ok({}), ok({}), ok({}), ok({}));
    await saveDraftRequest(evil, 1, {}, f);
    await loadFormatDetail(evil, f);
    await publishRequest(evil, 1, undefined, f);
    await visibilityRequest(evil, 'private', f);
    await deleteFormatRequest(evil, f);
    await forkFormatRequest(evil, f);
    await forkPresetRequest(evil, undefined, f);
    await attachFormatRequest(evil, evil, 1, f);
    await detachFormatRequest(evil, f);
    for (const call of calls) {
      expect(call.url).not.toContain('?');
      expect(call.url).not.toContain('#');
      expect(call.url).not.toContain('/../');
      expect(new URL(call.url, 'http://localhost').search).toBe('');
      expect(call.url).toContain(encodeURIComponent(evil));
    }
    expect(new URL(calls[0].url, 'http://localhost').pathname.split('/')).toHaveLength(5);
    expect(new URL(calls[6].url, 'http://localhost').pathname.split('/')).toHaveLength(6);
  });

  it('uses the global fetch when none is given', async () => {
    const stub = vi.fn(async () => ok({ deleted: true }));
    vi.stubGlobal('fetch', stub);
    expect(await deleteFormatRequest('abc')).toEqual({ ok: true, data: { deleted: true } });
    expect(stub).toHaveBeenCalledWith('/api/formats/abc', { method: 'DELETE' });
  });
});

describe('failures', () => {
  it('a stale save carries the code, the status and the revision the server holds', async () => {
    const { f } = fakeFetch(fail(409, { success: false, error: 'stale', code: 'format_stale_revision', params: { draft_rev: 9 } }));
    const outcome = await saveDraftRequest('abc', 3, {}, f);
    expect(outcome).toEqual({ ok: false, status: 409, error: { error: 'stale', code: 'format_stale_revision', params: { draft_rev: 9 } } });
    if (outcome.ok) throw new Error('expected a failure');
    expect(classifyApiError(outcome.error, outcome.status)).toEqual({ kind: 'stale_revision', staleRev: 9 });
  });

  it('a rate limit carries the seconds', async () => {
    const { f } = fakeFetch(fail(429, { success: false, error: 'slow down', code: 'rate_limited', params: { seconds: 42 } }, { 'Retry-After': '42' }));
    const outcome = await saveDraftRequest('abc', 3, {}, f);
    if (outcome.ok) throw new Error('expected a failure');
    expect(outcome.status).toBe(429);
    expect(classifyApiError(outcome.error, outcome.status)).toEqual({ kind: 'rate_limited', retryAfter: 42 });
  });

  it('a 429 without a body is a rate limit with the Retry-After seconds', async () => {
    const { f } = fakeFetch(fail(429, '', { 'Retry-After': '7' }), fail(429, ''));
    const withHeader = await publishRequest('abc', 1, undefined, f);
    const without = await publishRequest('abc', 1, undefined, f);
    if (withHeader.ok || without.ok) throw new Error('expected failures');
    expect(classifyApiError(withHeader.error, withHeader.status)).toEqual({ kind: 'rate_limited', retryAfter: 7 });
    expect(classifyApiError(without.error, without.status)).toEqual({ kind: 'rate_limited' });
  });

  it('a body that is not JSON gives unknown_error with the status', async () => {
    const { f } = fakeFetch(fail(502, '<html>Bad gateway</html>'), fail(500, ''));
    const first = await loadFormatDetail('abc', f);
    const second = await loadFormatDetail('abc', f);
    expect(first).toEqual({ ok: false, status: 502, error: { code: 'unknown_error' } });
    expect(second).toEqual({ ok: false, status: 500, error: { code: 'unknown_error' } });
    if (first.ok) throw new Error('expected a failure');
    expect(classifyApiError(first.error, first.status).kind).toBe('other');
  });

  it('a 401 without a code is unauthenticated', async () => {
    const { f } = fakeFetch(fail(401, ''), fail(401, { success: false, error: 'Not authenticated' }));
    for (let i = 0; i < 2; i += 1) {
      const outcome = await saveDraftRequest('abc', 1, {}, f);
      if (outcome.ok) throw new Error('expected a failure');
      expect(outcome.error.code).toBe('unauthenticated');
      expect(classifyApiError(outcome.error, outcome.status).kind).toBe('unauthenticated');
    }
  });

  it('a request that never arrives is a network error with status 0', async () => {
    const { f } = fakeFetch(new TypeError('Failed to fetch'), new Error('boom'));
    for (let i = 0; i < 2; i += 1) {
      const outcome = await deleteFormatRequest('abc', f);
      expect(outcome).toEqual({ ok: false, status: 0, error: { code: 'network_error' } });
      if (outcome.ok) throw new Error('expected a failure');
      expect(classifyApiError(outcome.error, outcome.status).kind).toBe('network');
    }
  });

  it('a 200 answer that is not a success envelope is a failure', async () => {
    const { f } = fakeFetch(new Response('{"success":false,"error":"no"}', { status: 200 }), new Response('not json', { status: 200 }));
    const first = await loadFormatDetail('abc', f);
    const second = await loadFormatDetail('abc', f);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
  });

  it('never logs a body', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { f } = fakeFetch(fail(500, 'x'), new TypeError('x'));
    await saveDraftRequest('abc', 1, { secret: 'draft text' }, f);
    await saveDraftRequest('abc', 1, { secret: 'draft text' }, f);
    expect(spy).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    spy.mockRestore();
    log.mockRestore();
  });
});

describe('classifyApiError', () => {
  const expected: Record<string, ApiErrorKind> = {
    format_not_found: 'not_found',
    format_preset_not_found: 'not_found',
    format_stale_revision: 'stale_revision',
    format_slug_taken: 'blocked',
    format_document_not_json: 'invalid',
    format_document_not_object: 'invalid',
    format_document_too_deep: 'invalid',
    format_document_too_many_nodes: 'invalid',
    format_document_too_large: 'too_large',
    format_document_too_large_to_store: 'too_large',
    format_document_name_required: 'invalid',
    format_publish_invalid: 'invalid',
    format_nothing_to_publish: 'blocked',
    format_not_published: 'blocked',
    format_published_locked: 'forbidden',
    format_visibility_forbidden: 'forbidden',
    format_preset_locked: 'forbidden',
    format_attached: 'blocked',
    format_has_versions: 'blocked',
    format_version_immutable: 'blocked',
    format_season_not_custom: 'blocked',
    format_season_started: 'blocked',
    format_attach_forbidden: 'forbidden',
    format_attach_invalid: 'invalid',
    format_attach_ruleset_forbidden: 'forbidden',
    format_attach_ruleset_required: 'invalid',
    format_attach_manual_phases: 'blocked',
    format_not_attached: 'blocked',
    format_nothing_attached: 'not_found',
    format_detach_blocked: 'blocked',
    season_format_type_locked: 'blocked',
  };

  it('lists every format error code in the table below, and nothing else', () => {
    expect(Object.keys(expected).sort()).toEqual([...FORMAT_ERROR_CODES].sort());
  });

  it.each(FORMAT_ERROR_CODES.map((code) => [code, expected[code]] as const))('%s is %s', (code, kind) => {
    expect(classifyApiError({ code }, FORMAT_ERROR_STATUS[code]).kind).toBe(kind);
    expect(classifyApiError({ code }).kind).toBe(kind);
  });

  it('classifies the codes outside the format list', () => {
    expect(classifyApiError({ code: 'rate_limited', params: { seconds: 5 } }, 429)).toEqual({ kind: 'rate_limited', retryAfter: 5 });
    expect(classifyApiError({ code: 'rate_limited' }, 429)).toEqual({ kind: 'rate_limited' });
    expect(classifyApiError({ code: 'validation_failed' }, 400).kind).toBe('invalid');
    expect(classifyApiError({ code: 'network_error' }, 0).kind).toBe('network');
    expect(classifyApiError({ code: 'unauthenticated' }, 401).kind).toBe('unauthenticated');
    expect(classifyApiError({ code: 'forbidden' }, 403).kind).toBe('forbidden');
    expect(classifyApiError({ code: 'season_not_found' }, 404).kind).toBe('not_found');
    expect(classifyApiError({ code: 'something_new' }, 500).kind).toBe('other');
  });

  it('falls back to the status when there is no code', () => {
    expect(classifyApiError({}, 401).kind).toBe('unauthenticated');
    expect(classifyApiError({}, 0).kind).toBe('network');
    expect(classifyApiError({}, 429).kind).toBe('rate_limited');
    expect(classifyApiError({}, 500).kind).toBe('other');
    expect(classifyApiError({}).kind).toBe('other');
  });

  it('a stale revision without a number has no staleRev; a string number is ignored', () => {
    expect(classifyApiError({ code: 'format_stale_revision' })).toEqual({ kind: 'stale_revision' });
    expect(classifyApiError({ code: 'format_stale_revision', params: { draft_rev: '9' } })).toEqual({ kind: 'stale_revision' });
  });

  it('does not treat a prototype member as a code', () => {
    expect(classifyApiError({ code: 'constructor' }, 500).kind).toBe('other');
    expect(classifyApiError({ code: 'toString' }, 500).kind).toBe('other');
  });
});

describe('error texts', () => {
  /** What the server sends as `params` for each code that has placeholders. */
  const SENT_PARAMS: Partial<Record<(typeof FORMAT_ERROR_CODES)[number], Record<string, string | number>>> = {
    format_stale_revision: { draft_rev: 3 },
    format_publish_invalid: { count: 2 },
    format_attached: { count: 1 },
    format_attach_invalid: { first: 'schema_refine' },
    format_attach_ruleset_required: { count: 2 },
    format_attach_manual_phases: { count: 1 },
  };
  const catalogs = [errorsAdmin, errorsSeasons] as const;
  const unknownText = (locale: 'en' | 'de') => createTranslator(errorsCommon, locale)('unknown_error');

  it.each(FORMAT_ERROR_CODES.flatMap((code) => (['en', 'de'] as const).map((locale) => [code, locale] as const)))(
    '%s has a %s text that its params fill',
    (code, locale) => {
      const text = apiErrorText({ code, params: SENT_PARAMS[code] ?? null }, { locale, catalogs });
      expect(text.trim()).not.toBe('');
      expect(text).not.toBe(unknownText(locale));
      expect(text).not.toMatch(/[{}]/);
      expect(text).not.toContain('�');
    },
  );

  it('the German texts are not the English ones', () => {
    for (const code of FORMAT_ERROR_CODES) {
      const params = SENT_PARAMS[code] ?? null;
      expect(apiErrorText({ code, params }, { locale: 'de', catalogs }), code).not.toBe(apiErrorText({ code, params }, { locale: 'en', catalogs }));
    }
  });

  it('the codes the request layer produces itself have texts in both languages', () => {
    for (const locale of ['en', 'de'] as const) {
      for (const code of ['network_error', 'unauthenticated', 'forbidden', 'unknown_error']) {
        expect(apiErrorText({ code }, { locale, catalogs })).not.toBe('');
      }
      expect(apiErrorText({ code: 'rate_limited', params: { seconds: 5 } }, { locale, catalogs })).toContain('5');
      expect(apiErrorText({ code: 'network_error' }, { locale, catalogs })).not.toBe(unknownText(locale));
    }
  });
});
