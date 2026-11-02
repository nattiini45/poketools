import { describe, expect, it } from 'vitest';
import { splitIntoRosters } from '../roster-split';

describe('splitIntoRosters', () => {
  it('refuses the pool where one trainer must take the unaffordable Pokémon: 1 and 99, two trainers at 50, one round', () => {
    expect(splitIntoRosters([1, 99], 2, 1, 50)).toBe('no');
  });

  it('refuses a list with fewer entries than the rosters need', () => {
    expect(splitIntoRosters([1], 2, 1, 5)).toBe('no');
  });

  it('accepts a list whose prices split evenly: 2 + 8 and 4 + 6 against 10', () => {
    expect(splitIntoRosters([2, 4, 6, 8], 2, 2, 10)).toBe('yes');
  });

  it('refuses a list that fits the budgets in total but not as rosters', () => {
    // Two trainers, two rounds, budget 7: 4 + 4 + 4 + 1 = 13 is under the 14 they have together,
    // but one trainer would hold two 4s (8) however the four are dealt.
    expect(splitIntoRosters([1, 4, 4, 4], 2, 2, 7)).toBe('no');
    expect(splitIntoRosters([1, 3, 4, 4], 2, 2, 7)).toBe('yes');
  });

  it('chooses the cheapest entries and ignores the dear ones', () => {
    expect(splitIntoRosters([1, 1, 1, 1, 500, 900], 2, 2, 2)).toBe('yes');
  });

  it('accepts exactly at the budget and refuses one point below', () => {
    expect(splitIntoRosters([5, 5, 5, 5], 2, 2, 10)).toBe('yes');
    expect(splitIntoRosters([5, 5, 5, 5], 2, 2, 9)).toBe('no');
  });

  it('is unknown, never a refusal, when the search limit runs out', () => {
    const prices = Array.from({ length: 24 }, (_, k) => 10 + (k % 5));
    expect(splitIntoRosters(prices, 6, 4, 49, 5)).toBe('unknown');
  });

  it('decides realistic lists outright: 16 trainers, 11 rounds, a 400-entry list priced 1 to 20', () => {
    const prices = Array.from({ length: 400 }, (_, k) => 1 + (k % 20)).sort((a, b) => a - b);
    const cheapest176 = prices.slice(0, 176).reduce((a, b) => a + b, 0);
    const average = Math.ceil(cheapest176 / 16);
    expect(splitIntoRosters(prices, 16, 11, average + 20)).toBe('yes');
    expect(splitIntoRosters(prices, 16, 11, average - 1)).toBe('no');
  });

  it('decides a tight but fillable list: 8 trainers, 6 rounds, prices 1 to 6 dealt exactly to a budget of 21', () => {
    const prices = Array.from({ length: 48 }, (_, k) => 1 + (k % 6)).sort((a, b) => a - b);
    expect(splitIntoRosters(prices, 8, 6, 21)).toBe('yes');
    expect(splitIntoRosters(prices, 8, 6, 20)).toBe('no');
  });

  it('has nothing to split without trainers or rounds', () => {
    expect(splitIntoRosters([], 0, 11, 100)).toBe('yes');
    expect(splitIntoRosters([], 3, 0, 100)).toBe('yes');
  });
});
