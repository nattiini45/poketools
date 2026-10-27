/**
 * DOM ids of the editor fields, derived from the JSON pointer an issue names, so an issue can jump to its field. The
 * prefix tells the studios apart (`ff` for format fields, a ruleset prefix for ruleset fields); a studio binds it once
 * (`fieldId('ff', pointer)` behind its own `fieldId(pointer)`).
 *
 * Pure and client-safe: ids only, no text.
 */
import { parsePointer } from './patch';

/** Characters outside `[a-z0-9_]` are written as `_x<hex>_`, so a segment never contains the `-` joiner. */
function idSegment(segment: string): string {
  let out = '';
  for (const char of segment) {
    out += /[a-z0-9_]/.test(char) ? char : `_x${(char.codePointAt(0) ?? 0).toString(16)}_`;
  }
  return out;
}

/** The DOM id of the field a pointer names: the prefix and the segments joined by `-`, only `[a-z0-9_-]`. */
export function fieldId(prefix: string, pointer: string): string {
  const segments = parsePointer(pointer) ?? [pointer];
  return `${prefix}-${segments.map(idSegment).join('-')}`;
}

/** The DOM id of the message that belongs to a field (`aria-describedby` points here). */
export function errorId(prefix: string, pointer: string): string {
  return `${fieldId(prefix, pointer)}-err`;
}

/**
 * Field ids to try, in order, when jumping to a problem: the pointer itself, then each parent down to the first
 * segment (`/stages/0/pairing/legs`, `/stages/0/pairing`, `/stages/0`, `/stages`). The caller focuses the first one that
 * exists on the page.
 */
export function jumpCandidates(prefix: string, pointer: string): string[] {
  const segments = parsePointer(pointer);
  if (segments === null || segments.length === 0) return [];
  const out: string[] = [];
  for (let length = segments.length; length >= 1; length -= 1) {
    out.push(`${prefix}-${segments.slice(0, length).map(idSegment).join('-')}`);
  }
  return out;
}
