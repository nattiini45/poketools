import { KEY_PATTERN } from '../keys';
import type { CollectionType, Expr, ExprIssue, ExprIssueCode, ExprType, TypeEnv } from './ast';
import { KEYWORDS, LexError, tokenize, type Token } from './lexer';
import {
  EXPR_MAX_ARGS,
  EXPR_MAX_DEPTH,
  EXPR_MAX_NODES,
  EXPR_MAX_PARSE_NESTING,
  EXPR_MAX_ROUND_DIGITS,
  EXPR_MAX_SET,
  EXPR_MAX_SOURCE_CHARS,
  EXPR_MAX_STRING,
  EXPR_NUM_LIMIT,
} from './limits';
import { exceededLimit, measureExpr } from './measure';
import { normalizeExpr } from './normalize';

export type ParseResult = { ok: true; expr: Expr } | { ok: false; issues: ExprIssue[] };

type Params = Record<string, string | number | boolean>;

/** Binding powers: the same ladder `printExpr` uses (see PRECEDENCE in printer.ts). */
const BP = { or: 1, and: 2, notOperand: 3, cmp: 4, sum: 5, term: 6, unaryOperand: 7 } as const;

const CMP_OPS: ReadonlySet<string> = new Set(['<', '<=', '>', '>=', '==', '!=']);

class ParseFailure {
  constructor(readonly issue: ExprIssue) {}
}

interface AggScope {
  over: string;
  collection: CollectionType;
}

class Parser {
  private pos = 0;
  private nesting = 0;
  private scope: AggScope | null = null;

  constructor(
    private readonly tokens: Token[],
    private readonly env: TypeEnv,
  ) {}

  private fail(code: ExprIssueCode, params: Params): never {
    throw new ParseFailure({ code, pointer: '', params });
  }

  private unexpected(expected: string, at: Token = this.peek): never {
    return this.fail('expr_parse', { offset: at.offset, expected });
  }

