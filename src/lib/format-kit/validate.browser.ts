/**
 * Browser validation of a format definition, without zod. Unlike `format-pack/validate.browser.ts`
 * this is NOT the identity: it runs the same bounded JSON walk and reserved/degrade pre-pass as
 * the server (`registry/validate-spec.ts`), then interprets `DOCUMENT_SPEC` (plain data built from
 * the manifest). It returns the same `ValidationResult` as `validate.ts` for every input; the
 * fuzz parity test `__tests__/validate-parity.test.ts` holds the two together.
 *
 * Nothing imports a `.browser` alias yet: the client barrel (`client.ts`) imports this file by its
 * path. The first client consumer PR adds the turbopack alias (as `format-pack` does) if the
 * bundler needs it.
 */
import { finalizeIssues, sortNotes, type ValidationResult } from './issues';
import { DOCUMENT_SPEC } from './registry/document-spec';
import { createSpecOut, precheckInput, prepareDocument, validateSpec } from './registry/validate-spec';
import type { FormatDefinition } from './types';

export function validateFormatDefinition(input: unknown): ValidationResult {
  const blocked = precheckInput(input);
  if (blocked) return { ok: false, issues: [blocked] };

  const prepared = prepareDocument(input);
  const out = createSpecOut();
  const value = validateSpec(DOCUMENT_SPEC, prepared.doc, '', out);
  const issues = finalizeIssues([...prepared.issues, ...out.issues]);
  if (issues.length > 0 || value === undefined) return { ok: false, issues };
  return { ok: true, value: value as FormatDefinition, notes: sortNotes([...prepared.notes, ...out.notes]) };
}
