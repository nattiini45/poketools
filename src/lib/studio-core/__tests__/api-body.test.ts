import { describe, expect, it } from 'vitest';
import { MAX_REQUEST_BODY_BYTES, createBodyReaders } from '../api-body';

class TooLarge extends Error {}
class BadDocument extends Error {}

const readers = createBodyReaders({
  tooLarge: () => new TooLarge('too large'),
  assertDocument: (document) => {
    if (typeof document !== 'object' || document === null) throw new BadDocument('bad');
  },
});

const body = (text: string, headers: Record<string, string> = {}) => new Request('http://localhost/x', { method: 'POST', body: text, headers });
/** A request whose content-length lies. */
const lying = (text: string, declared: number) => body(text, { 'content-length': String(declared) });

describe('createBodyReaders', () => {
  it('reads and parses a JSON body', async () => {
    expect(await readers.readBoundedJson(body('{"a":1}'))).toEqual({ a: 1 });
  });

  it('an empty or unparsable body is a 400 invalid_json and the parse error is not echoed', async () => {
    for (const text of ['', '   ', '{nope']) {
      await expect(readers.readBoundedJson(body(text))).rejects.toMatchObject({ code: 'invalid_json', statusCode: 400 });
      await expect(readers.readBoundedJson(body(text))).rejects.toThrow(/^Invalid JSON body$/);
    }
  });

  it('a blank body reads as an empty object where the whole body is optional', async () => {
    expect(await readers.readBoundedJsonOrEmpty(body(''))).toEqual({});
    expect(await readers.readBoundedJsonOrEmpty(body('{"slug":"x"}'))).toEqual({ slug: 'x' });
    await expect(readers.readBoundedJsonOrEmpty(body('{nope'))).rejects.toMatchObject({ code: 'invalid_json' });
  });

  it('refuses by the declared length before reading anything', async () => {
    const request = lying('{}', MAX_REQUEST_BODY_BYTES + 1);
    await expect(readers.readBoundedJson(request)).rejects.toBeInstanceOf(TooLarge);
    expect(request.bodyUsed).toBe(false);
  });

  it('refuses by the text itself when the header lies or is missing', async () => {
    const big = JSON.stringify({ text: 'x'.repeat(2_000) });
    await expect(readers.readBoundedJson(body(big), 1_000)).rejects.toBeInstanceOf(TooLarge);
    await expect(readers.readBoundedJson(lying(big, 2), 1_000)).rejects.toBeInstanceOf(TooLarge);
    await expect(readers.readBoundedJson(body('{}'), 1_000)).resolves.toEqual({});
  });

  it('counts bytes, not characters', async () => {
    await expect(readers.readBoundedJson(body(JSON.stringify({ t: 'ü'.repeat(60) })), 100)).rejects.toBeInstanceOf(TooLarge);
  });

  it('runs the studio gate on the document member of an envelope only', () => {
    expect(() => readers.assertEnvelopeDocument({ document: {} })).not.toThrow();
    expect(() => readers.assertEnvelopeDocument({ document: null })).toThrow(BadDocument);
    for (const envelope of [{ name: 'x' }, null, [1], 'text', 7]) expect(() => readers.assertEnvelopeDocument(envelope)).not.toThrow();
  });
});
