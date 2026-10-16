import { describe, expect, it } from 'vitest';
import { epbPack } from '@/lib/format-pack';
import fixture from './fixtures/example-list.json';
import { countByTab, PRICE_TABS, priceTabIndex, tabOf } from '../price-tabs';

// The public suite runs on the example pack (tabs 25-20 / 19-15 / 14-10 / 9-1).
describe('price tabs', () => {
  it.each([
    [25, '25-20'],
    [20, '25-20'],
    [19, '19-15'],
    [15, '19-15'],
    [14, '14-10'],
    [10, '14-10'],
    [9, '9-1'],
    [1, '9-1'],
    [0, null],
    [26, null],
  ])('tabOf(%i) = %s', (price, tab) => {
    expect(tabOf(price)).toBe(tab);
  });

  it('lists the pack tabs in pack order', () => {
    expect(PRICE_TABS).toEqual(epbPack.priceTabs);
    expect(PRICE_TABS.map((t) => t.key)).toEqual(['25-20', '19-15', '14-10', '9-1']);
  });

  it('indexes the tabs by position (the colour slot), -1 for all', () => {
    expect(PRICE_TABS.map((t) => priceTabIndex(t.key))).toEqual([0, 1, 2, 3]);
    expect(priceTabIndex('all')).toBe(-1);
  });

  it('counts the example list fixture 12 / 12 / 12 / 12, all 48 (derived from data)', () => {
    const price = new Map(fixture.entries.map((e) => [e.line_id, e.price]));
    expect(countByTab(price.keys(), (id) => price.get(id) ?? 0)).toEqual({
      '25-20': 12,
      '19-15': 12,
      '14-10': 12,
      '9-1': 12,
      all: 48,
    });
  });

  it('counts a price outside every tab under all only', () => {
    expect(countByTab(['a', 'b'], (id) => (id === 'a' ? 0 : 16))).toEqual({
      '25-20': 0,
      '19-15': 1,
      '14-10': 0,
      '9-1': 0,
      all: 2,
    });
  });
});
