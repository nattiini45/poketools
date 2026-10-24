import { describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  MAX_REQUEST_BODY_BYTES,
  assertEnvelopeDocument,
  readBoundedJson,
  readBoundedJsonOrEmpty,
} from '../api-body';
import { FormatStudioError } from '../errors';

function fakeRequest(body: string, headers: Record<string, string> = {}) {
  const text = vi.fn(async () => body);
  return { request: { headers: new Headers(headers), text } as unknown as Request, text };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to throw');
}

describe('readBoundedJson', () => {
  it('parses a JSON body from a real Request', async () => {
    const request = new Request('http://localhost/api/formats', { method: 'POST', body: '{"a":[1,2]}' });
    await expect(readBoundedJson(request)).resolves.toEqual({ a: [1, 2] });
  });

  it('refuses by the content-length header before it reads anything', async () => {
    const { request, text } = fakeRequest('{}', { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) });
    const err = await failure(readBoundedJson(request));
    expect(err).toBeInstanceOf(FormatStudioError);
    expect((err as FormatStudioError).code).toBe('format_document_too_large');
    expect(text).not.toHaveBeenCalled();
  });

  it('refuses an oversized body that has no header', async () => {
    const { request } = fakeRequest(JSON.stringify({ pad: 'x'.repeat(MAX_REQUEST_BODY_BYTES) }));
    const err = await failure(readBoundedJson(request));
    expect((err as FormatStudioError).code).toBe('format_document_too_large');
  });

  it('refuses a body whose UTF-8 size is over the cap although its string is shorter', async () => {
    // 400,000 euro signs are 400,000 UTF-16 units but 1,200,000 bytes.
    const { request } = fakeRequest(JSON.stringify({ pad: '€'.repeat(400_000) }));
    const err = await failure(readBoundedJson(request));
    expect((err as FormatStudioError).code).toBe('format_document_too_large');
  });

  it('accepts a body of exactly the cap', async () => {
    const wrapper = JSON.stringify({ pad: '' });
    const padded = JSON.stringify({ pad: 'x'.repeat(MAX_REQUEST_BODY_BYTES - wrapper.length) });
    expect(padded.length).toBe(MAX_REQUEST_BODY_BYTES);
    const { request } = fakeRequest(padded);
    await expect(readBoundedJson(request)).resolves.toMatchObject({ pad: expect.any(String) });
  });

  it('honours a smaller cap', async () => {
    const { request } = fakeRequest('{"a":"0123456789"}');
    const err = await failure(readBoundedJson(request, 8));
    expect((err as FormatStudioError).code).toBe('format_document_too_large');
  });

  it('answers 400 invalid_json for text that does not parse, without echoing it', async () => {
    const { request } = fakeRequest('{"secret": nope');
    const err = (await failure(readBoundedJson(request))) as UserFacingError;
    expect(err).toBeInstanceOf(UserFacingError);
    expect(err.code).toBe('invalid_json');
    expect(err.statusCode).toBe(400);
    expect(err.message).not.toContain('secret');
  });

  it('answers 400 invalid_json for an empty body', async () => {
    const empty = (await failure(readBoundedJson(fakeRequest('').request))) as UserFacingError;
    expect(empty.code).toBe('invalid_json');
    const blank = (await failure(readBoundedJson(fakeRequest('  \n').request))) as UserFacingError;
    expect(blank.code).toBe('invalid_json');
  });

  it('ignores a content-length header that is not a number', async () => {
    const { request } = fakeRequest('{"ok":true}', { 'content-length': 'abc' });
    await expect(readBoundedJson(request)).resolves.toEqual({ ok: true });
  });
});

describe('readBoundedJsonOrEmpty', () => {
  it('reads a blank body as an empty object', async () => {
    await expect(readBoundedJsonOrEmpty(fakeRequest('').request)).resolves.toEqual({});
    await expect(readBoundedJsonOrEmpty(fakeRequest(' ').request)).resolves.toEqual({});
  });

  it('still parses and still refuses', async () => {
    await expect(readBoundedJsonOrEmpty(fakeRequest('{"slug":"a"}').request)).resolves.toEqual({ slug: 'a' });
    const bad = (await failure(readBoundedJsonOrEmpty(fakeRequest('{').request))) as UserFacingError;
    expect(bad.code).toBe('invalid_json');
    const big = await failure(readBoundedJsonOrEmpty(fakeRequest('{}', { 'content-length': '9999999' }).request));
    expect((big as FormatStudioError).code).toBe('format_document_too_large');
  });
});

describe('assertEnvelopeDocument', () => {
  const codeOf = (fn: () => void): string | undefined => {
    try {
      fn();
    } catch (err) {
      return (err as FormatStudioError).code;
    }
    return undefined;
  };

  it('passes an object document', () => {
    expect(codeOf(() => assertEnvelopeDocument({ document: { schema_version: 1 } }))).toBeUndefined();
  });

  it('leaves an envelope without a document member to the zod schema', () => {
    expect(codeOf(() => assertEnvelopeDocument({ name: 'x' }))).toBeUndefined();
    expect(codeOf(() => assertEnvelopeDocument(null))).toBeUndefined();
    expect(codeOf(() => assertEnvelopeDocument([1, 2]))).toBeUndefined();
    expect(codeOf(() => assertEnvelopeDocument('text'))).toBeUndefined();
  });

  it('refuses a document that is not an object', () => {
    expect(codeOf(() => assertEnvelopeDocument({ document: [1] }))).toBe('format_document_not_object');
    expect(codeOf(() => assertEnvelopeDocument({ document: null }))).toBe('format_document_not_object');
    expect(codeOf(() => assertEnvelopeDocument({ document: 'text' }))).toBe('format_document_not_object');
  });

  it('refuses a document nested deeper than the kit allows, without recursing', () => {
    let deep: unknown = [];
    for (let i = 0; i < 100_000; i += 1) deep = [deep];
    expect(codeOf(() => assertEnvelopeDocument({ document: { a: deep } }))).toBe('format_document_too_deep');
  });
});
