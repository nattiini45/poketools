import { describe, expect, it } from 'vitest';
import { generateRelationLinks, validateRelationLinks } from '../relations';

const ROSTER = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const cycle = (ids: string[]) => ids.map((from, i) => ({ from, to: ids[(i + 1) % ids.length] }));

describe('validateRelationLinks common rules', () => {
  it('refuses a player who is not on the roster, on either end', () => {
    expect(validateRelationLinks('manual', ROSTER, [{ from: 'p1', to: 'zz' }])).toBe(false);
    expect(validateRelationLinks('manual', ROSTER, [{ from: 'zz', to: 'p1' }])).toBe(false);
  });

  it('refuses a link to oneself', () => {
    expect(validateRelationLinks('manual', ROSTER, [{ from: 'p1', to: 'p1' }])).toBe(false);
  });

  it('refuses a giver or a receiver twice (the primary key and UNIQUE (to) of the table)', () => {
    expect(validateRelationLinks('manual', ROSTER, [{ from: 'p1', to: 'p2' }, { from: 'p1', to: 'p3' }])).toBe(false);
    expect(validateRelationLinks('manual', ROSTER, [{ from: 'p1', to: 'p3' }, { from: 'p2', to: 'p3' }])).toBe(false);
  });

  it('accepts any other list for a manual relation, an empty one included', () => {
    expect(validateRelationLinks('manual', ROSTER, [])).toBe(true);
    expect(validateRelationLinks('manual', ROSTER, [{ from: 'p1', to: 'p2' }, { from: 'p3', to: 'p1' }])).toBe(true);
  });
});

describe('validateRelationLinks derangement', () => {
  it('accepts what the generator draws', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      expect(validateRelationLinks('derangement', ROSTER, generateRelationLinks({ key: 'santa', shape: 'derangement' }, ROSTER, seed))).toBe(true);
    }
  });

  it('accepts a single cycle in any link order', () => {
    expect(validateRelationLinks('derangement', ROSTER, [...cycle(ROSTER)].reverse())).toBe(true);
  });

  it('refuses two cycles over the same roster', () => {
    const twoCycles = [...cycle(['p1', 'p2', 'p3']), ...cycle(['p4', 'p5', 'p6'])];
    expect(validateRelationLinks('derangement', ROSTER, twoCycles)).toBe(false);
  });

  it('refuses a list that leaves a player out or is empty for a roster that can give', () => {
    expect(validateRelationLinks('derangement', ROSTER, cycle(ROSTER.slice(0, 5)))).toBe(false);
    expect(validateRelationLinks('derangement', ROSTER, [])).toBe(false);
  });

  it('accepts no links for a roster of fewer than two, and nothing else', () => {
    expect(validateRelationLinks('derangement', ['p1'], [])).toBe(true);
    expect(validateRelationLinks('derangement', [], [])).toBe(true);
    expect(validateRelationLinks('derangement', ['p1'], [{ from: 'p1', to: 'p1' }])).toBe(false);
  });
});

describe('validateRelationLinks pairs', () => {
  const both = (a: string, b: string) => [{ from: a, to: b }, { from: b, to: a }];

  it('accepts what the generator draws, for an even and an odd roster', () => {
    for (const roster of [ROSTER, ROSTER.slice(0, 5)]) {
      expect(validateRelationLinks('pairs', roster, generateRelationLinks({ key: 'duo', shape: 'pairs' }, roster, 'seed'))).toBe(true);
    }
  });

  it('refuses a link without its reverse', () => {
    expect(validateRelationLinks('pairs', ROSTER, [...both('p1', 'p2'), ...both('p3', 'p4'), { from: 'p5', to: 'p6' }, { from: 'p6', to: 'p1' }])).toBe(false);
    expect(validateRelationLinks('pairs', ['p1', 'p2'], [{ from: 'p1', to: 'p2' }])).toBe(false);
  });

  it('refuses to leave more than one player unpaired', () => {
    expect(validateRelationLinks('pairs', ROSTER, [...both('p1', 'p2'), ...both('p3', 'p4')])).toBe(false);
    expect(validateRelationLinks('pairs', ROSTER.slice(0, 5), both('p1', 'p2'))).toBe(false);
  });

  it('refuses to leave a player unpaired when the roster is even', () => {
    expect(validateRelationLinks('pairs', ['p1', 'p2', 'p3', 'p4'], [...both('p1', 'p2'), { from: 'p3', to: 'p3' }])).toBe(false);
  });
});
