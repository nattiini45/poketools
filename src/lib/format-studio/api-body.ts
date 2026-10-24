/**
 * Bounded request bodies of the format routes.
 *
 * `readBoundedJson` refuses an oversized body BEFORE it is parsed: the `content-length` header first (a client
 * that tells the truth never makes the server read anything), then the text itself once (a client that lies or
 * streams chunked bodies is caught by the length check on what was actually read). The 1 MiB raw cap is above the
 * 262,144-byte canonical limit on purpose: a client may send indented JSON. The canonical limit and the depth and
 * node limits belong to `assertDocument`, which `assertEnvelopeDocument` runs on the `document` member of an
 * envelope before any zod parse or database call.
 *
 * No Next import: the helpers work on the standard `Request`.
 */
import { UserFacingError } from '@/lib/api/user-facing-error';
import { assertDocument } from './document-guard';
import { FormatStudioError } from './errors';

/** Largest accepted raw request body (UTF-8 bytes). */
export const MAX_REQUEST_BODY_BYTES = 1_048_576;

type BodyReader = Pick<Request, 'headers' | 'text'>;

function declaredLength(request: BodyReader): number | null {
  const header = request.headers.get('content-length');
  if (header === null) return null;
  const length = Number(header);
  return Number.isFinite(length) && length >= 0 ? length : null;
}

function invalidJson(): UserFacingError {
  return new UserFacingError('Invalid JSON body', { code: 'invalid_json', status: 400 });
}

/** The raw text of a body within `maxBytes`; throws `format_document_too_large` otherwise. */
async function readBoundedText(request: BodyReader, maxBytes: number): Promise<string> {
  const declared = declaredLength(request);
  if (declared !== null && declared > maxBytes) throw new FormatStudioError('format_document_too_large');
  const text = await request.text();
  // A UTF-16 code unit encodes to at least one byte, so a longer string is certainly too large.
  if (text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) {
    throw new FormatStudioError('format_document_too_large');
  }
  return text;
}

/**
 * Reads and parses a JSON body of at most `maxBytes` bytes. An empty or unparsable body is a 400
 * `invalid_json` (the parse error is never echoed); an oversized one is a 413 `format_document_too_large`.
 */
export async function readBoundedJson(request: BodyReader, maxBytes: number = MAX_REQUEST_BODY_BYTES): Promise<unknown> {
  const text = await readBoundedText(request, maxBytes);
  if (text.trim() === '') throw invalidJson();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidJson();
  }
}

/**
 * Like `readBoundedJson`, but a blank body reads as an empty object. For routes whose whole body is optional
 * (the fork routes, whose only member is an optional slug).
 */
export async function readBoundedJsonOrEmpty(request: BodyReader, maxBytes: number = MAX_REQUEST_BODY_BYTES): Promise<unknown> {
  const text = await readBoundedText(request, maxBytes);
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidJson();
  }
}

/**
 * Runs `assertDocument` on the `document` member of an envelope, when the envelope is an object that has one.
 * The kit's iterative pre-check bounds depth, node count and size before zod or the database see the value; an
 * envelope without a `document` member (or not an object) is left to the zod envelope to reject.
 */
export function assertEnvelopeDocument(envelope: unknown): void {
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) return;
  if (!Object.prototype.hasOwnProperty.call(envelope, 'document')) return;
  assertDocument((envelope as Record<string, unknown>).document);
}
