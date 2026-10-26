import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalizeJson, contentHash, deepFreeze, inspectJson, JsonError, sha256Hex, utf8ByteLength } from '../json';
import { mulberry32, shuffle } from '../test-utils/prng';

function nestArrays(depth: number): unknown {
  let value: unknown = [];
  for (let i = 1; i < depth; i += 1) value = [value];
  return value;
}

describe('canonicalizeJson', () => {
  it('sorts keys by UTF-16 code unit and emits no whitespace', () => {
    expect(canonicalizeJson({ b: 1, a: { d: [1, 2], c: null }, B: true })).toBe('{"B":true,"a":{"c":null,"d":[1,2]},"b":1}');
    // Code-unit order: "\uD83D" (surrogate) sorts before "～".
    expect(canonicalizeJson({ '～': 1, '\u{1f600}': 2 })).toBe('{"\u{1f600}":2,"～":1}');
  });

  it('is independent of key order', () => {
    const rng = mulberry32(7);
    const doc = { stages: [{ key: 'a', n: 1, nested: { x: 1, y: [1, { q: 1, p: 2 }] } }], name: 'x', z: false };
    const shuffled = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(shuffled);
      if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(shuffle(rng, Object.entries(value)).map(([k, v]) => [k, shuffled(v)]));
      }
      return value;
    };
    const base = canonicalizeJson(doc);
    for (let i = 0; i < 20; i += 1) {
      const variant = shuffled(doc);
      expect(canonicalizeJson(variant)).toBe(base);
      expect(contentHash(variant)).toBe(contentHash(doc));
    }
  });

  it('writes -0 as 0, unicode as is, and keeps array order', () => {
    expect(canonicalizeJson([-0, 0, 1e21, 1.5, -2])).toBe('[0,0,1e+21,1.5,-2]');
    expect(canonicalizeJson({ s: 'ü€\u{1f600}\n"\\' })).toBe('{"s":"ü€\u{1f600}\\n\\"\\\\"}');
    expect(canonicalizeJson([[3, [2]], [1]])).toBe('[[3,[2]],[1]]');
    expect(canonicalizeJson([])).toBe('[]');
    expect(canonicalizeJson({})).toBe('{}');
    expect(canonicalizeJson(null)).toBe('null');
  });

  it('treats an own __proto__ key as ordinary data', () => {
    const parsed = JSON.parse('{"b":1,"__proto__":{"polluted":true}}') as object;
    expect(canonicalizeJson(parsed)).toBe('{"__proto__":{"polluted":true},"b":1}');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  it('throws a typed JsonError with the pointer', () => {
    let caught: unknown;
    try {
      canonicalizeJson({ a: [1, undefined] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JsonError);
    expect(caught).toMatchObject({ reason: 'not_json', pointer: '/a/1' });
  });

  it('handles the deepest allowed nesting without recursion trouble', () => {
    const text = canonicalizeJson(nestArrays(64));
    expect(text).toBe('['.repeat(64) + ']'.repeat(64));
  });
});

describe('inspectJson', () => {
  it('measures a valid document', () => {
    const doc = { a: [1, 'x', null, true], b: { c: -0 } };
    const result = inspectJson(doc);
    expect(result).toEqual({ ok: true, bytes: utf8ByteLength(canonicalizeJson(doc)), nodes: 8, depth: 2 });
  });

  it('counts a scalar root as depth 0 and an empty container as depth 1', () => {
    expect(inspectJson(5)).toMatchObject({ ok: true, depth: 0, nodes: 1 });
    expect(inspectJson([])).toMatchObject({ ok: true, depth: 1 });
  });

  it('bytes equals the canonical UTF-8 size', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 50; i += 1) {
      const doc = { ['k' + i]: 'üñí\u{1f600}'.repeat(i % 5), list: Array.from({ length: i % 7 }, (_, n) => n * 1.5), flag: i % 2 === 0, none: null, neg: -0 };
      const inspected = inspectJson(doc);
      expect(inspected.ok && inspected.bytes).toBe(utf8ByteLength(canonicalizeJson(doc)));
      void rng;
    }
  });

  it.each([
    ['undefined', undefined],
    ['a function', () => 1],
    ['a symbol', Symbol('x')],
    ['a bigint', BigInt(1)],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a Date-like object', Object.create(Date.prototype)],
    ['a Map', new Map()],
    ['a Set', new Set()],
    ['a class instance', new (class Foo { x = 1 })()],
  ])('rejects %s as not_json', (_name, value) => {
    expect(inspectJson(value)).toEqual({ ok: false, reason: 'not_json', pointer: '' });
    expect(inspectJson({ deep: [value] })).toEqual({ ok: false, reason: 'not_json', pointer: '/deep/0' });
  });

  it('accepts null-prototype objects but not exotic ones', () => {
    const bare = Object.create(null) as Record<string, number>;
    bare.a = 1;
    expect(inspectJson(bare).ok).toBe(true);
    expect(inspectJson(Object.create({ inherited: 1 }))).toMatchObject({ ok: false, reason: 'not_json' });
    expect(inspectJson({ [Symbol('s')]: 1 })).toMatchObject({ ok: false, reason: 'not_json' });
    expect(inspectJson(Object.defineProperty({}, 'g', { get: () => 1, enumerable: true }))).toEqual({ ok: false, reason: 'not_json', pointer: '/g' });
  });

  it('rejects sparse arrays with the hole pointer', () => {
    expect(inspectJson({ list: [1, , 3] })).toEqual({ ok: false, reason: 'not_json', pointer: '/list/1' });
    expect(inspectJson(new Array(3))).toMatchObject({ ok: false, reason: 'not_json' });
  });

  it('rejects strings and keys containing NUL (jsonb cannot store them)', () => {
    expect(inspectJson({ a: 'x\u0000y' })).toEqual({ ok: false, reason: 'not_json', pointer: '/a' });
    expect(inspectJson({ ['k\u0000']: 1 })).toMatchObject({ ok: false, reason: 'not_json' });
    expect(inspectJson({ a: 'tab\t' }).ok).toBe(true);
  });

  it('rejects cycles through the depth bound', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(inspectJson(a)).toMatchObject({ ok: false, reason: 'depth' });
    const list: unknown[] = [];
    list.push(list, list);
    expect(inspectJson(list)).toMatchObject({ ok: false, reason: 'depth' });
  });

  it('depth 64 passes and depth 65 fails, reporting the pointer', () => {
    expect(inspectJson(nestArrays(64))).toMatchObject({ ok: true, depth: 64 });
    const tooDeep = inspectJson(nestArrays(65));
    expect(tooDeep).toMatchObject({ ok: false, reason: 'depth' });
    expect(tooDeep.ok === false && tooDeep.pointer).toBe('/0'.repeat(64));
  });

  it('rejects a 1,000,000-deep array and object without overflowing the stack', () => {
    let array: unknown = [];
    let object: unknown = {};
    for (let i = 0; i < 1_000_000; i += 1) {
      array = [array];
      object = { a: object };
    }
    expect(inspectJson(array)).toMatchObject({ ok: false, reason: 'depth' });
    expect(inspectJson(object)).toMatchObject({ ok: false, reason: 'depth' });
    expect(() => canonicalizeJson(array)).toThrow(JsonError);
  });

  it('enforces the node bound', () => {
    const roomy = { maxBytes: 10_000_000 };
    expect(inspectJson(new Array(150_000 - 1).fill(0), roomy).ok).toBe(true);
    expect(inspectJson(new Array(150_000).fill(0), roomy)).toMatchObject({ ok: false, reason: 'nodes' });
    expect(inspectJson([1, 2, 3], { maxNodes: 3 })).toMatchObject({ ok: false, reason: 'nodes' });
    expect(inspectJson({ a: 1, b: 2 }, { maxNodes: 3 }).ok).toBe(true);
    // A hostile length is rejected before its elements are visited.
    expect(inspectJson(new Array(1e9))).toMatchObject({ ok: false, reason: 'nodes' });
  });

  it('enforces the byte bound at 262144', () => {
    // {"a":"..."} costs 8 bytes of structure around the string content.
    const fits = { a: 'x'.repeat(262_144 - 8) };
    expect(inspectJson(fits)).toMatchObject({ ok: true, bytes: 262_144 });
    const over = inspectJson({ a: 'x'.repeat(262_144 - 7) });
    expect(over).toMatchObject({ ok: false, reason: 'bytes' });
    expect(over.ok === false && over.pointer).toBe('/a');
    // Multi-byte characters count their UTF-8 size.
    expect(inspectJson({ a: 'ü'.repeat(131_072) })).toMatchObject({ ok: false, reason: 'bytes' });
    expect(inspectJson('x'.repeat(10), { maxBytes: 11 }).ok).toBe(false);
  });

  it('honours custom limits', () => {
    expect(inspectJson([[1]], { maxDepth: 1 })).toMatchObject({ ok: false, reason: 'depth' });
    expect(inspectJson([[1]], { maxDepth: 2 }).ok).toBe(true);
  });

  it('never throws on a revoked proxy', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(inspectJson({ p: proxy })).toMatchObject({ ok: false, reason: 'not_json' });
  });
});

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ])('known vector %j', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it('matches node:crypto for multibyte text and padding boundaries', () => {
    const samples = ['grüße 日本語 \u{1f600}', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'a'.repeat(1000), '\ud800 lone'];
    for (const sample of samples) {
      expect(sha256Hex(sample)).toBe(createHash('sha256').update(sample, 'utf8').digest('hex'));
    }
  });

  it('contentHash hashes the canonical text', () => {
    expect(contentHash({ b: 1, a: 2 })).toBe(sha256Hex('{"a":2,"b":1}'));
    expect(contentHash({ a: 2, b: 1 })).toBe(contentHash({ b: 1, a: 2 }));
    expect(contentHash({ a: 2, b: 2 })).not.toBe(contentHash({ a: 2, b: 1 }));
  });
});

