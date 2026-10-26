/**
 * RFC 6901 JSON-pointer helpers and a small immutable patch applier (add / replace / remove).
 *
 * `applyPatch` never mutates its input: it clones only the spine that leads to the touched value
 * and shares everything else. It refuses object segments that could reach the prototype chain
 * (`__proto__`, `constructor`, `prototype`), and it walks the pointer iteratively.
 */
import type { JsonValue } from './json';

export type { JsonValue } from './json';

export type PatchOp = { op: 'add' | 'replace'; path: string; value: JsonValue } | { op: 'remove'; path: string };

export type PatchFailureReason =
  | 'invalid_op'
  | 'malformed_pointer'
  | 'forbidden_segment'
  | 'path_not_found'
  | 'index_out_of_range'
  | 'not_a_container'
  | 'cannot_remove_root';

export type PatchResult = { ok: true; value: JsonValue } | { ok: false; reason: PatchFailureReason; index: number };

const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export function escapePointerSegment(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Split a pointer into unescaped segments. `''` is the root (no segments); null when malformed. */
export function parsePointer(p: string): string[] | null {
  if (typeof p !== 'string') return null;
  if (p === '') return [];
  if (p.charCodeAt(0) !== 47 /* '/' */) return null;
  const raw = p.slice(1).split('/');
  const out: string[] = [];
  for (const segment of raw) {
    // '~' must be followed by 0 or 1.
    if (/~(?![01])/.test(segment)) return null;
    out.push(segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  }
  return out;
}

function isRecord(v: unknown): v is { [k: string]: JsonValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The child of `container` at `segment`, or undefined when absent. Arrays accept canonical indices only. */
function childAt(container: JsonValue, segment: string): { found: true; value: JsonValue } | { found: false } {
  if (Array.isArray(container)) {
    if (!ARRAY_INDEX.test(segment)) return { found: false };
    const index = Number(segment);
    return index < container.length ? { found: true, value: container[index] } : { found: false };
  }
  if (isRecord(container) && hasOwn(container, segment)) return { found: true, value: container[segment] };
  return { found: false };
}

export function getAtPointer(doc: JsonValue, pointer: string): { found: true; value: JsonValue } | { found: false } {
  const segments = parsePointer(pointer);
  if (segments === null) return { found: false };
  let current: JsonValue = doc;
  for (const segment of segments) {
    const next = childAt(current, segment);
    if (!next.found) return next;
    current = next.value;
  }
  return { found: true, value: current };
}

type Step = { ok: true; value: JsonValue } | { ok: false; reason: PatchFailureReason };

const fail = (reason: PatchFailureReason): Step => ({ ok: false, reason });

function cloneWithChild(container: JsonValue, segment: string, child: JsonValue): JsonValue {
  if (Array.isArray(container)) {
    const copy = container.slice();
    copy[Number(segment)] = child;
    return copy;
  }
  const copy: { [k: string]: JsonValue } = { ...(container as { [k: string]: JsonValue }) };
  copy[segment] = child;
  return copy;
}

/** Apply the last segment of an op to its parent container; returns the changed clone. */
function changeParent(parent: JsonValue, last: string, op: PatchOp): Step {
  if (Array.isArray(parent)) {
    const copy = parent.slice();
    if (op.op === 'add') {
      if (last === '-') {
        copy.push(op.value);
        return { ok: true, value: copy };
      }
      if (!ARRAY_INDEX.test(last)) return fail('index_out_of_range');
      const index = Number(last);
      if (index > parent.length) return fail('index_out_of_range');
      copy.splice(index, 0, op.value);
      return { ok: true, value: copy };
    }
    if (last === '-') return fail('path_not_found');
    if (!ARRAY_INDEX.test(last)) return fail('index_out_of_range');
    const index = Number(last);
    if (index >= parent.length) return fail('index_out_of_range');
    if (op.op === 'replace') copy[index] = op.value;
    else copy.splice(index, 1);
    return { ok: true, value: copy };
  }
  if (isRecord(parent)) {
    if (op.op !== 'add' && !hasOwn(parent, last)) return fail('path_not_found');
    const copy: { [k: string]: JsonValue } = { ...parent };
    if (op.op === 'remove') delete copy[last];
    else copy[last] = op.value;
    return { ok: true, value: copy };
  }
  return fail('not_a_container');
}

function applyOne(doc: JsonValue, op: PatchOp): Step {
  if (typeof op !== 'object' || op === null) return fail('invalid_op');
  if (op.op !== 'add' && op.op !== 'replace' && op.op !== 'remove') return fail('invalid_op');
  if ((op.op === 'add' || op.op === 'replace') && !('value' in op)) return fail('invalid_op');
  const segments = parsePointer(op.path);
  if (segments === null) return fail('malformed_pointer');
  if (segments.some((s) => FORBIDDEN_SEGMENTS.has(s))) return fail('forbidden_segment');
  if (segments.length === 0) {
    if (op.op === 'remove') return fail('cannot_remove_root');
    return { ok: true, value: op.value };
  }

  // Descend, remembering the containers on the way down.
  const spine: JsonValue[] = [doc];
  for (let i = 0; i < segments.length - 1; i += 1) {
    const container = spine[i];
    if (typeof container !== 'object' || container === null) return fail('not_a_container');
    const next = childAt(container, segments[i]);
    if (!next.found) return fail('path_not_found');
    spine.push(next.value);
  }

  const changed = changeParent(spine[spine.length - 1], segments[segments.length - 1], op);
  if (!changed.ok) return changed;
  let node = changed.value;
  for (let i = spine.length - 2; i >= 0; i -= 1) node = cloneWithChild(spine[i], segments[i], node);
  return { ok: true, value: node };
}

/**
 * Apply `ops` in order. On the first failing op the result names the reason and the op's index;
 * `doc` and the ops are never modified. A value inserted by add/replace is shared, not copied.
 */
export function applyPatch(doc: JsonValue, ops: readonly PatchOp[]): PatchResult {
  let current = doc;
  for (let index = 0; index < ops.length; index += 1) {
    const outcome = applyOne(current, ops[index]);
    if (!outcome.ok) return { ok: false, reason: outcome.reason, index };
    current = outcome.value;
  }
  return { ok: true, value: current };
}
