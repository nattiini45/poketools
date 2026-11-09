import { describe, expect, it } from 'vitest';
import type { AttributeDef, RuleEntry } from '../../types';
import type { Expr } from '../ast';
import { relationsRead } from '../relations-read';

const player: Expr = { k: 'ref', name: 'player', t: 'text' };
const rel = (relation: string): Expr => ({ k: 'rel', relation, a: player, b: { k: 'str', v: 'x' } });
const r = rel('santa');
const num: Expr = { k: 'num', v: 1 };

describe('relationsRead', () => {
  it('finds nothing in an expression without a relation', () => {
    expect(relationsRead({ k: 'cmp', op: '>', a: { k: 'ref', name: 'wins', t: 'number' }, b: num })).toEqual([]);
  });

  it.each<[string, Expr]>([
    ['neg', { k: 'neg', a: r }],
    ['not', { k: 'not', a: r }],
    ['arith', { k: 'arith', op: '+', a: num, b: r }],
    ['cmp', { k: 'cmp', op: '==', a: r, b: num }],
    ['fn', { k: 'fn', fn: 'max', args: [num, r] }],
    ['and', { k: 'and', args: [num, r] }],
    ['or', { k: 'or', args: [num, r] }],
    ['clamp', { k: 'clamp', x: num, lo: num, hi: r }],
    ['round', { k: 'round', x: r, digits: 0 }],
    ['if', { k: 'if', cond: num, then: num, else: r }],
    ['in', { k: 'in', a: r, set: ['x'] }],
    ['agg of', { k: 'agg', fn: 'sum', over: 'x', of: r }],
    ['agg where', { k: 'agg', fn: 'any', over: 'x', where: r }],
    ['rel operand', { k: 'rel', relation: 'santa', a: num, b: num }],
  ])('finds a relation under %s', (_label, expr) => {
    expect(relationsRead(expr)).toEqual(['santa']);
  });

  it('lists each relation once, in order', () => {
    expect(relationsRead({ k: 'and', args: [rel('a'), rel('b'), rel('a')] })).toEqual(['a', 'b']);
  });

  const computed = { key: 'gifted', on: 'player', type: 'bool', assign: { kind: 'expr', expr: r } } as unknown as AttributeDef;
  const attr: Expr = { k: 'ref', name: 'attr.gifted', t: 'boolean' };

  it('follows a player attribute computed from a relation', () => {
    expect(relationsRead(attr, [computed])).toEqual(['santa']);
  });

  const stored = { key: 'gifted', on: 'player', type: 'bool', assign: { kind: 'manual' } } as unknown as AttributeDef;
  const writer = (to: object, when?: Expr): RuleEntry =>
    ({ kind: 'rule.on_event', id: 'mark', on: { event: 'stage_start', stage: 'main' }, ...(when ? { when } : {}), effects: [{ effect: 'set_attr', attr: 'gifted', to, value: true }] }) as unknown as RuleEntry;

  it('follows a stored attribute to the relations its set_attr writers read in their target or their rule condition', () => {
    expect(relationsRead(attr, [stored], [writer({ who: 'all', where: r })])).toEqual(['santa']);
    expect(relationsRead(attr, [stored], [writer({ who: 'all' }, rel('pact'))])).toEqual(['pact']);
    expect(relationsRead(attr, [stored], [writer({ who: 'all', where: num })])).toEqual([]);
  });

  it('follows a stored attribute written from another attribute, and stops on a cycle', () => {
    const other = { key: 'other', on: 'player', type: 'bool', assign: { kind: 'manual' } } as unknown as AttributeDef;
    const readOther: Expr = { k: 'ref', name: 'attr.other', t: 'boolean' };
    const writesOther = { kind: 'rule.on_event', id: 'o', on: { event: 'stage_start', stage: 'main' }, effects: [{ effect: 'set_attr', attr: 'other', to: { who: 'all', where: { k: 'and', args: [r, attr] } }, value: true }] } as unknown as RuleEntry;
    expect(relationsRead(attr, [stored, other], [writer({ who: 'all', where: readOther }), writesOther])).toEqual(['santa']);
  });

  it('does not follow an attribute that is stored, or that belongs to an entry', () => {
    expect(relationsRead(attr, [{ ...computed, assign: undefined } as AttributeDef])).toEqual([]);
    expect(relationsRead(attr, [{ ...computed, on: 'entry' } as AttributeDef])).toEqual([]);
  });
});
