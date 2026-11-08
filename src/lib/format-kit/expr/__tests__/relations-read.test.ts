import { describe, expect, it } from 'vitest';
import type { Expr } from '../ast';
import { relationsRead } from '../relations-read';

const player: Expr = { k: 'ref', name: 'player', t: 'text' };
const rel = (relation: string): Expr => ({ k: 'rel', relation, a: player, b: { k: 'str', v: 'x' } });

describe('relationsRead', () => {
  it('finds nothing in an expression without a relation', () => {
    expect(relationsRead({ k: 'cmp', op: '>', a: { k: 'ref', name: 'wins', t: 'number' }, b: { k: 'num', v: 2 } })).toEqual([]);
  });

  it('finds a relation under every branching node, without repeats', () => {
    const expr: Expr = {
      k: 'and',
      args: [
        { k: 'not', a: rel('santa') },
        { k: 'or', args: [rel('rivals'), rel('santa')] },
        { k: 'if', cond: rel('mentor'), then: { k: 'bool', v: true }, else: rel('pairs') },
      ],
    };
    expect(relationsRead(expr)).toEqual(['santa', 'rivals', 'mentor', 'pairs']);
  });

  it('looks inside an aggregate', () => {
    expect(relationsRead({ k: 'agg', fn: 'any', over: 'x', where: rel('santa') })).toEqual(['santa']);
  });
});
