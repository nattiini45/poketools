import { describe, expect, it } from 'vitest';
import {
  KEY_PATTERN,
  KIND_PATTERN,
  REF_NAME_PATTERN,
  SLUG_PATTERN,
  hasOwn,
  isKey,
  isKind,
  isRefName,
  isSlug,
  isUuid,
  toMap,
} from '../keys';

describe('Key pattern', () => {
  it.each([
    ['a', true],
    ['a'.repeat(32), true],
    ['a'.repeat(33), false],
    ['stage_1', true],
    ['constructor', true],
    ['toString', false], // upper-case letter
    ['tostring', true],
    ['hasownproperty', true],
    ['', false],
    ['1abc', false],
    ['_abc', false],
    ['__proto__', false],
    ['Abc', false],
    ['a-b', false],
    ['a b', false],
    ['a.b', false],
    ['ä', false],
  ])('isKey(%j) = %s', (input, expected) => {
    expect(isKey(input)).toBe(expected);
    expect(KEY_PATTERN.test(input)).toBe(expected);
  });

  it('rejects non-strings', () => {
    for (const v of [undefined, null, 5, {}, [], ['a']]) expect(isKey(v)).toBe(false);
  });

  it('is a literal anchored pattern', () => {
    expect(KEY_PATTERN.source).toBe('^[a-z][a-z0-9_]{0,31}$');
    expect(KEY_PATTERN.test('ok\n')).toBe(false);
  });
});

describe('other patterns', () => {
  it('ref names are a key or key.key', () => {
    expect(isRefName('points')).toBe(true);
    expect(isRefName('item.points')).toBe(true);
    expect(isRefName('item.')).toBe(false);
    expect(isRefName('a.b.c')).toBe(false);
    expect(isRefName('Item.points')).toBe(false);
    expect(REF_NAME_PATTERN.test(`${'a'.repeat(32)}.${'b'.repeat(32)}`)).toBe(true);
    expect(REF_NAME_PATTERN.test(`${'a'.repeat(33)}.b`)).toBe(false);
  });

  it('kinds are dotted lower-case words up to 64 chars', () => {
    expect(isKind('rule.custom')).toBe(true);
    expect(isKind('a'.repeat(64))).toBe(true);
    expect(isKind('a'.repeat(65))).toBe(false);
    expect(isKind('Rule.custom')).toBe(false);
    expect(isKind('.rule')).toBe(false);
    expect(KIND_PATTERN.test('x-y')).toBe(false);
  });

  it('slugs allow hyphens but not a leading one', () => {
    expect(isSlug('classic-league')).toBe(true);
    expect(isSlug('0day')).toBe(true);
    expect(isSlug('-x')).toBe(false);
    expect(isSlug('A')).toBe(false);
    expect(isSlug('a'.repeat(63))).toBe(true);
    expect(isSlug('a'.repeat(64))).toBe(false);
    expect(SLUG_PATTERN.test('under_score')).toBe(false);
  });

  it('uuids are 8-4-4-4-12 hex', () => {
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isUuid('123E4567-E89B-12D3-A456-426614174000')).toBe(true);
    expect(isUuid('123e4567-e89b-12d3-a456-42661417400')).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});

describe('toMap', () => {
  it('indexes by key and keeps the first of duplicates', () => {
    const duplicates: { item: string; index: number }[] = [];
    const map = toMap(['a1', 'b1', 'a2', 'a3'], (s) => s[0], (item, index) => duplicates.push({ item, index }));
    expect([...map.entries()]).toEqual([
      ['a', 'a1'],
      ['b', 'b1'],
    ]);
    expect(duplicates).toEqual([
      { item: 'a2', index: 2 },
      { item: 'a3', index: 3 },
    ]);
  });

  it('works without a duplicate callback', () => {
    expect(toMap([{ k: 'x' }, { k: 'x' }], (o) => o.k).size).toBe(1);
  });

  it('keys named like Object.prototype members are ordinary data', () => {
    const items = [
      { key: 'constructor', n: 1 },
      { key: 'tostring', n: 2 },
      { key: 'hasownproperty', n: 3 },
    ];
    const map = toMap(items, (i) => i.key);
    expect(map.get('constructor')).toBe(items[0]);
    expect(map.get('constructor')).not.toBe(Object.prototype.constructor);
    expect(map.has('valueOf')).toBe(false);
    // A plain-object index would have answered for these.
    const plain: Record<string, unknown> = {};
    expect(plain['constructor']).toBe(Object);
    expect(map.get('toString')).toBeUndefined();
  });
});

describe('hasOwn', () => {
  it('sees own keys only', () => {
    expect(hasOwn({ a: 1 }, 'a')).toBe(true);
    expect(hasOwn({ a: 1 }, 'toString')).toBe(false);
    expect(hasOwn({}, 'constructor')).toBe(false);
  });

  it('works on null-prototype objects and on an own __proto__ key', () => {
    const bare = Object.create(null) as Record<string, number>;
    bare.x = 1;
    expect(hasOwn(bare, 'x')).toBe(true);
    const parsed = JSON.parse('{"__proto__":{"polluted":true}}') as object;
    expect(hasOwn(parsed, '__proto__')).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
