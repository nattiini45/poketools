/**
 * The list columns of a stored format (`name`, `description`) follow the document's `identity` block. A draft may
 * be half built, so the identity is read leniently: a value that is not a valid localized text gives `null`, and
 * the caller keeps the stored column.
 */
import { ltext, ltextSchema, type LText, type Locale } from '@/lib/format-kit';

export interface DocumentIdentity {
  name: LText | null;
  description: LText | null;
}

function ownRecord(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function parseLText(value: unknown): LText | null {
  const parsed = ltextSchema.safeParse(value);
  return parsed.success ? (parsed.data as LText) : null;
}

/** `identity.name` and `identity.summary` of a document, each `null` when absent or not a valid text. */
export function extractIdentity(document: unknown): DocumentIdentity {
  const identity = ownRecord(document, 'identity');
  return {
    name: parseLText(ownRecord(identity, 'name')),
    description: parseLText(ownRecord(identity, 'summary')),
  };
}

/** True when the document has an `identity.summary` member at all (valid or not). */
export function hasSummary(document: unknown): boolean {
  return ownRecord(ownRecord(document, 'identity'), 'summary') !== undefined;
}

/**
 * A new document that has only a name. It is invalid on purpose (no stage): the check the editor shows reports
 * what is still missing.
 */
export function skeletonDocument(name: string, base: Locale): Record<string, unknown> {
  const text = base === 'en' ? ltext('en', name) : ltext('de', undefined, name);
  return { schema_version: 1, identity: { name: text }, stages: [] };
}
