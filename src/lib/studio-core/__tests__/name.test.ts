import { describe, expect, it } from 'vitest';
import { definitionNameSchema } from '../api-schemas';
import { DEFINITION_NAME_MAX, nameProblem } from '../name';

describe('nameProblem', () => {
  it('accepts a name of 1 to 120 characters', () => {
    expect(nameProblem('Gen 9 OU')).toBeNull();
    expect(nameProblem('x'.repeat(DEFINITION_NAME_MAX))).toBeNull();
    expect(nameProblem('  padded  ')).toBeNull();
  });

  it('asks for a name when there is none', () => {
    expect(nameProblem('')).toBe('required');
    expect(nameProblem('   ')).toBe('required');
  });

  it('refuses a name that is too long or holds NUL or a lone surrogate half', () => {
    expect(nameProblem('x'.repeat(DEFINITION_NAME_MAX + 1))).toBe('invalid');
    expect(nameProblem('a\u0000b')).toBe('invalid');
    expect(nameProblem('a\uD800b')).toBe('invalid');
    expect(nameProblem('a\uDC00b')).toBe('invalid');
  });

  it('accepts a paired surrogate (an emoji)', () => {
    expect(nameProblem('Fire 🔥')).toBeNull();
  });

  it('agrees with the schema the API applies', () => {
    for (const name of ['', ' ', 'ok', 'x'.repeat(121), 'a\u0000', 'a\uD800', 'Fire 🔥', '  trimmed  ']) {
      expect(definitionNameSchema.safeParse(name).success, JSON.stringify(name)).toBe(nameProblem(name) === null);
    }
  });
});
