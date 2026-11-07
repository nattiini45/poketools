/**
 * Bounded request-body readers of the live-format routes: the studio core's readers bound to this surface's own 413
 * (`format_request_too_large`, a message about a request rather than about a document). The caps live next to the schemas
 * (`SMALL_BODY_MAX_BYTES`, `ADJUSTMENT_BODY_MAX_BYTES` in `api-schemas.ts`); a route passes the one that fits.
 */
import { createBodyReaders } from '@/lib/studio-core/api-body';
import { refuse } from './refusal';

const readers = createBodyReaders({
  tooLarge: () => refuse('format_request_too_large'),
  // The runtime has no document envelope.
  assertDocument: () => {},
});

/** Reads and parses a JSON body of at most `maxBytes` bytes: an oversized one is a 413, an empty or unparsable one a 400 `invalid_json`. */
export const readBoundedJson = readers.readBoundedJson;

/** Like `readBoundedJson`, but a blank body reads as `{}` (the unmask route has no input). */
export const readBoundedJsonOrEmpty = readers.readBoundedJsonOrEmpty;
