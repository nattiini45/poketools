/**
 * The list columns of a stored definition (`name`, `description`) follow the document's `identity` block, in the format
 * kit and the ruleset kit alike. A draft may be half built, so the identity is read leniently: a value that is not a
 * valid localized text gives `null`, and the caller keeps the stored column. Server side (zod, through `text-schema.ts`).
 */
import type { LText } from './ltext';
import { ltextSchema } from './text-schema';

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
