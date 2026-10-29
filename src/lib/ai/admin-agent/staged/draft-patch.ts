/**
 * The pure parts of `ruleset_patch_draft` (plan 3.6.5): the `ops_json` the model sends, parsed and bounded, applied with the
 * shared `applyPatch` of the studio core to the draft document, and the size of that document as the snapshot table
 * measures it. Nothing here reads or writes anything; the runner (`draft-tools.ts`) owns the I/O.
 *
 * A refusal is a short, plain description of kinds, indices and paths (`op 2: path_not_found`), never a zod message and
 * never a value of the document.
 */
import { z } from 'zod';
import { inspectJson, type JsonValue } from '@/lib/studio-core/json';
import { applyPatch, type PatchOp } from '@/lib/studio-core/patch';

/** Bounds on the operations of one call. `ops_json` itself is at most 20,000 characters (the tool's own schema). */
export const DRAFT_PATCH_LIMITS = Object.freeze({ ops: 200, pathChars: 512, valueBytes: 20_000 });

/** The most a snapshot may weigh, measured the way the table's CHECK does (`octet_length(document::text)`). */
export const SNAPSHOT_MAX_BYTES = 262_144;

const patchValue = z.custom<JsonValue>((value) => value !== undefined && inspectJson(value, { maxBytes: DRAFT_PATCH_LIMITS.valueBytes }).ok, {
  message: 'value_not_json',
});

const path = z.string().max(DRAFT_PATCH_LIMITS.pathChars);

const opsSchema = z
  .array(
    z.discriminatedUnion('op', [
      z.strictObject({ op: z.literal('add'), path, value: patchValue }),
      z.strictObject({ op: z.literal('replace'), path, value: patchValue }),
      z.strictObject({ op: z.literal('remove'), path }),
    ]),
  )
  .min(1)
  .max(DRAFT_PATCH_LIMITS.ops);

export type ParsedOps = { ok: true; ops: PatchOp[] } | { ok: false; issues: string };

/** Parses the model's `ops_json`: a JSON array of strict `add` / `replace` / `remove` operations on non-root paths. */
export function parsePatchOps(opsJson: string): ParsedOps {
  let raw: unknown;
  try {
    raw = JSON.parse(opsJson);
  } catch {
    return { ok: false, issues: 'ops_json: not valid JSON' };
  }
  const parsed = opsSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join('/') || '/'}: ${issue.code}`)
      .join('; ');
    return { ok: false, issues: `ops_json: ${issues}` };
  }
  const rootAt = parsed.data.findIndex((op) => op.path === '');
  if (rootAt !== -1) return { ok: false, issues: `op ${rootAt}: root_path_not_allowed` };
  return { ok: true, ops: parsed.data as PatchOp[] };
}

const isRecord = (value: unknown): value is Record<string, JsonValue> => typeof value === 'object' && value !== null && !Array.isArray(value);

export type PatchedDocument = { ok: true; document: Record<string, JsonValue> } | { ok: false; issues: string };

/** Applies `ops` to `document` (never mutated). The result must still be a JSON object, the shape the route takes. */
export function patchDocument(document: Record<string, JsonValue>, ops: readonly PatchOp[]): PatchedDocument {
  const applied = applyPatch(document, ops);
  if (!applied.ok) return { ok: false, issues: `op ${applied.index}: ${applied.reason}` };
  if (!isRecord(applied.value)) return { ok: false, issues: 'document: result_not_an_object' };
  return { ok: true, document: applied.value };
}

const encoder = new TextEncoder();
const MAX_MEASURE_DEPTH = 128;

/**
 * The size in bytes of `value` as Postgres prints a `jsonb` (`{"a": 1, "b": [1, 2]}`: one space after every colon and
 * comma), which is what the snapshot table's size CHECK counts. The compact `JSON.stringify` is smaller, so measuring it
 * would let a document through that the insert then refuses. `Infinity` for a value nested deeper than any stored document.
 */
export function jsonbTextBytes(value: unknown, depth = 0): number {
  if (depth > MAX_MEASURE_DEPTH) return Number.POSITIVE_INFINITY;
  if (value === null) return 4;
  switch (typeof value) {
    case 'boolean':
      return value ? 4 : 5;
    case 'number':
      return String(value).length;
    case 'string':
      return encoder.encode(JSON.stringify(value)).length;
    case 'object': {
      if (Array.isArray(value)) {
        let total = 2 + 2 * Math.max(value.length - 1, 0);
        for (const item of value) total += jsonbTextBytes(item, depth + 1);
        return total;
      }
      const entries = Object.entries(value as Record<string, unknown>);
      let total = 2 + 2 * Math.max(entries.length - 1, 0);
      for (const [key, item] of entries) total += encoder.encode(JSON.stringify(key)).length + 2 + jsonbTextBytes(item, depth + 1);
      return total;
    }
    default:
      return Number.POSITIVE_INFINITY;
  }
}