describe('deepFreeze', () => {
  it('freezes nested arrays and objects and returns the same value', () => {
    const doc = { a: [1, { b: [2] }], c: { d: { e: 1 } } };
    expect(deepFreeze(doc)).toBe(doc);
    expect(Object.isFrozen(doc)).toBe(true);
    expect(Object.isFrozen(doc.a)).toBe(true);
    expect(Object.isFrozen(doc.a[1])).toBe(true);
    expect(Object.isFrozen((doc.a[1] as { b: number[] }).b)).toBe(true);
    expect(Object.isFrozen(doc.c.d)).toBe(true);
    expect(() => {
      'use strict';
      doc.c.d.e = 2;
    }).toThrow(TypeError);
  });

  it('is idempotent, copes with cycles and with a very deep chain', () => {
    const doc = { a: { b: 1 } };
    deepFreeze(doc);
    expect(deepFreeze(doc)).toBe(doc);
    const loop: Record<string, unknown> = { n: 1 };
    loop.self = loop;
    deepFreeze(loop);
    expect(Object.isFrozen(loop)).toBe(true);
    let deep: unknown = { leaf: true };
    const chain = deep;
    for (let i = 0; i < 100_000; i += 1) deep = { next: deep };
    deepFreeze(deep);
    expect(Object.isFrozen(chain)).toBe(true);
    expect(deepFreeze(5)).toBe(5);
    expect(deepFreeze(null)).toBeNull();
  });
});