  private get peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const token = this.tokens[this.pos];
    if (token.kind !== 'eof') this.pos += 1;
    return token;
  }

  private isOp(text: string, token: Token = this.peek): boolean {
    return token.kind === 'op' && token.text === text;
  }

  private isWord(text: string, token: Token = this.peek): boolean {
    return token.kind === 'ident' && token.text === text;
  }

  private expectOp(text: string): Token {
    if (!this.isOp(text)) return this.unexpected(text);
    return this.next();
  }

  private expectKey(): Token {
    const token = this.peek;
    if (token.kind !== 'ident' || !KEY_PATTERN.test(token.text)) return this.unexpected('key');
    return this.next();
  }

  parseAll(): Expr {
    const expr = this.parseBp(0);
    if (this.peek.kind !== 'eof') this.unexpected('end');
    return expr;
  }

  private infixPower(token: Token): number {
    if (token.kind === 'ident') {
      if (token.text === 'or') return BP.or;
      if (token.text === 'and') return BP.and;
      if (token.text === 'in') return BP.cmp;
      return -1;
    }
    if (token.kind !== 'op') return -1;
    if (CMP_OPS.has(token.text)) return BP.cmp;
    if (token.text === '+' || token.text === '-') return BP.sum;
    if (token.text === '*' || token.text === '/') return BP.term;
    return -1;
  }

  /** Pratt loop: parse an expression whose operators all bind at least as tight as `minBp`. */
  private parseBp(minBp: number): Expr {
    this.nesting += 1;
    if (this.nesting > EXPR_MAX_PARSE_NESTING) this.unexpected('shallower');
    let left = this.parsePrefix();
    let afterCompare = false;
    for (;;) {
      const token = this.peek;
      const power = this.infixPower(token);
      if (power < 0 || power < minBp) break;

      if (power === BP.cmp) {
        // Comparisons and `in` are non-associative: `a < b < c` is an error.
        if (afterCompare) this.unexpected('end');
        this.next();
        if (token.kind === 'ident') left = { k: 'in', a: left, set: this.parseSet() };
        else {
          const right = this.parseBp(BP.sum);
          left = { k: 'cmp', op: token.text as '<' | '<=' | '>' | '>=' | '==' | '!=', a: left, b: right };
        }
        afterCompare = true;
        continue;
      }
      afterCompare = false;

      if (power === BP.or || power === BP.and) {
        const word = token.text as 'and' | 'or';
        const args: Expr[] = [left];
        while (this.isWord(word)) {
          const at = this.next();
          args.push(this.parseBp(power + 1));
          if (args.length > EXPR_MAX_ARGS) this.fail('expr_arity', { offset: at.offset, max: EXPR_MAX_ARGS });
        }
        left = { k: word, args };
        continue;
      }

      // Left-associative arithmetic.
      this.next();
      const right = this.parseBp(power + 1);
      left = { k: 'arith', op: token.text as '+' | '-' | '*' | '/', a: left, b: right };
    }
    this.nesting -= 1;
    return left;
  }

  private parsePrefix(): Expr {
    const token = this.next();
    switch (token.kind) {
      case 'num':
        this.checkNumber(token);
        return { k: 'num', v: token.value };
      case 'str':
        if (token.text.length > EXPR_MAX_STRING) this.fail('expr_string_length', { offset: token.offset, length: token.text.length, limit: EXPR_MAX_STRING });
        return { k: 'str', v: token.text };
      case 'op': {
        if (token.text === '-') return { k: 'neg', a: this.parseBp(BP.unaryOperand) };
        if (token.text === '(') {
          const inner = this.parseBp(0);
          this.expectOp(')');
          return inner;
        }
        return this.unexpected('expression', token);
      }
      case 'ident':
        return this.parseWord(token);
      default:
        return this.unexpected('expression', token);
    }
  }

  private checkNumber(token: Token): void {
    if (!Number.isFinite(token.value) || Math.abs(token.value) > EXPR_NUM_LIMIT) {
      this.fail('expr_number_range', { offset: token.offset, limit: EXPR_NUM_LIMIT });
    }
  }

  private parseWord(token: Token): Expr {
    const word = token.text;
    switch (word) {
      case 'true':
        return { k: 'bool', v: true };
      case 'false':
        return { k: 'bool', v: false };
      case 'not':
        return { k: 'not', a: this.parseBp(BP.notOperand) };
      case 'if': {
        this.expectOp('(');
        const cond = this.parseBp(0);
        this.expectOp(',');
        const then = this.parseBp(0);
        this.expectOp(',');
        const otherwise = this.parseBp(0);
        this.expectOp(')');
        return { k: 'if', cond, then, else: otherwise };
      }
      case 'clamp': {
        this.expectOp('(');
        const x = this.parseBp(0);
        this.expectOp(',');
        const lo = this.parseBp(0);
        this.expectOp(',');
        const hi = this.parseBp(0);
        this.expectOp(')');
        return { k: 'clamp', x, lo, hi };
      }
      case 'round': {
        this.expectOp('(');
        const x = this.parseBp(0);
        let digits = 0;
        if (this.isOp(',')) {
          this.next();
          const d = this.peek;
          if (d.kind !== 'num') this.unexpected('number');
          this.next();
          if (!Number.isInteger(d.value) || d.value < 0 || d.value > EXPR_MAX_ROUND_DIGITS) {
            this.fail('expr_number_range', { offset: d.offset, min: 0, max: EXPR_MAX_ROUND_DIGITS });
          }
          digits = d.value;
        }
        this.expectOp(')');
        return { k: 'round', x, digits };
      }
      case 'rel': {
        this.expectOp('(');
        const relation = this.expectKey().text;
        this.expectOp(',');
        const a = this.parseBp(0);
        this.expectOp(',');
        const b = this.parseBp(0);
        this.expectOp(')');
        return { k: 'rel', relation, a, b };
      }
      case 'seeded_rand': {
        this.expectOp('(');
        const key = this.expectKey().text;
        this.expectOp(')');
        return { k: 'rand', key };
      }
      case 'min':
      case 'max':
        return this.isAggregateAhead() ? this.parseAgg(token) : this.parseNaryCall(token);
      case 'count':
      case 'sum':
      case 'any':
      case 'all':
        return this.parseAgg(token);
      default:
        if (KEYWORDS.has(word)) return this.unexpected('expression', token);
        return this.parseRef(token);
    }
  }

  /** `min(` / `max(` followed by `KEY (of | where | ))` with KEY a known collection is an aggregate. */
  private isAggregateAhead(): boolean {
    const open = this.peek;
    const key = this.tokens[this.pos + 1];
    const after = this.tokens[this.pos + 2];
    if (!this.isOp('(', open) || key === undefined || after === undefined) return false;
    if (key.kind !== 'ident' || !this.env.collections.has(key.text)) return false;
    return this.isWord('of', after) || this.isWord('where', after) || this.isOp(')', after);
  }

  private parseNaryCall(token: Token): Expr {
    this.expectOp('(');
    const args: Expr[] = [this.parseBp(0)];
    if (!this.isOp(',')) this.unexpected(',');
    while (this.isOp(',')) {
      const comma = this.next();
      args.push(this.parseBp(0));
      if (args.length > EXPR_MAX_ARGS) this.fail('expr_arity', { offset: comma.offset, max: EXPR_MAX_ARGS });
    }
    this.expectOp(')');
    return { k: 'fn', fn: token.text as 'min' | 'max', args };
  }

  private parseAgg(token: Token): Expr {
    if (this.scope !== null) this.fail('expr_nested_aggregate', { offset: token.offset });
    this.expectOp('(');
    const overToken = this.expectKey();
    const collection = this.env.collections.get(overToken.text);
    if (collection === undefined) this.fail('expr_unknown_collection', { offset: overToken.offset, over: overToken.text });
    const node: Expr = { k: 'agg', fn: token.text as 'count' | 'sum' | 'min' | 'max' | 'any' | 'all', over: overToken.text };
    this.scope = { over: overToken.text, collection };
    try {
      if (this.isWord('of')) {
        this.next();
        node.of = this.parseBp(0);
      }
      if (this.isWord('where')) {
        this.next();
        node.where = this.parseBp(0);
      }
    } finally {
      this.scope = null;
    }
    this.expectOp(')');
    return node;
  }

  private parseRef(token: Token): Expr {
    const name = token.text;
    const dot = name.indexOf('.');
    if (dot < 0) {
      const t = this.env.refs.get(name);
      if (t === undefined) return this.fail('expr_unknown_ref', { offset: token.offset, name });
      return { k: 'ref', name, t };
    }
    if (name.slice(0, dot) !== 'item' || this.scope === null) return this.fail('expr_item_scope', { offset: token.offset, name });
    const t: ExprType | undefined = this.scope.collection.fields.get(name.slice(dot + 1));
    if (t === undefined) return this.fail('expr_unknown_field', { offset: token.offset, name, over: this.scope.over });
    return { k: 'ref', name, t };
  }

  /** `[` literal (`,` literal)* `]` where a literal is a string or an optionally negative number. */
  private parseSet(): (number | string)[] {
    this.expectOp('[');
    const set: (number | string)[] = [];
    for (;;) {
      const token = this.next();
      if (token.kind === 'str') {
        if (token.text.length > EXPR_MAX_STRING) this.fail('expr_string_length', { offset: token.offset, length: token.text.length, limit: EXPR_MAX_STRING });
        set.push(token.text);
      } else {
        let sign = 1;
        let numberToken = token;
        if (this.isOp('-', token)) {
          sign = -1;
          numberToken = this.next();
        }
        if (numberToken.kind !== 'num') return this.unexpected('literal', numberToken);
        this.checkNumber(numberToken);
        set.push(sign * numberToken.value === 0 ? 0 : sign * numberToken.value);
      }
      if (set.length > EXPR_MAX_SET) this.fail('expr_arity', { offset: token.offset, max: EXPR_MAX_SET });
      if (this.isOp(',')) {
        this.next();
        continue;
      }
      break;
    }
    this.expectOp(']');
    return set;
  }
}

