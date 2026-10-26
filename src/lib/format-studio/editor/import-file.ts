/**
 * Importing a format from a `.json` file: the checks the "New format" dialog runs on the file's text BEFORE it
 * posts anything. They mirror the API, in the same order and with the same limits, so a file the dialog accepts is
 * a file the server accepts, and a file it refuses never leaves the browser.
 *
 * The text is only ever parsed as JSON (inside a try/catch) and walked by the kit's iterative inspector and the
 * zod-free validator. Nothing is executed, nothing is evaluated, and no parsed object is spread into a prototype:
 * an own `__proto__` key of the file is ordinary data (the validator reports it as an unknown member).
 */
import {
  inspectJson,
  parsePointer,
  utf8ByteLength,
  validateFormatDefinition,
  type SchemaIssue,
  type SchemaNote,
} from '@/lib/format-kit/client';

/** The largest file the dialog reads; equals the largest request body the format routes accept. */
export const IMPORT_MAX_BYTES = 1_048_576;

export type ImportFailure =
  | 'empty'
  | 'too_large'
  | 'not_json'
  | 'not_object'
  | 'too_deep'
  | 'too_many_nodes'
  | 'name_required';

export interface ImportReport {
  /** The document as parsed (not normalised), so "import as is" stores what the server would store. */
  document: Record<string, unknown>;
  /** What the validator found; an unknown or reserved member is an issue here too. */
  issues: SchemaIssue[];
  /** Issues that are neither an unknown member nor a reserved section. */
  errorCount: number;
  /** Pointers of members the schema does not know. */
  unknownFields: string[];
  /** Pointers of sections the schema reserves for later (not available yet). */
  reserved: string[];
  /** Adjustments that are not errors (an unknown rule kind kept as a manual rule). */
  notes: SchemaNote[];
}

export type ImportResult = { ok: false; reason: ImportFailure } | { ok: true; report: ImportReport };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks the text of a chosen file. `byteLength` is the size of the file when the caller knows it (`File.size`);
 * the text's own UTF-8 length is used otherwise. The order mirrors the API: empty, size, JSON, an object, the
 * depth/node/size limits, the schema, then the name.
 */
export function prepareImport(text: string, byteLength?: number): ImportResult {
  if (text.trim() === '') return { ok: false, reason: 'empty' };
  const size = byteLength ?? utf8ByteLength(text);
  if (size > IMPORT_MAX_BYTES) return { ok: false, reason: 'too_large' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not_json' };
  }
  if (!isPlainObject(parsed)) return { ok: false, reason: 'not_object' };

  const inspected = inspectJson(parsed);
  if (!inspected.ok) {
    switch (inspected.reason) {
      case 'depth':
        return { ok: false, reason: 'too_deep' };
      case 'nodes':
        return { ok: false, reason: 'too_many_nodes' };
      case 'bytes':
        return { ok: false, reason: 'too_large' };
      default:
        return { ok: false, reason: 'not_json' };
    }
  }

  const validation = validateFormatDefinition(parsed);
  const issues = validation.ok ? [] : validation.issues;
  const notes = validation.ok ? validation.notes : [];
  const nameIsBroken = issues.some((issue) => issue.pointer === '/identity' || issue.pointer.startsWith('/identity/name'));
  if (nameIsBroken) return { ok: false, reason: 'name_required' };

  const unknownFields = issues.filter((issue) => issue.code === 'unknown_key').map((issue) => issue.pointer);
  const reserved = issues.filter((issue) => issue.code === 'not_available_yet').map((issue) => issue.pointer);
  const errorCount = issues.length - unknownFields.length - reserved.length;
  return { ok: true, report: { document: parsed, issues, errorCount, unknownFields, reserved, notes } };
}

/** Segments compared position by position: numbers numerically, others as text; a longer path (deeper) first. */
function compareSegments(a: readonly string[], b: readonly string[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    if (a[i] === b[i]) continue;
    const left = Number(a[i]);
    const right = Number(b[i]);
    if (Number.isInteger(left) && Number.isInteger(right)) return right - left;
    return a[i] < b[i] ? 1 : -1;
  }
  return b.length - a.length;
}

/** Removes one member (or array item) by its segments from a document this module owns; false when it is gone. */
function removeAt(root: unknown, segments: readonly string[]): boolean {
  if (segments.length === 0) return false;
  let node: unknown = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (Array.isArray(node)) {
      node = /^(?:0|[1-9][0-9]*)$/.test(segments[i]) ? node[Number(segments[i])] : undefined;
    } else if (isPlainObject(node) && Object.prototype.hasOwnProperty.call(node, segments[i])) {
      node = Object.getOwnPropertyDescriptor(node, segments[i])?.value;
    } else {
      return false;
    }
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(node)) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(last) || Number(last) >= node.length) return false;
    node.splice(Number(last), 1);
    return true;
  }
  if (isPlainObject(node) && Object.prototype.hasOwnProperty.call(node, last)) {
    // Reflect.deleteProperty also removes an own `__proto__` data property without touching a prototype.
    return Reflect.deleteProperty(node, last);
  }
  return false;
}

/**
 * A copy of the document without the members the schema does not know and the sections it reserves. Deepest and
 * last array item first, so an index never shifts under a pointer that is still to be removed.
 */
export function stripUnknownFields(report: ImportReport): Record<string, unknown> {
  const copy = structuredClone(report.document);
  const paths = [...report.unknownFields, ...report.reserved]
    .map((pointer) => parsePointer(pointer))
    .filter((segments): segments is string[] => segments !== null)
    .sort(compareSegments);
  for (const segments of paths) removeAt(copy, segments);
  return copy;
}
