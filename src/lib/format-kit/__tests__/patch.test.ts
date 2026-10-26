import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../json';
import { applyPatch, escapePointerSegment, getAtPointer, parsePointer, type PatchOp } from '../patch';

const doc = (): JsonValue => ({ stages: [{ key: 'a', n: 1 }, { key: 'b', n: 2 }], 'a/b': { 'c~d': 1 }, title: 'x' });

function apply(ops: PatchOp[], input: JsonValue = doc()) {
  const snapshot = JSON.stringify(input);
  const result = applyPatch(input, ops);
  // The input is never mutated.
  expect(JSON.stringify(input)).toBe(snapshot);
  return result;
}

describe('pointers', () => {
  it('parses and escapes RFC 6901 segments', () => {
    expect(parsePointer('')).toEqual([]);
    expect(parsePointer('/')).toEqual(['']);
    expect(parsePointer('/a/b')).toEqual(['a', 'b']);
    expect(parsePointer('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
    expect(parsePointer('/~01')).toEqual(['~1']);
    expect(escapePointerSegment('a/b~c')).toBe('a~1b~0c');
    expect(parsePointer(`/${escapePointerSegment('x/y~z')}`)).toEqual(['x/y~z']);
  });

  it('returns null for malformed pointers', () => {
    expect(parsePointer('a')).toBeNull();
    expect(parsePointer('/a~')).toBeNull();
    expect(parsePointer('/a~2')).toBeNull();
    expect(parsePointer(undefined as unknown as string)).toBeNull();
  });

  it('reads values and reports absence', () => {
    expect(getAtPointer(doc(), '/stages/1/key')).toEqual({ found: true, value: 'b' });
    expect(getAtPointer(doc(), '/a~1b/c~0d')).toEqual({ found: true, value: 1 });
    expect(getAtPointer(doc(), '')).toMatchObject({ found: true });
    expect(getAtPointer(doc(), '/stages/2')).toEqual({ found: false });
    expect(getAtPointer(doc(), '/stages/01')).toEqual({ found: false });
    expect(getAtPointer(doc(), '/stages/-')).toEqual({ found: false });
    expect(getAtPointer(doc(), '/title/x')).toEqual({ found: false });
    expect(getAtPointer(doc(), '/toString')).toEqual({ found: false });
    expect(getAtPointer(doc(), 'bad')).toEqual({ found: false });
  });
});

describe('applyPatch', () => {
  it('adds, replaces and removes object members', () => {
    const result = apply([
      { op: 'add', path: '/extra', value: { x: 1 } },
      { op: 'replace', path: '/title', value: 'y' },
      { op: 'remove', path: '/a~1b' },
    ]);
    expect(result).toEqual({ ok: true, value: { stages: [{ key: 'a', n: 1 }, { key: 'b', n: 2 }], title: 'y', extra: { x: 1 } } });
  });

  it('add on an existing object key replaces it', () => {
    expect(apply([{ op: 'add', path: '/title', value: 'z' }])).toMatchObject({ ok: true, value: { title: 'z' } });
  });

  it('handles array insertion, append, replacement and removal', () => {
    const result = apply([
      { op: 'add', path: '/stages/-', value: { key: 'c', n: 3 } },
      { op: 'add', path: '/stages/0', value: { key: 'z', n: 0 } },
      { op: 'replace', path: '/stages/1/n', value: 10 },
      { op: 'remove', path: '/stages/2' },
    ]);
    expect(result).toEqual({
      ok: true,
      value: { stages: [{ key: 'z', n: 0 }, { key: 'a', n: 10 }, { key: 'c', n: 3 }], 'a/b': { 'c~d': 1 }, title: 'x' },
    });
    // add at index == length appends
    expect(apply([{ op: 'add', path: '/stages/2', value: 1 }])).toMatchObject({ ok: true });
  });

  it('replaces the root', () => {
    expect(apply([{ op: 'replace', path: '', value: [1] }])).toEqual({ ok: true, value: [1] });
    expect(apply([{ op: 'add', path: '', value: 5 }])).toEqual({ ok: true, value: 5 });
  });

  it('reports the failing op index and reason', () => {
    expect(apply([{ op: 'replace', path: '/title', value: 'y' }, { op: 'remove', path: '/nope' }])).toEqual({ ok: false, reason: 'path_not_found', index: 1 });
    expect(apply([{ op: 'add', path: '/stages/3', value: 1 }])).toEqual({ ok: false, reason: 'index_out_of_range', index: 0 });
    expect(apply([{ op: 'replace', path: '/stages/2', value: 1 }])).toEqual({ ok: false, reason: 'index_out_of_range', index: 0 });
    expect(apply([{ op: 'remove', path: '/stages/9' }])).toEqual({ ok: false, reason: 'index_out_of_range', index: 0 });
    expect(apply([{ op: 'add', path: '/stages/x', value: 1 }])).toEqual({ ok: false, reason: 'index_out_of_range', index: 0 });
    expect(apply([{ op: 'replace', path: '/stages/-', value: 1 }])).toEqual({ ok: false, reason: 'path_not_found', index: 0 });
    expect(apply([{ op: 'replace', path: '/missing', value: 1 }])).toEqual({ ok: false, reason: 'path_not_found', index: 0 });
    expect(apply([{ op: 'add', path: '/missing/deeper', value: 1 }])).toEqual({ ok: false, reason: 'path_not_found', index: 0 });
    expect(apply([{ op: 'add', path: '/title/x', value: 1 }])).toEqual({ ok: false, reason: 'not_a_container', index: 0 });
    expect(apply([{ op: 'remove', path: '' }])).toEqual({ ok: false, reason: 'cannot_remove_root', index: 0 });
    expect(apply([{ op: 'add', path: 'no-slash', value: 1 }])).toEqual({ ok: false, reason: 'malformed_pointer', index: 0 });
    expect(apply([{ op: 'add', path: '/a~', value: 1 }])).toEqual({ ok: false, reason: 'malformed_pointer', index: 0 });
  });

  it('rejects malformed ops', () => {
    expect(apply([{ op: 'move', path: '/a' } as unknown as PatchOp])).toEqual({ ok: false, reason: 'invalid_op', index: 0 });
    expect(apply([{ op: 'add', path: '/a' } as unknown as PatchOp])).toEqual({ ok: false, reason: 'invalid_op', index: 0 });
    expect(apply([null as unknown as PatchOp])).toEqual({ ok: false, reason: 'invalid_op', index: 0 });
  });

  it('refuses prototype-reaching segments, even on missing paths', () => {
    for (const path of ['/__proto__/x', '/constructor/prototype', '/prototype', '/stages/0/__proto__', '/__proto__']) {
      expect(apply([{ op: 'add', path, value: { polluted: true } }])).toEqual({ ok: false, reason: 'forbidden_segment', index: 0 });
    }
    expect(apply([{ op: 'remove', path: '/constructor' }])).toEqual({ ok: false, reason: 'forbidden_segment', index: 0 });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('keeps an existing own __proto__ key as data when cloning', () => {
    const parsed = JSON.parse('{"__proto__":{"x":1},"a":1}') as JsonValue;
    const result = apply([{ op: 'replace', path: '/a', value: 2 }], parsed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value as object).sort()).toEqual(['__proto__', 'a']);
      expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    }
  });

  it('is immutable and shares untouched branches', () => {
    const input = doc() as { stages: JsonValue[]; title: string };
    const result = applyPatch(input, [{ op: 'replace', path: '/stages/0/n', value: 9 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.value as { stages: JsonValue[]; 'a/b': JsonValue };
    expect(out).not.toBe(input);
    expect(out.stages).not.toBe(input.stages);
    expect(out.stages[0]).not.toBe(input.stages[0]);
    expect(out.stages[1]).toBe(input.stages[1]);
    expect(out['a/b']).toBe((input as unknown as { 'a/b': JsonValue })['a/b']);
    expect((input.stages[0] as { n: number }).n).toBe(1);
  });

  it('walks a very long pointer without recursion', () => {
    let nested: JsonValue = { leaf: 1 };
    for (let i = 0; i < 20_000; i += 1) nested = { a: nested };
    const result = applyPatch(nested, [{ op: 'replace', path: '/a'.repeat(20_000) + '/leaf', value: 2 }]);
    expect(result.ok).toBe(true);
  });
});
