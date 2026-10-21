import { describe, expect, it } from 'vitest';
import { PRICE_GROUPS } from '@/types/point-buy';
import { epbPack } from '@/lib/format-pack';
import { PRICE_GROUP_RANGES, priceGroupMatches } from '../point-buy-display';

describe('PRICE_GROUP_RANGES', () => {
  it('covers every price group with an ordered range', () => {
    for (const group of PRICE_GROUPS) {
      const [min, max] = PRICE_GROUP_RANGES[group];
      expect(min).toBeLessThan(max);
    }
  });
});

describe('priceGroupMatches (groups in one tab read the same)', () => {
  const stored = ['premium', 'mittel', 'guenstig', 'budget'];
  const ids = (group: string) => stored.filter((g) => priceGroupMatches(g, group));

  it('the bottom tab option shows both groups that share its label, from either stored key', () => {
    // Both active packs put guenstig and budget in one finder tab (example 9–1, league 17–8).
    expect(epbPack.priceTabs.some((tab) => {
      const [gMin, gMax] = epbPack.priceGroups.guenstig;
      const [bMin, bMax] = epbPack.priceGroups.budget;
      return tab.min <= bMin && gMax <= tab.max && tab.min <= gMin && bMax <= tab.max;
    })).toBe(true);
    expect(ids('guenstig')).toEqual(['guenstig', 'budget']);
    expect(ids('budget')).toEqual(['guenstig', 'budget']);
  });

  it('other groups stay exact; an unknown group matches nothing', () => {
    expect(ids('premium')).toEqual(['premium']);
    expect(ids('mittel')).toEqual(['mittel']);
    expect(ids('nope')).toEqual([]);
  });
});
