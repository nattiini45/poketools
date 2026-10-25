import { describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { parseGenerateOptions } from '../generate-options';

/** A request whose body reads as `body`; `read` decides how (resolve, reject). */
function requestWith(read: () => Promise<unknown>): NextRequest {
  return { json: read } as unknown as NextRequest;
}

describe('parseGenerateOptions', () => {
  it('reads no body (a caller that sends none) as no options', async () => {
    const result = await parseGenerateOptions({} as NextRequest);
    expect(result).toEqual({ ok: true, startRound: false });
  });

  it('reads an empty or unparsable body as no options', async () => {
    const empty = await parseGenerateOptions(requestWith(() => Promise.resolve({})));
    expect(empty).toEqual({ ok: true, startRound: false });

    const invalid = await parseGenerateOptions(
      requestWith(() => Promise.reject(new SyntaxError('Unexpected end of JSON input'))),
    );
    expect(invalid).toEqual({ ok: true, startRound: false });

    const jsonNull = await parseGenerateOptions(requestWith(() => Promise.resolve(null)));
    expect(jsonNull).toEqual({ ok: true, startRound: false });
  });

  it('reads start_round', async () => {
    expect(await parseGenerateOptions(requestWith(() => Promise.resolve({ start_round: true })))).toEqual({
      ok: true,
      startRound: true,
    });
    expect(await parseGenerateOptions(requestWith(() => Promise.resolve({ start_round: false })))).toEqual({
      ok: true,
      startRound: false,
    });
  });

  it.each([
    ['a string start_round', { start_round: 'yes' }],
    ['an unknown key', { foo: 1 }],
    ['an array body', []],
    ['a known key next to an unknown one', { start_round: true, extra: 1 }],
  ])('answers %s with 400 validation_failed', async (_label, body) => {
    const result = await parseGenerateOptions(requestWith(() => Promise.resolve(body)));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    const payload = await result.response.json();
    expect(payload.success).toBe(false);
    expect(payload.code).toBe('validation_failed');
    expect(payload.params).toEqual({ issues: payload.error });
    expect(typeof payload.error).toBe('string');
  });
});
