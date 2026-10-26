/**
 * Tokenizer for the expression text form. Hand-written, no regular expressions on the input.
 * Every failure is a `LexError` carrying an offset and an `expected` code, never English text.
 */

export type TokenKind = 'num' | 'str' | 'ident' | 'op' | 'eof';

export interface Token {
  kind: TokenKind;
  /** Identifier name, operator text, or the decoded string literal. Empty for eof. */
  text: string;
  /** Numeric value of a `num` token. */
  value: number;
  /** Index of the first source character of the token. */
  offset: number;
}

export class LexError extends Error {
  constructor(
    readonly offset: number,
    readonly expected: string,
  ) {
    super(`lex error at ${offset}: expected ${expected}`);
    this.name = 'LexError';
  }
}

/** Words that cannot be reference names. */
export const KEYWORDS: ReadonlySet<string> = new Set([
  'and',
  'or',
  'not',
  'true',
  'false',
  'in',
  'of',
  'where',
  'if',
  'min',
  'max',
  'clamp',
  'round',
  'rel',
  'seeded_rand',
  'count',
  'sum',
  'any',
  'all',
]);

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isLower = (c: number): boolean => c >= 97 && c <= 122;
const isIdentStart = isLower;
const isIdentPart = (c: number): boolean => isLower(c) || isDigit(c) || c === 95;
const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13;

/** Operators, longest first. */
const TWO_CHAR_OPS: ReadonlySet<string> = new Set(['<=', '>=', '==', '!=']);
const ONE_CHAR_OPS: ReadonlySet<string> = new Set(['+', '-', '*', '/', '(', ')', '[', ']', ',', '<', '>']);

/**
 * Split `source` into tokens, ending with an `eof` token. An identifier is a lower-case word that
 * may carry one `.field` suffix (`item.points`); keywords are returned as identifiers and told
 * apart by the parser. Numbers are `digits[.digits][e[+-]digits]`; a leading '-' is an operator.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source.charCodeAt(i);
    if (isSpace(c)) {
      i += 1;
      continue;
    }
    const start = i;
    if (isDigit(c)) {
      i = scanNumber(source, i);
      // A letter or underscore glued to a number (12abc) is not a token boundary.
      if (i < n && isIdentPart(source.charCodeAt(i))) throw new LexError(i, 'operator');
      tokens.push({ kind: 'num', text: source.slice(start, i), value: Number(source.slice(start, i)), offset: start });
      continue;
    }
    if (isIdentStart(c)) {
      i += 1;
      while (i < n && isIdentPart(source.charCodeAt(i))) i += 1;
      if (i + 1 < n && source.charCodeAt(i) === 46 && isIdentStart(source.charCodeAt(i + 1))) {
        i += 1;
        while (i < n && isIdentPart(source.charCodeAt(i))) i += 1;
      }
      tokens.push({ kind: 'ident', text: source.slice(start, i), value: 0, offset: start });
      continue;
    }
    if (c === 34) {
      const { text, end } = scanString(source, i);
      tokens.push({ kind: 'str', text, value: 0, offset: start });
      i = end;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ kind: 'op', text: two, value: 0, offset: start });
      i += 2;
      continue;
    }
    const one = source.charAt(i);
    if (ONE_CHAR_OPS.has(one)) {
      tokens.push({ kind: 'op', text: one, value: 0, offset: start });
      i += 1;
      continue;
    }
    throw new LexError(i, 'token');
  }
  tokens.push({ kind: 'eof', text: '', value: 0, offset: n });
  return tokens;
}

/** Index just past the number that starts at `from`. */
function scanNumber(source: string, from: number): number {
  const n = source.length;
  let i = from;
  while (i < n && isDigit(source.charCodeAt(i))) i += 1;
  if (i + 1 < n && source.charCodeAt(i) === 46 && isDigit(source.charCodeAt(i + 1))) {
    i += 1;
    while (i < n && isDigit(source.charCodeAt(i))) i += 1;
  }
  if (i < n && source.charCodeAt(i) === 101) {
    let j = i + 1;
    if (j < n && (source.charCodeAt(j) === 43 || source.charCodeAt(j) === 45)) j += 1;
    if (j < n && isDigit(source.charCodeAt(j))) {
      while (j < n && isDigit(source.charCodeAt(j))) j += 1;
      i = j;
    }
  }
  return i;
}

/** Decode the string literal that starts at the quote at `from`; only \" and \\ are escapes. */
function scanString(source: string, from: number): { text: string; end: number } {
  const n = source.length;
  let i = from + 1;
  let text = '';
  while (i < n) {
    const c = source.charCodeAt(i);
    if (c === 34) return { text, end: i + 1 };
    if (c === 92) {
      const next = source.charCodeAt(i + 1);
      if (next !== 34 && next !== 92) throw new LexError(i, 'escape');
      text += source.charAt(i + 1);
      i += 2;
      continue;
    }
    text += source.charAt(i);
    i += 1;
  }
  throw new LexError(from, 'quote');
}
