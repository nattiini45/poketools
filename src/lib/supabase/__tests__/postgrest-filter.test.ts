import { describe, it, expect } from 'vitest';
import { escapeLikeTerm, ilikeAnyOf, postgrestQuoted } from '../postgrest-filter';

/**
 * Test-only decoder of one PostgREST logic-tree condition list, following
 * PostgREST's grammar for `or=(...)` values: conditions are separated by
 * top-level commas; a value is either double-quoted (where `\x` means `x`) or
 * runs to the next `,` or `)`. Returns `[column, operator, value]` triples.
 * It is the parser an attacker would have to fool: if every adversarial
 * search decodes back to exactly the intended conditions, user text cannot
 * add or end conditions.
 */
function decodeConditions(tree: string): [string, string, string][] {
  const out: [string, string, string][] = [];
  let i = 0;
  while (i < tree.length) {
    const colEnd = tree.indexOf('.', i);
    const column = tree.slice(i, colEnd);
    const opEnd = tree.indexOf('.', colEnd + 1);
    const operator = tree.slice(colEnd + 1, opEnd);
    i = opEnd + 1;
    let value = '';
    if (tree[i] === '"') {
      i += 1;
      while (tree[i] !== '"') {
        if (i >= tree.length) throw new Error('unterminated quoted value');
        if (tree[i] === '\\') i += 1;
        value += tree[i];
        i += 1;
      }
      i += 1; // closing quote
    } else {
      while (i < tree.length && tree[i] !== ',' && tree[i] !== ')') {
        value += tree[i];
        i += 1;
      }
    }
    out.push([column, operator, value]);
    if (tree[i] === ',') i += 1;
    else if (i < tree.length) throw new Error(`unexpected ${tree[i]} at ${i}`);
  }
  return out;
}

describe('escapeLikeTerm', () => {
  it('escapes the LIKE wildcards and the escape character', () => {
    expect(escapeLikeTerm('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('leaves PostgREST punctuation alone (quoting handles it)', () => {
    expect(escapeLikeTerm('a,b(c)d.e"f')).toBe('a,b(c)d.e"f');
  });
});

describe('postgrestQuoted', () => {
  it('wraps the value in quotes and escapes quotes and backslashes', () => {
    expect(postgrestQuoted('plain')).toBe('"plain"');
    expect(postgrestQuoted('say "hi"')).toBe('"say \\"hi\\""');
    expect(postgrestQuoted('a\\b')).toBe('"a\\\\b"');
  });
});

describe('ilikeAnyOf', () => {
  it('builds one quoted ilike condition per column', () => {
    expect(ilikeAnyOf(['library_title', 'library_description'], 'rain')).toBe(
      'library_title.ilike."%rain%",library_description.ilike."%rain%"'
    );
  });

  it.each([
    ['comma injection', 'zz,name.like.*'],
    ['closing paren', 'a)'],
    ['quote then paren', '")'],
    ['trailing backslash', 'x\\'],
    ['every special at once', 'a,b)c"d\\e%_(f.g'],
  ])('%s: decodes back to exactly the intended conditions', (_label, term) => {
    const tree = ilikeAnyOf(['library_title', 'library_description'], term);
    const expectedPattern = `%${escapeLikeTerm(term)}%`;

    expect(decodeConditions(tree)).toEqual([
      ['library_title', 'ilike', expectedPattern],
      ['library_description', 'ilike', expectedPattern],
    ]);
  });

  it('LIKE wildcards in the term match literally', () => {
    const [[, , pattern]] = decodeConditions(ilikeAnyOf(['set_name'], '100%_'));
    expect(pattern).toBe('%100\\%\\_%');
  });

  it('throws on a column name that is not a plain identifier', () => {
    expect(() => ilikeAnyOf(['name,id'], 'x')).toThrow('invalid column name');
    expect(() => ilikeAnyOf(['Name'], 'x')).toThrow('invalid column name');
  });

  it('throws without columns', () => {
    expect(() => ilikeAnyOf([], 'x')).toThrow('at least one column');
  });
});
