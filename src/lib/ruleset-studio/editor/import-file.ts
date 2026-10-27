/**
 * Importing a ruleset from a `.json` file: the checks the "New ruleset" dialog runs on the file's text BEFORE it posts
 * anything. They mirror the API, in the same order and with the same limits, so a file the dialog accepts is a file the
 * server accepts, and a file it refuses never leaves the browser.
 *
 * The text is only ever parsed as JSON (inside a try/catch) and walked by the iterative inspector and the zod-free
 * structure validator. Nothing is executed or evaluated. A file with structure issues is reported, not stored: the
 * dialog lists the first ones and offers no import until the file is fixed.
 */
import { validateRulesetDocument, type StructureIssue } from '@/lib/ruleset-kit/validate';
import { inspectJson, utf8ByteLength } from '@/lib/studio-core/json';

/** The largest file the dialog reads; equals the largest request body the ruleset routes accept. */
export const IMPORT_MAX_BYTES = 1_048_576;

export type ImportFailure = 'empty' | 'too_large' | 'not_json' | 'not_object' | 'too_deep' | 'too_many_nodes' | 'name_required';

export interface ImportReport {
  /** The document as parsed, so "import" stores what the server would store. */
  document: Record<string, unknown>;
  /** What the structure validator found (empty: the file is a ruleset document). */
  issues: StructureIssue[];
}

export type ImportResult = { ok: false; reason: ImportFailure } | { ok: true; report: ImportReport };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks the text of a chosen file. `byteLength` is the size of the file when the caller knows it (`File.size`); the
 * text's own UTF-8 length is used otherwise. The order mirrors the API: empty, size, JSON, an object, the depth, node and
 * size limits, the structure, then the name.
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

  const validation = validateRulesetDocument(parsed);
  const issues = validation.ok ? [] : validation.issues;
  if (issues.some((issue) => issue.path === '/identity' || issue.path.startsWith('/identity/name'))) return { ok: false, reason: 'name_required' };
  return { ok: true, report: { document: parsed, issues } };
}
