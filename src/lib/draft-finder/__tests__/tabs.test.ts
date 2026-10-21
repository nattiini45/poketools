import { afterEach, describe, expect, it, vi } from 'vitest';
import fixtureLines from '@/app/(public)/draft-preview/fixture-lines.example.json';
import { countByTab, PRICE_TAB_KEYS } from '../tabs';

// The public suite runs on the example pack (tabs 25-20 / 19-15 / 14-10 / 9-1).
describe('finder price tabs (draft-frontend §4.6)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('V13: the 48-line example fixture counts 12 / 12 / 12 / 12, all 48 (derived from data)', () => {
    // draft-preview/fixture-lines.example.json (DF3): the synthetic lines the preview drafts from.
    const price = new Map(fixtureLines.map((e) => [e.line_id, e.price]));
    expect(countByTab(price.keys(), (id) => price.get(id) ?? 0)).toEqual({
      '25-20': 12,
      '19-15': 12,
      '14-10': 12,
      '9-1': 12,
      all: 48,
    });
  });

  it('lists the tabs in strip order, all last', () => {
    expect(PRICE_TAB_KEYS).toEqual(['25-20', '19-15', '14-10', '9-1', 'all']);
  });

  it('counts a price outside every tab under all only and reports it once', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prices: Record<string, number> = { a: 0, b: 16 };
    expect(countByTab(['a', 'b'], (id) => prices[id])).toEqual({ '25-20': 0, '19-15': 1, '14-10': 0, '9-1': 0, all: 2 });
    countByTab(['a'], (id) => prices[id]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('[draft-finder]');
  });
});
