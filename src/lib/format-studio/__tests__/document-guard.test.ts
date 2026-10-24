import { describe, expect, it } from 'vitest';
import { FormatStudioError } from '../errors';
import { assertDocument } from '../document-guard';

function codeOf(value: unknown): string | null {
  try {
    assertDocument(value);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(FormatStudioError);
    return (error as FormatStudioError).code ?? null;
  }
}

describe('assertDocument', () => {
  it('accepts a plain object', () => {
    expect(codeOf({ schema_version: 1, identity: { name: { base: 'en' } }, stages: [] })).toBeNull();
    expect(codeOf({})).toBeNull();
  });

  it('accepts an object with a null prototype', () => {
    const document = Object.assign(Object.create(null) as object, { a: 1 });
    expect(codeOf(document)).toBeNull();
  });

  it.each([
    ['an array', []],
    ['an array of objects', [{}]],
    ['null', null],
    ['undefined', undefined],
    ['a string', '{"a":1}'],
    ['a number', 42],
    ['a boolean', true],
  ])('refuses %s as format_document_not_object', (_label, value) => {
    expect(codeOf(value)).toBe('format_document_not_object');
  });

  it('refuses a string with a NUL character as format_document_not_json', () => {
    expect(codeOf({ identity: { name: 'a\u0000b' } })).toBe('format_document_not_json');
  });

  it('refuses values that are not JSON as format_document_not_json', () => {
    expect(codeOf({ a: undefined })).toBe('format_document_not_json');
    expect(codeOf({ a: Number.NaN })).toBe('format_document_not_json');
    expect(codeOf({ a: Infinity })).toBe('format_document_not_json');
    expect(codeOf({ a: () => 1 })).toBe('format_document_not_json');
    expect(codeOf({ a: new Date() })).toBe('format_document_not_json');
    expect(codeOf({ a: BigInt(1) })).toBe('format_document_not_json');
  });

  it('accepts 64 levels of nesting and refuses 65 as format_document_too_deep', () => {
    const nested = (levels: number) => {
      let value: unknown = {};
      for (let i = 1; i < levels; i += 1) value = { a: value };
      return value;
    };
    expect(codeOf(nested(64))).toBeNull();
    expect(codeOf(nested(65))).toBe('format_document_too_deep');
  });

  it('refuses a huge nesting of arrays without overflowing the stack', () => {
    const depth = 100_000;
    const document = JSON.parse(`{"a":${'['.repeat(depth)}${']'.repeat(depth)}}`);
    expect(codeOf(document)).toBe('format_document_too_deep');
  });

  it('refuses an array with 150,001 nodes as format_document_too_many_nodes', () => {
    expect(codeOf({ a: new Array<number>(150_001).fill(0) })).toBe('format_document_too_many_nodes');
  });

  it('accepts a large flat document that is within every limit', () => {
    // 100,002 nodes and about 200 KB: the byte limit is reached before the node limit with the smallest members.
    expect(codeOf({ a: new Array<number>(100_000).fill(0) })).toBeNull();
  });

  it('refuses an oversized string as format_document_too_large', () => {
    expect(codeOf({ a: 'x'.repeat(262_144) })).toBe('format_document_too_large');
    expect(codeOf({ a: 'x'.repeat(2_000_000) })).toBe('format_document_too_large');
  });

  it('refuses many small members that add up past the byte limit', () => {
    const document: Record<string, string> = {};
    for (let i = 0; i < 6000; i += 1) document[`key_${i}`] = 'y'.repeat(60);
    expect(codeOf(document)).toBe('format_document_too_large');
  });

  it('accepts a document just under the byte limit', () => {
    expect(codeOf({ a: 'x'.repeat(262_000) })).toBeNull();
  });
});
