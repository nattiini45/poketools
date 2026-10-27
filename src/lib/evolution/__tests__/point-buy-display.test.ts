import { describe, expect, it } from 'vitest';
import { PRICE_GROUPS, type PriceGroup } from '@/types/point-buy';
import { epbPack } from '@/lib/format-pack';
import {
  PRICE_GROUP_RANGES,
  filterAndSortRosterEntries,
  priceGroupFilterOptions,
  priceGroupLineCounts,
  priceGroupMatches,
  togglePriceGroup,
  type RosterRowQuery,
} from '../point-buy-display';

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

describe('togglePriceGroup (the pill click)', () => {
  it('selects the clicked group, and a second click on it clears the filter', () => {
    expect(togglePriceGroup('', 'premium')).toBe('premium');
    expect(togglePriceGroup('premium', 'premium')).toBe('');
  });

  it('another group replaces the selection', () => {
    expect(togglePriceGroup('premium', 'mittel')).toBe('mittel');
  });

  it('a group that reads the same as the selected one counts as the selected one', () => {
    expect(togglePriceGroup('budget', 'guenstig')).toBe('');
  });
});

/** A point-buy line with only what the roster filter and sort read. */
function line(
  line_number: number,
  price_group: PriceGroup,
  price: number,
  base_pokemon: string,
  kills_to_stage2 = 3,
  stage2_pokemon = 'Raichu',
  stage3_pokemon: string | null = null,
) {
  return { line_number, price_group, price, base_pokemon, stage2_pokemon, stage3_pokemon, kills_to_stage2 };
}

const LINES = [
  line(1, 'premium', 25, 'Charmander', 5, 'Charmeleon', 'Charizard'),
  line(2, 'mittel', 12, 'Pikachu', 2),
  line(3, 'guenstig', 6, 'Bulbasaur', 4, 'Ivysaur', 'Venusaur'),
  line(4, 'budget', 3, 'Rattata', 1, 'Raticate'),
];
const numbers = (rows: { line_number: number }[]) => rows.map((r) => r.line_number);
const ALL: RosterRowQuery = { search: '', priceGroup: '', sortKey: 'line' };

describe('priceGroupLineCounts', () => {
  it('counts per displayed group in ladder order, stored groups that read the same together', () => {
    const counts = priceGroupLineCounts(LINES);
    expect(counts.map((c) => c.group)).toEqual(priceGroupFilterOptions());
    expect(Object.fromEntries(counts.map((c) => [c.group, c.count]))).toEqual({
      premium: 1,
      hoch: 0,
      mittel: 1,
      guenstig: 2,
    });
  });

  it('an empty list counts zero everywhere', () => {
    expect(priceGroupLineCounts([]).every((c) => c.count === 0)).toBe(true);
  });
});

describe('filterAndSortRosterEntries', () => {
  it('no query keeps every line, ordered by line number', () => {
    expect(numbers(filterAndSortRosterEntries([LINES[2], LINES[0], LINES[3], LINES[1]], ALL))).toEqual([1, 2, 3, 4]);
  });

  it('a selected group keeps its lines only, both stored groups that share a label included', () => {
    expect(numbers(filterAndSortRosterEntries(LINES, { ...ALL, priceGroup: 'premium' }))).toEqual([1]);
    expect(numbers(filterAndSortRosterEntries(LINES, { ...ALL, priceGroup: 'guenstig' }))).toEqual([3, 4]);
    expect(numbers(filterAndSortRosterEntries(LINES, { ...ALL, priceGroup: 'hoch' }))).toEqual([]);
  });

  it('the search matches any stage, in English or German, folded and without spaces', () => {
    expect(numbers(filterAndSortRosterEntries(LINES, { ...ALL, search: 'charizard' }))).toEqual([1]);
    expect(numbers(filterAndSortRosterEntries(LINES, { ...ALL, search: 'Glumanda' }))).toEqual([1]);
    expect(numbers(filterAndSortRosterEntries(LINES, { ...ALL, search: 'ivy saur' }))).toEqual([3]);
    expect(numbers(filterAndSortRosterEntries(LINES, { ...ALL, search: 'nothing-here' }))).toEqual([]);
  });

  it('search and price group narrow together', () => {
    expect(numbers(filterAndSortRosterEntries(LINES, { search: 'rat', priceGroup: 'guenstig', sortKey: 'line' }))).toEqual([4]);
    expect(numbers(filterAndSortRosterEntries(LINES, { search: 'rat', priceGroup: 'premium', sortKey: 'line' }))).toEqual([]);
  });

  it('sorts by price ascending or descending and by kills to stage 2', () => {
    expect(numbers(filterAndSortRosterEntries(LINES, { ...ALL, sortKey: 'price-asc' }))).toEqual([4, 3, 2, 1]);
    expect(numbers(filterAndSortRosterEntries(LINES, { ...ALL, sortKey: 'price-desc' }))).toEqual([1, 2, 3, 4]);
    expect(numbers(filterAndSortRosterEntries(LINES, { ...ALL, sortKey: 'kills' }))).toEqual([4, 2, 3, 1]);
  });

  it('returns a new array and leaves the input order alone', () => {
    const input = [LINES[3], LINES[0]];
    const out = filterAndSortRosterEntries(input, ALL);
    expect(out).not.toBe(input);
    expect(numbers(input)).toEqual([4, 1]);
  });
});
