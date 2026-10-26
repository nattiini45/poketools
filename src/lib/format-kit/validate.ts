/**
 * Server validation of a format definition: bounded JSON walk, reserved/degrade pre-pass, then the
 * zod schema. SERVER ONLY (zod). `validate.browser.ts` is its twin without zod; both return the
 * same `ValidationResult` for the same input (issues, normalised value, notes), proven by
 * `__tests__/validate-parity.test.ts`.
 */
import { finalizeIssues, mapZodIssues, sortNotes, type ValidationResult } from './issues';
import { precheckInput, prepareDocument } from './registry/validate-spec';
import { documentShape } from './schema/document';
import type { FormatDefinition } from './types';

export function validateFormatDefinition(input: unknown): ValidationResult {
  const blocked = precheckInput(input);
  if (blocked) return { ok: false, issues: [blocked] };

  const prepared = prepareDocument(input);
  // reportInput: an absent value must be told from a wrong one (see mapZodIssues).
  const parsed = documentShape.safeParse(prepared.doc, { reportInput: true });
  const issues = finalizeIssues([...prepared.issues, ...(parsed.success ? [] : mapZodIssues(parsed.error.issues))]);
  if (issues.length > 0 || !parsed.success) return { ok: false, issues };
  return { ok: true, value: parsed.data as FormatDefinition, notes: sortNotes(prepared.notes) };
}
