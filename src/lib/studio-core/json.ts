/**
 * Bounded, canonical JSON helpers: an iterative size/shape inspector, canonical serialisation,
 * a pure synchronous SHA-256 and an iterative deep freeze. Shared by the format kit, the ruleset kit and both studios
 * (the studio core).
 *
 * Nothing here recurses over the input, so a hostile document (a megabyte of `[[[[...`) cannot
 * overflow the stack. Nothing imports node:crypto or uses crypto.subtle: the same code runs in the
 * browser and on the server and produces the same hash.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export interface InspectLimits {
  /** Maximum container nesting (scalars add no depth). */
  maxDepth: number;
  maxNodes: number;
  /** Maximum size of the canonical UTF-8 encoding. */
  maxBytes: number;
}

export const DEFAULT_INSPECT_LIMITS: Readonly<InspectLimits> = Object.freeze({
  maxDepth: 64,
  maxNodes: 150_000,
  maxBytes: 262_144,
});

export type JsonFailReason = 'not_json' | 'depth' | 'nodes' | 'bytes';

export type InspectResult =
  | { ok: true; bytes: number; nodes: number; depth: number }
  | { ok: false; reason: JsonFailReason; pointer: string };

export class JsonError extends Error {
  readonly reason: JsonFailReason;
  readonly pointer: string;
  constructor(reason: JsonFailReason, pointer: string) {
    super(`not canonical JSON: ${reason} at "${pointer}"`);
    this.name = 'JsonError';
    this.reason = reason;
    this.pointer = pointer;
  }
}

const textEncoder = new TextEncoder();

export function utf8ByteLength(s: string): number {
  return textEncoder.encode(s).length;
}

