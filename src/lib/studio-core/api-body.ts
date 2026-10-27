/**
 * Bounded request bodies of the studio routes.
 *
 * `readBoundedJson` refuses an oversized body BEFORE it is parsed: the `content-length` header first (a client that
 * tells the truth never makes the server read anything), then the text itself once (a client that lies or streams
 * chunked bodies is caught by the length check on what was actually read). The 1 MiB raw cap is above the 262,144-byte
 * canonical limit on purpose: a client may send indented JSON. The canonical limit and the depth and node limits belong
 * to the studio's `assertDocument`, which `assertEnvelopeDocument` runs on the `document` member of an envelope before
 * any zod parse or database call.
 *
 * `createBodyReaders` binds the two studio-specific parts: the error for an oversized body and the document gate.
 * No Next import: the helpers work on the standard `Request`.
 */
import { UserFacingError } from '@/lib/api/user-facing-error';

/** Largest accepted raw request body (UTF-8 bytes). */
export const MAX_REQUEST_BODY_BYTES = 1_048_576;

type BodyReader = Pick<Request, 'headers' | 'text'>;

export interface BodyReaderHooks {
  /** The error for a body over the cap (a 413 of the studio's own code). */
  tooLarge: () => Error;
  /** The studio's `assertDocument`. */
  assertDocument: (document: unknown) => void;
}

export interface BodyReaders {
  /**
   * Reads and parses a JSON body of at most `maxBytes` bytes. An empty or unparsable body is a 400 `invalid_json` (the
   * parse error is never echoed); an oversized one is the studio's 413.
   */
  readBoundedJson: (request: BodyReader, maxBytes?: number) => Promise<unknown>;
  /** Like `readBoundedJson`, but a blank body reads as an empty object (routes whose whole body is optional). */
  readBoundedJsonOrEmpty: (request: BodyReader, maxBytes?: number) => Promise<unknown>;
  /** Runs `assertDocument` on the `document` member of an envelope, when the envelope is an object that has one. */
  assertEnvelopeDocument: (envelope: unknown) => void;
}

function declaredLength(request: BodyReader): number | null {
  const header = request.headers.get('content-length');
  if (header === null) return null;
  const length = Number(header);
  return Number.isFinite(length) && length >= 0 ? length : null;
}

function invalidJson(): UserFacingError {
  return new UserFacingError('Invalid JSON body', { code: 'invalid_json', status: 400 });
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidJson();
  }
}

export function createBodyReaders(hooks: BodyReaderHooks): BodyReaders {
  /** The raw text of a body within `maxBytes`. */
  async function readBoundedText(request: BodyReader, maxBytes: number): Promise<string> {
    const declared = declaredLength(request);
    if (declared !== null && declared > maxBytes) throw hooks.tooLarge();
    const text = await request.text();
    // A UTF-16 code unit encodes to at least one byte, so a longer string is certainly too large.
    if (text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) throw hooks.tooLarge();
    return text;
  }

  return {
    async readBoundedJson(request, maxBytes = MAX_REQUEST_BODY_BYTES) {
      const text = await readBoundedText(request, maxBytes);
      if (text.trim() === '') throw invalidJson();
      return parse(text);
    },
    async readBoundedJsonOrEmpty(request, maxBytes = MAX_REQUEST_BODY_BYTES) {
      const text = await readBoundedText(request, maxBytes);
      return text.trim() === '' ? {} : parse(text);
    },
    assertEnvelopeDocument(envelope) {
      if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) return;
      if (!Object.prototype.hasOwnProperty.call(envelope, 'document')) return;
      hooks.assertDocument((envelope as Record<string, unknown>).document);
    },
  };
}
