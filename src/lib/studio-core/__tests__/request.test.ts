import { describe, expect, it } from 'vitest';
import { errorLikeOf, failureOf, makeClassifier, request, type ApiErrorKind, type FetchLike } from '../request';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

function fakeFetch(answer: Response | Error): { f: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    return answer.clone();
  };
  return { f, calls };
}

describe('request', () => {
  it('sends a JSON body with its content type and unwraps the success envelope', async () => {
    const { f, calls } = fakeFetch(respond(200, { success: true, data: { id: 'x' } }));
    expect(await request(f, 'PUT', '/api/things/x', { a: 1 })).toEqual({ ok: true, data: { id: 'x' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].init).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
  });

  it('sends no body and no content type when there is none', async () => {
    const { f, calls } = fakeFetch(respond(200, { success: true, data: null }));
    await request(f, 'GET', '/api/things');
    expect(calls[0].init).toEqual({ method: 'GET' });
  });

  it('a failed response gives the server\'s code and params and the status', async () => {
    const { f } = fakeFetch(respond(409, { success: false, error: 'stale', code: 'x_stale', params: { draft_rev: 7, bad: { nested: 1 } } }));
    expect(await request(f, 'PUT', '/p')).toEqual({ ok: false, status: 409, error: { error: 'stale', code: 'x_stale', params: { draft_rev: 7 } } });
  });

  it('a network failure is status 0 and network_error, and never throws', async () => {
    const { f } = fakeFetch(new TypeError('failed'));
    expect(await request(f, 'GET', '/p')).toEqual({ ok: false, status: 0, error: { code: 'network_error' } });
  });

  it('a 200 without the success envelope is a failure', async () => {
    const { f } = fakeFetch(respond(200, { ok: true }));
    expect(await request(f, 'GET', '/p')).toMatchObject({ ok: false, status: 200, error: { code: 'unknown_error' } });
  });
});

describe('failureOf and errorLikeOf', () => {
  it('derives the code from the status when the body has none', () => {
    expect(failureOf(respond(401, null), null)).toEqual({ code: 'unauthenticated' });
    expect(failureOf(respond(500, null), 'text')).toEqual({ code: 'unknown_error' });
  });

  it('reads Retry-After on a 429', () => {
    expect(failureOf(respond(429, null, { 'retry-after': '30' }), null)).toEqual({ code: 'rate_limited', params: { seconds: 30 } });
    expect(failureOf(respond(429, null), null)).toEqual({ code: 'rate_limited' });
    expect(failureOf(respond(429, null, { 'retry-after': 'soon' }), null)).toEqual({ code: 'rate_limited' });
  });

  it('keeps only members of the right type', () => {
    expect(errorLikeOf({ error: 1, code: 2, params: { n: Number.NaN, s: 'x' } })).toEqual({});
    expect(errorLikeOf([1])).toEqual({});
    expect(errorLikeOf({ code: 'c', params: { n: Number.POSITIVE_INFINITY, s: 'x' } })).toEqual({ code: 'c', params: { s: 'x' } });
  });
});

describe('makeClassifier', () => {
  const kinds: Record<string, ApiErrorKind> = { toy_missing: 'not_found', toy_stale: 'stale_revision', toy_taken: 'blocked' };
  const classify = makeClassifier({ codeKinds: kinds, staleRevisionCode: 'toy_stale' });

  it('classes the studio\'s own codes', () => {
    expect(classify({ code: 'toy_missing' })).toEqual({ kind: 'not_found' });
    expect(classify({ code: 'toy_taken' })).toEqual({ kind: 'blocked' });
  });

  it('a stale revision carries the revision the server holds', () => {
    expect(classify({ code: 'toy_stale', params: { draft_rev: 9 } })).toEqual({ kind: 'stale_revision', staleRev: 9 });
    expect(classify({ code: 'toy_stale' })).toEqual({ kind: 'stale_revision' });
  });

  it('knows the codes every route can answer with', () => {
    expect(classify({ code: 'rate_limited', params: { seconds: 5 } })).toEqual({ kind: 'rate_limited', retryAfter: 5 });
    expect(classify({ code: 'validation_failed' })).toEqual({ kind: 'invalid' });
    expect(classify({ code: 'unauthenticated' })).toEqual({ kind: 'unauthenticated' });
    expect(classify({ code: 'forbidden' })).toEqual({ kind: 'forbidden' });
    expect(classify({ code: 'network_error' })).toEqual({ kind: 'network' });
  });

  it('falls back to the status for an unknown or missing code', () => {
    expect(classify({}, 429)).toEqual({ kind: 'rate_limited' });
    expect(classify({}, 401)).toEqual({ kind: 'unauthenticated' });
    expect(classify({}, 0)).toEqual({ kind: 'network' });
    expect(classify({ code: 'mystery' }, 500)).toEqual({ kind: 'other' });
  });

  it('a code that is only an Object.prototype name is not a studio code', () => {
    expect(classify({ code: 'constructor' }, 500)).toEqual({ kind: 'other' });
    expect(classify({ code: 'toString' })).toEqual({ kind: 'other' });
  });

  it('another studio\'s stale code is not stale here', () => {
    expect(classify({ code: 'other_stale', params: { draft_rev: 3 } })).toEqual({ kind: 'other' });
  });
});
