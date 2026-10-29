import { describe, expect, it } from 'vitest';
import { DRAFT_PATCH_LIMITS, jsonbTextBytes, parsePatchOps, patchDocument, SNAPSHOT_MAX_BYTES } from '../draft-patch';

describe('parsePatchOps', () => {
  it('accepts add, replace and remove on non-root paths', () => {
    const parsed = parsePatchOps(
      JSON.stringify([
        { op: 'add', path: '/a/-', value: 'x' },
        { op: 'replace', path: '/b', value: { c: [1, null, true] } },
        { op: 'remove', path: '/d' },
      ]),
    );
    expect(parsed).toEqual({
      ok: true,
      ops: [
        { op: 'add', path: '/a/-', value: 'x' },
        { op: 'replace', path: '/b', value: { c: [1, null, true] } },
        { op: 'remove', path: '/d' },
      ],
    });
  });

  it.each([
    ['text that is not JSON', '{nope', 'not valid JSON'],
    ['an object instead of an array', '{"op":"add","path":"/a","value":1}', 'ops_json'],
    ['an empty array', '[]', 'ops_json'],
    ['an unknown op', '[{"op":"copy","from":"/a","path":"/b"}]', 'ops_json'],
    ['a missing value on add', '[{"op":"add","path":"/a"}]', 'ops_json'],
    ['a value on remove', '[{"op":"remove","path":"/a","value":1}]', 'ops_json'],
    ['a non-string path', '[{"op":"remove","path":3}]', 'ops_json'],
    ['the root path', '[{"op":"add","path":"","value":{}}]', 'op 0: root_path_not_allowed'],
  ])('refuses %s with a plain description', (_name, text, expected) => {
    const parsed = parsePatchOps(text);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.issues).toContain(expected);
  });

  it('bounds the number of operations, the path length and the size of a value', () => {
    const many = JSON.stringify(Array.from({ length: DRAFT_PATCH_LIMITS.ops + 1 }, () => ({ op: 'remove', path: '/a' })));
    expect(parsePatchOps(many).ok).toBe(false);
    expect(parsePatchOps(JSON.stringify([{ op: 'remove', path: `/${'a'.repeat(DRAFT_PATCH_LIMITS.pathChars)}` }])).ok).toBe(false);
    expect(parsePatchOps(JSON.stringify([{ op: 'add', path: '/a', value: 'x'.repeat(DRAFT_PATCH_LIMITS.valueBytes + 1) }])).ok).toBe(false);
  });
});

describe('patchDocument', () => {
  const document = { name: 'Spring', rules: { bans: ['a', 'b'] } };

  it('applies the operations in order with the shared applyPatch and never mutates the draft', () => {
    const snapshot = structuredClone(document);
    const result = patchDocument(document, [
      { op: 'add', path: '/rules/bans/-', value: 'c' },
      { op: 'replace', path: '/name', value: 'Autumn' },
      { op: 'remove', path: '/rules/bans/0' },
    ]);
    expect(result).toEqual({ ok: true, document: { name: 'Autumn', rules: { bans: ['b', 'c'] } } });
    expect(document).toEqual(snapshot);
  });

  it.each([
    ['path_not_found', { op: 'remove', path: '/missing' }],
    ['index_out_of_range', { op: 'add', path: '/rules/bans/7', value: 'x' }],
    ['not_a_container', { op: 'add', path: '/name/x', value: 1 }],
    ['malformed_pointer', { op: 'add', path: 'no-slash', value: 1 }],
    ['forbidden_segment', { op: 'add', path: '/constructor/x', value: 1 }],
  ] as const)('names the failing op and the reason: %s', (reason, op) => {
    expect(patchDocument(document, [{ op: 'replace', path: '/name', value: 'x' }, op])).toEqual({ ok: false, issues: `op 1: ${reason}` });
  });
});

describe('jsonbTextBytes', () => {
  it('counts what Postgres prints for a jsonb: a space after every colon and comma', () => {
    expect(jsonbTextBytes({ a: 1, b: [1, 2], c: 'x' })).toBe('{"a": 1, "b": [1, 2], "c": "x"}'.length);
    expect(jsonbTextBytes({})).toBe(2);
    expect(jsonbTextBytes([])).toBe(2);
    expect(jsonbTextBytes([null, true, false])).toBe('[null, true, false]'.length);
  });

  it('counts UTF-8 bytes, not characters', () => {
    expect(jsonbTextBytes({ n: 'Pokémon' })).toBe(Buffer.byteLength('{"n": "Pokémon"}'));
  });

  it('is larger than the compact form and refuses a hostile depth', () => {
    const value = { list: Array.from({ length: 1000 }, (_, i) => i) };
    expect(jsonbTextBytes(value)).toBeGreaterThan(JSON.stringify(value).length);
    let deep: unknown = 1;
    for (let i = 0; i < 200; i += 1) deep = [deep];
    expect(jsonbTextBytes(deep)).toBe(Number.POSITIVE_INFINITY);
    expect(SNAPSHOT_MAX_BYTES).toBe(262_144);
  });
});
