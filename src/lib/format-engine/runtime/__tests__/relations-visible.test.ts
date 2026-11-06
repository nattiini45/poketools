import { describe, expect, it } from 'vitest';
import { generateRelationLinks, publicLinkPairs, visibleLinks } from '../relations';

const santa = { visibility: { from: 'hidden' as const, to: 'all' as const } };
const players = ['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08'];

describe('visibleLinks keeps no hidden order', () => {
  // Generated links come sorted by `from`: the n-th target belongs to the n-th giver.
  const links = generateRelationLinks({ key: 'santa', shape: 'derangement' }, players, 'seed-0123456789').map((l) => ({ ...l, revealed: false }));

  it('starts from links sorted by the hidden side (the premise of the leak)', () => {
    expect(links.map((l) => l.from)).toEqual([...players]);
  });

  it('lists a viewer who sees the targets in target order, not giver order', () => {
    const seen = visibleLinks(santa, links, { playerId: null, admin: false });
    expect(seen).toHaveLength(links.length);
    expect(seen.every((l) => l.from === null && l.to !== null)).toBe(true);
    const targets = seen.map((l) => l.to);
    expect(targets).toEqual([...targets].sort());
  });

  it('gives the same list for any input order', () => {
    const forward = visibleLinks(santa, links, { playerId: 'outsider', admin: false });
    const backward = visibleLinks(santa, [...links].reverse(), { playerId: 'outsider', admin: false });
    expect(backward).toEqual(forward);
  });

  it('leaves an admin the stored order', () => {
    const seen = visibleLinks(santa, links, { playerId: null, admin: true });
    expect(seen.map((l) => l.from)).toEqual([...players]);
  });
});

describe('publicLinkPairs', () => {
  const links = [
    { from: 'a', to: 'b', revealed: false },
    { from: 'b', to: 'c', revealed: true },
  ];

  it('leaves out a link with a hidden side', () => {
    expect(publicLinkPairs({ visibility: { from: 'hidden', to: 'all' } }, links)).toEqual([['b', 'c']]);
  });

  it('keeps every link when both sides are public', () => {
    expect(publicLinkPairs({ visibility: { from: 'all', to: 'all' } }, links)).toEqual([['a', 'b'], ['b', 'c']]);
  });

  it('never lists a link whose sides only its own players may see', () => {
    expect(publicLinkPairs({ visibility: { from: 'own', to: 'own' } }, [{ from: 'a', to: 'b', revealed: false }])).toEqual([]);
  });
});
