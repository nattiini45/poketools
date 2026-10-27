/**
 * Bounded request bodies of the format routes: the studio core's readers (`@/lib/studio-core/api-body`: the
 * `content-length` check, the single read, the 1 MiB cap, the parse that never echoes its error) bound to the format
 * error for an oversized body (413 `format_document_too_large`) and to the format document gate.
 *
 * No Next import: the helpers work on the standard `Request`.
 */
import { createBodyReaders } from '@/lib/studio-core/api-body';
import { assertDocument } from './document-guard';
import { FormatStudioError } from './errors';

export const { readBoundedJson, readBoundedJsonOrEmpty, assertEnvelopeDocument } = createBodyReaders({
  tooLarge: () => new FormatStudioError('format_document_too_large'),
  assertDocument,
});
