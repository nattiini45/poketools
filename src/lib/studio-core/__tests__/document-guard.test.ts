import { describe, expect, it } from 'vitest';
import { documentProblem } from '../document-guard';

describe('documentProblem', () => {
  it('accepts a plain object', () => {
    expect(documentProblem({ a: 1, b: [1, 2, { c: 'x' }] })).toBeNull();
    expect(documentProblem({})).toBeNull();
  });

  it.each([[null], [undefined], [[1]], ['text'], [7], [true]])('%j is not an object', (value) => {
    expect(documentProblem(value)).toBe('not_object');
  });

  it('names a document that is nested too deeply, without a stack overflow', () => {
    let deep: unknown = {};
    for (let i = 0; i < 200_000; i += 1) deep = { d: deep };
    expect(documentProblem(deep)).toBe('too_deep');
  });

  it('names a document with too many nodes and one over the byte limit', () => {
    expect(documentProblem({ list: Array.from({ length: 160_000 }, () => 1) })).toBe('too_many_nodes');
    expect(documentProblem({ text: 'x'.repeat(300_000) })).toBe('too_large');
  });

  it('names a value that is not JSON', () => {
    expect(documentProblem({ f: () => 1 })).toBe('not_json');
    expect(documentProblem({ s: 'a\u0000b' })).toBe('not_json');
  });
});
