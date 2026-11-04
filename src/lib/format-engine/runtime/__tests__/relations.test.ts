import { describe, expect, it } from 'vitest';
import { generateRelationLinks, visibleLinks } from '../relations';

const IDS = ['d', 'a', 'f', 'b', 'e', 'c', 'h', 'g'];
const derangement = { key: 'santa', shape: 'derangement' as const };

const targetOf = (links: { from: string; to: string }[]) => new Map(links.map((l) => [l.from, l.to]));

describe('generateRelationLinks', () => {
  it('draws a derangement: nobody gives to themself, everybody gives and receives once', () => {
    for (const seed of ['s1', 's2', 's3', 'seed-0123456789']) {
      const links = generateRelationLinks(derangement, IDS, seed);
      expect(links).toHaveLength(IDS.length);
      expect(links.every((l) => l.from !== l.to)).toBe(true);
      expect(new Set(links.map((l) => l.from)).size).toBe(IDS.length);
      expect(new Set(links.map((l) => l.to)).size).toBe(IDS.length);
    }
  });

  it('draws one single cycle through the whole roster', () => {
    for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
      const next = targetOf(generateRelationLinks(derangement, IDS, seed));
      let at = IDS[0];
      const seen = new Set<string>();
      do {
        seen.add(at);
        at = next.get(at) as string;
      } while (at !== IDS[0]);
      expect(seen.size).toBe(IDS.length);
    }
  });

  it('is deterministic per seed and roster, whatever the order of the roster', () => {
    const a = generateRelationLinks(derangement, IDS, 'seed-a');
    expect(generateRelationLinks(derangement, [...IDS].reverse(), 'seed-a')).toEqual(a);
    expect(generateRelationLinks(derangement, IDS, 'seed-a')).toEqual(a);
  });

  it('differs across seeds', () => {
    const draws = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((seed) => JSON.stringify(generateRelationLinks(derangement, IDS, seed))));
    expect(draws.size).toBeGreaterThan(1);
  });

  it('gives a pair of players the swap, and nothing for fewer than two', () => {
    expect(generateRelationLinks(derangement, ['x', 'y'], 's')).toEqual([{ from: 'x', to: 'y' }, { from: 'y', to: 'x' }]);
    expect(generateRelationLinks(derangement, ['x'], 's')).toEqual([]);
    expect(generateRelationLinks(derangement, [], 's')).toEqual([]);
  });

  it('pairs players both ways and leaves the odd one out', () => {
    const links = generateRelationLinks({ key: 'duo', shape: 'pairs' }, IDS.slice(0, 7), 's');
    expect(links).toHaveLength(6);
    const next = targetOf(links);
    for (const [from, to] of next) expect(next.get(to)).toBe(from);
    expect(generateRelationLinks({ key: 'duo', shape: 'pairs' }, IDS.slice(0, 7), 's')).toEqual(links);
  });

  it('draws nothing for a manual relation', () => {
    expect(generateRelationLinks({ key: 'm', shape: 'manual' }, IDS, 's')).toEqual([]);
  });
});

describe('visibleLinks', () => {
  // a gives to b, b to c, c to a.
  const links = [
    { from: 'a', to: 'b', revealed: false },
    { from: 'b', to: 'c', revealed: false },
    { from: 'c', to: 'a', revealed: false },
  ];
  const santa = { visibility: { from: 'hidden' as const, to: 'own' as const } };

  it('shows an admin every link whole', () => {
    expect(visibleLinks(santa, links, { playerId: null, admin: true })).toEqual(links);
  });

  it('shows a player only whom they give to, never who gives to them', () => {
    expect(visibleLinks(santa, links, { playerId: 'b', admin: false })).toEqual([{ from: 'b', to: 'c', revealed: false }]);
  });

  it('never serialises a hidden side to a non-admin', () => {
    for (const viewer of ['a', 'b', 'c', 'outsider', null]) {
      const text = JSON.stringify(visibleLinks(santa, links, { playerId: viewer, admin: false }));
      // The only ids that may appear are the viewer's own and the target of their own link.
      const target = links.find((l) => l.from === viewer)?.to;
      for (const id of ['a', 'b', 'c']) {
        if (id === viewer || id === target) continue;
        expect(text, `viewer ${viewer} learned ${id}`).not.toContain(`"${id}"`);
      }
    }
    expect(visibleLinks(santa, links, { playerId: null, admin: false })).toEqual([]);
    expect(visibleLinks(santa, links, { playerId: 'outsider', admin: false })).toEqual([]);
  });

  it('shows the giver to the receiver when the source is own', () => {
    const open = { visibility: { from: 'own' as const, to: 'hidden' as const } };
    expect(visibleLinks(open, links, { playerId: 'b', admin: false })).toEqual([{ from: 'a', to: 'b', revealed: false }]);
  });

  it('shows every side to everyone once revealed, or when set to all', () => {
    const revealed = links.map((l) => ({ ...l, revealed: true }));
    expect(visibleLinks(santa, revealed, { playerId: null, admin: false })).toEqual(revealed);
    const everyone = { visibility: { from: 'all' as const, to: 'all' as const } };
    expect(visibleLinks(everyone, links, { playerId: 'outsider', admin: false })).toHaveLength(3);
  });
});
