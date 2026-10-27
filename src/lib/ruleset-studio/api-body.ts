/**
 * Bounded request bodies of the ruleset routes: the studio core's readers (`@/lib/studio-core/api-body`: the
 * `content-length` check, the single read, the 1 MiB cap, the parse that never echoes its error) bound to the ruleset
 * error for an oversized body (413 `ruleset_document_too_large`) and to the ruleset document gate.
 *
 * No Next import: the helpers work on the standard `Request`.
 */
import { createBodyReaders } from '@/lib/studio-core/api-body';
import { assertDocument } from './document-guard';
import { RulesetStudioError } from './errors';

export { MAX_REQUEST_BODY_BYTES } from '@/lib/studio-core/api-body';

export const { readBoundedJson, readBoundedJsonOrEmpty, assertEnvelopeDocument } = createBodyReaders({
  tooLarge: () => new RulesetStudioError('ruleset_document_too_large'),
  assertDocument,
});