/**
 * Parse expression text into a normalized AST. Refs are resolved against `env` (each gets its `t`).
 * The grammar and the precedence ladder are documented in docs/format-kit.md; in short, lowest to
 * highest: or, and, not, comparison / `in`, + -, * /, unary -.
 *
 * Fails fast with exactly one issue made of a code and params (`offset` into the source), never
 * English text. Source over EXPR_MAX_SOURCE_CHARS gives `expr_source_length`; nesting over
 * EXPR_MAX_PARSE_NESTING gives `expr_parse`, so `((((...` cannot overflow the stack. After parsing,
 * the normalized tree is measured against the depth and node limits. Type rules beyond ref
 * resolution are `typeCheck`'s job.
 */
export function parseExpr(source: string, env: TypeEnv): ParseResult {
  const failure = (code: ExprIssueCode, params: Params): ParseResult => ({ ok: false, issues: [{ code, pointer: '', params }] });
  if (typeof source !== 'string') return failure('expr_parse', { offset: 0, expected: 'text' });
  if (source.length > EXPR_MAX_SOURCE_CHARS) {
    return failure('expr_source_length', { offset: EXPR_MAX_SOURCE_CHARS, length: source.length, max: EXPR_MAX_SOURCE_CHARS });
  }
  try {
    const parsed = new Parser(tokenize(source), env).parseAll();
    const expr = normalizeExpr(parsed);
    const measure = measureExpr(expr);
    const exceeded = exceededLimit(measure);
    if (exceeded !== null) return failure(exceeded, { limit: exceeded === 'expr_depth' ? EXPR_MAX_DEPTH : EXPR_MAX_NODES });
    return { ok: true, expr };
  } catch (error) {
    if (error instanceof ParseFailure) return { ok: false, issues: [error.issue] };
    if (error instanceof LexError) return failure('expr_parse', { offset: error.offset, expected: error.expected });
    throw error;
  }
}