function escapeSegment(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** A walk frame. The parent chain rebuilds a JSON pointer only when a failure is reported. */
interface Frame {
  value: unknown;
  parent: Frame | null;
  segment: string;
}

function pointerOf(frame: Frame | null): string {
  const parts: string[] = [];
  for (let f = frame; f !== null && f.parent !== null; f = f.parent) parts.push(escapeSegment(f.segment));
  let out = '';
  for (let i = parts.length - 1; i >= 0; i -= 1) out += '/' + parts[i];
  return out;
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Walk `value` with an explicit stack and check that it is plain JSON within the limits. Never
 * throws, never recurses.
 *
 * Not JSON: undefined, functions, symbols, bigint, NaN/Infinity, Date/Map/Set/class instances (only
 * plain objects and arrays are accepted), sparse arrays, accessor properties, symbol keys, strings
 * containing U+0000 (Postgres jsonb cannot store them) and cycles (they exceed the depth bound).
 * `bytes` is the size of the canonical encoding (see `canonicalizeJson`).
 */
export function inspectJson(value: unknown, limits: Partial<InspectLimits> = {}): InspectResult {
  const maxDepth = limits.maxDepth ?? DEFAULT_INSPECT_LIMITS.maxDepth;
  const maxNodes = limits.maxNodes ?? DEFAULT_INSPECT_LIMITS.maxNodes;
  const maxBytes = limits.maxBytes ?? DEFAULT_INSPECT_LIMITS.maxBytes;

  let bytes = 0;
  let nodes = 1;
  let maxSeenDepth = 0;
  const root: Frame = { value, parent: null, segment: '' };
  // Each stack entry carries the container depth of its frame (0 for scalars).
  const stack: { frame: Frame; depth: number }[] = [{ frame: root, depth: 0 }];
  let current: Frame = root;

  const fail = (reason: JsonFailReason, frame: Frame): InspectResult => ({ ok: false, reason, pointer: pointerOf(frame) });

  try {
    while (stack.length > 0) {
      const entry = stack.pop() as { frame: Frame; depth: number };
      const frame = entry.frame;
      current = frame;
      const v = frame.value;

      if (v === null) {
        bytes += 4;
      } else if (typeof v === 'boolean') {
        bytes += v ? 4 : 5;
      } else if (typeof v === 'number') {
        if (!Number.isFinite(v)) return fail('not_json', frame);
        bytes += JSON.stringify(v).length;
      } else if (typeof v === 'string') {
        if (v.includes('\u0000')) return fail('not_json', frame);
        // A UTF-16 code unit encodes to at least one byte, so this rejects a giant string cheaply.
        if (bytes + v.length > maxBytes) return fail('bytes', frame);
        bytes += utf8ByteLength(JSON.stringify(v));
      } else if (typeof v === 'object') {
        const depth = entry.depth;
        // A container at index `depth` sits at nesting level depth + 1.
        if (depth >= maxDepth) return fail('depth', frame);
        if (depth > maxSeenDepth) maxSeenDepth = depth;
        if (Array.isArray(v)) {
          const length = v.length;
          if (nodes + length > maxNodes) return fail('nodes', frame);
          bytes += 2 + (length > 1 ? length - 1 : 0);
          for (let i = length - 1; i >= 0; i -= 1) {
            if (!Object.prototype.hasOwnProperty.call(v, i)) return fail('not_json', { value: undefined, parent: frame, segment: String(i) });
            nodes += 1;
            stack.push({ frame: { value: v[i], parent: frame, segment: String(i) }, depth: depth + 1 });
          }
        } else {
          if (!isPlainObject(v)) return fail('not_json', frame);
          if (Object.getOwnPropertySymbols(v).length > 0) return fail('not_json', frame);
          const keys = Object.keys(v);
          if (nodes + keys.length > maxNodes) return fail('nodes', frame);
          bytes += 2 + (keys.length > 1 ? keys.length - 1 : 0);
          for (let i = keys.length - 1; i >= 0; i -= 1) {
            const key = keys[i];
            const descriptor = Object.getOwnPropertyDescriptor(v, key);
            const child: Frame = { value: descriptor?.value, parent: frame, segment: key };
            if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) return fail('not_json', child);
            if (key.includes('\u0000')) return fail('not_json', child);
            if (bytes + key.length > maxBytes) return fail('bytes', child);
            bytes += utf8ByteLength(JSON.stringify(key)) + 1;
            nodes += 1;
            stack.push({ frame: child, depth: depth + 1 });
          }
        }
        if (bytes > maxBytes) return fail('bytes', frame);
        continue;
      } else {
        // undefined, function, symbol, bigint
        return fail('not_json', frame);
      }
      if (bytes > maxBytes) return fail('bytes', frame);
    }
  } catch {
    // A revoked proxy or a throwing getter: not plain JSON.
    return fail('not_json', current);
  }
  if (nodes > maxNodes) return fail('nodes', root);
  // Depth counts containers: the deepest container entered sits at index maxSeenDepth, so the
  // nesting level is one more (a scalar root is 0).
  const containers = typeof value === 'object' && value !== null ? maxSeenDepth + 1 : 0;
  return { ok: true, bytes, nodes, depth: containers };
}

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, strings and numbers as
 * `JSON.stringify` writes them (`-0` becomes `0`). Output is built by concatenation, never by
 * assigning into a plain object, so an own `__proto__` key is ordinary data.
 *
 * Throws `JsonError` for anything `inspectJson` rejects. The default limits apply; pass `limits`
 * to widen or narrow them.
 */
export function canonicalizeJson(value: unknown, limits: Partial<InspectLimits> = {}): string {
  const inspected = inspectJson(value, limits);
  if (!inspected.ok) throw new JsonError(inspected.reason, inspected.pointer);

  let out = '';
  // Tasks are either literal text to emit or a value still to write; popped last-in first-out.
  const stack: (string | { value: unknown })[] = [{ value }];
  while (stack.length > 0) {
    const task = stack.pop() as string | { value: unknown };
    if (typeof task === 'string') {
      out += task;
      continue;
    }
    const v = task.value;
    if (v === null) out += 'null';
    else if (typeof v === 'boolean') out += v ? 'true' : 'false';
    else if (typeof v === 'number') out += JSON.stringify(v);
    else if (typeof v === 'string') out += JSON.stringify(v);
    else if (Array.isArray(v)) {
      stack.push(']');
      for (let i = v.length - 1; i >= 0; i -= 1) {
        stack.push({ value: v[i] });
        if (i > 0) stack.push(',');
      }
      stack.push('[');
    } else {
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      stack.push('}');
      for (let i = keys.length - 1; i >= 0; i -= 1) {
        stack.push({ value: obj[keys[i]] });
        stack.push(JSON.stringify(keys[i]) + ':');
        if (i > 0) stack.push(',');
      }
      stack.push('{');
    }
  }
  return out;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** SHA-256 of the UTF-8 encoding of `text`, as 64 lower-case hex digits. Pure and synchronous. */
export function sha256Hex(text: string): string {
  const data = textEncoder.encode(text);
  const bitLength = data.length * 8;
  // Pad: 0x80, zeros up to 56 mod 64, then the 64-bit big-endian bit length.
  const paddedLength = (((data.length + 8) >> 6) + 1) << 6;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(data);
  buffer[data.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }
  let hex = '';
  for (let i = 0; i < 8; i += 1) hex += h[i].toString(16).padStart(8, '0');
  return hex;
}

/** SHA-256 of the canonical JSON of `value`. Key order and whitespace never change the hash. */
export function contentHash(value: unknown): string {
  return sha256Hex(canonicalizeJson(value));
}

/** Freeze `v` and everything reachable from it. Iterative; cycles are visited once. */
export function deepFreeze<T>(v: T): T {
  const seen = new Set<object>();
  const stack: unknown[] = [v];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item !== 'object' || item === null || seen.has(item)) continue;
    seen.add(item);
    Object.freeze(item);
    for (const key of Reflect.ownKeys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (descriptor !== undefined && 'value' in descriptor) stack.push(descriptor.value);
    }
  }
  return v;
}
