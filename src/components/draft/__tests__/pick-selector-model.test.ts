import { describe, expect, it } from 'vitest';
import { matchRank, NO_MATCH } from '@/lib/pkmn/i18n/search';
import {
  auctionReserve,
  bidBelowReserve,
  bidOverBudget,
  bidProblems,
  isPickBlocked,
  lineSearchKeys,
  listedPickPrice,
  pickPointsToSend,
  pointsOnRowSelect,
  remainingAfterPick,
  reserveOverBudget,
  rowPointCost,
} from '../pick-selector-model';

describe('remainingAfterPick (draft-backend §13.2)', () => {
  it('is the remaining budget minus the cost of the selected line', () => {
    expect(remainingAfterPick(40, 12)).toBe(28);
    expect(remainingAfterPick(12, 12)).toBe(0);
  });

  it('is null without a budget and unchanged without a known cost', () => {
    expect(remainingAfterPick(null, 12)).toBeNull();
    expect(remainingAfterPick(40, undefined)).toBe(40);
    expect(remainingAfterPick(40, null)).toBe(40);
  });
});

describe('lineSearchKeys', () => {
  const matches = (query: string, base: string, stage3: string | null) =>
    matchRank(query, lineSearchKeys(base, stage3)) !== NO_MATCH;

  it('matches the base and the final stage in English', () => {
    expect(matches('charm', 'Charmander', 'Charizard')).toBe(true);
    expect(matches('chariz', 'Charmander', 'Charizard')).toBe(true);
    expect(matches('pikachu', 'Charmander', 'Charizard')).toBe(false);
  });

  it('matches the German names whatever the UI language', () => {
    expect(matches('glumanda', 'Charmander', 'Charizard')).toBe(true);
    expect(matches('glurak', 'Charmander', 'Charizard')).toBe(true);
  });

  it('works for a line without a final stage', () => {
    expect(matches('glumanda', 'Charmander', null)).toBe(true);
    expect(matches('glurak', 'Charmander', null)).toBe(false);
  });
});

describe('listedPickPrice / pickPointsToSend (legacy pick pricing)', () => {
  it('a budget pool entry with a cost is a fixed price, sent whatever was typed', () => {
    expect(listedPickPrice('budget', false, 20)).toBe(20);
    expect(listedPickPrice('budget', false, 20, 5)).toBe(20);
    expect(pickPointsToSend({ draftType: 'budget', isEpb: false, pointCost: 20, typedPoints: 1 })).toBe(20);
  });

  it('a budget pool entry without a cost is priced at the pool default, else 0 (the server price)', () => {
    expect(listedPickPrice('budget', false, null, 8)).toBe(8);
    expect(listedPickPrice('budget', false, undefined, 8)).toBe(8);
    expect(listedPickPrice('budget', false, null, null)).toBe(0);
    expect(listedPickPrice('budget', false, undefined)).toBe(0);
    expect(
      pickPointsToSend({ draftType: 'budget', isEpb: false, pointCost: undefined, defaultPointCost: 8, typedPoints: 7 }),
    ).toBe(8);
    expect(pickPointsToSend({ draftType: 'budget', isEpb: false, pointCost: null, typedPoints: 7 })).toBe(0);
  });

  it('an auction pick sends the typed bid, never the listed cost or the pool default', () => {
    expect(listedPickPrice('auction', false, 20)).toBeNull();
    expect(listedPickPrice('auction', false, null, 8)).toBeNull();
    expect(
      pickPointsToSend({ draftType: 'auction', isEpb: false, pointCost: 20, defaultPointCost: 8, typedPoints: 35 }),
    ).toBe(35);
  });

  it('EPB sends the line price; snake sends nothing', () => {
    expect(pickPointsToSend({ draftType: 'snake', isEpb: true, pointCost: 12, typedPoints: 1 })).toBe(12);
    expect(pickPointsToSend({ draftType: 'snake', isEpb: true, pointCost: null, typedPoints: 1 })).toBeUndefined();
    expect(pickPointsToSend({ draftType: 'snake', isEpb: false, pointCost: 12, typedPoints: 1 })).toBeUndefined();
    expect(listedPickPrice('snake', false, 12, 8)).toBeNull();
  });
});

describe('auctionReserve / bidBelowReserve (the server floor, max(1, point_cost))', () => {
  it('is the entry cost, at least 1, and only for auction picks', () => {
    expect(auctionReserve('auction', false, 20)).toBe(20);
    expect(auctionReserve('auction', false, null)).toBe(1);
    expect(auctionReserve('auction', false, 0)).toBe(1);
    expect(auctionReserve('budget', false, 20)).toBeNull();
    expect(auctionReserve('snake', false, 20)).toBeNull();
    expect(auctionReserve('auction', true, 20)).toBeNull();
  });

  it('is true only for a bid actually under the reserve (a non-whole bid is its own reason)', () => {
    expect(bidBelowReserve(20, 19)).toBe(true);
    expect(bidBelowReserve(20, 20)).toBe(false);
    expect(bidBelowReserve(1, 0)).toBe(true);
    expect(bidBelowReserve(12, 12.5)).toBe(false);
    expect(bidBelowReserve(12, 11.5)).toBe(true);
    expect(bidBelowReserve(null, 0)).toBe(false);
  });
});

describe('bidOverBudget / reserveOverBudget (auction affordability)', () => {
  it('blocks a bid above the remaining budget, never without a known budget', () => {
    expect(bidOverBudget(20, 21)).toBe(true);
    expect(bidOverBudget(20, 20)).toBe(false);
    expect(bidOverBudget(0, 1)).toBe(true);
    expect(bidOverBudget(null, 999)).toBe(false);
  });

  it('marks an auction line whose reserve is above the remaining budget', () => {
    expect(reserveOverBudget(30, 25)).toBe(true);
    expect(reserveOverBudget(25, 25)).toBe(false);
    expect(reserveOverBudget(null, 0)).toBe(false);
    expect(reserveOverBudget(30, null)).toBe(false);
  });
});

describe('pointsOnRowSelect (the points field after a row click)', () => {
  const base = { currentPoints: 17, isEpb: false, pointCost: 12, reserve: 12 };

  it('re-clicking the selected line keeps the typed bid', () => {
    expect(pointsOnRowSelect({ ...base, alreadySelected: true })).toBe(17);
  });

  it('a newly selected auction line starts its bid at the reserve', () => {
    expect(pointsOnRowSelect({ ...base, alreadySelected: false })).toBe(12);
  });

  it('a newly selected EPB line seeds its price; other picks keep the value', () => {
    expect(pointsOnRowSelect({ ...base, alreadySelected: false, isEpb: true, reserve: null })).toBe(12);
    expect(pointsOnRowSelect({ ...base, alreadySelected: false, isEpb: true, pointCost: null, reserve: null })).toBe(17);
    expect(pointsOnRowSelect({ ...base, alreadySelected: false, reserve: null })).toBe(17);
  });
});

describe('rowPointCost (rows price from the same entry as the selection)', () => {
  it('prefers the pool entry cost, so evo-league rows (no cost of their own) match the selected-line checks', () => {
    expect(rowPointCost(12, undefined)).toBe(12);
    expect(rowPointCost(0, 7)).toBe(0);
  });

  it('falls back to the row cost, else undefined', () => {
    expect(rowPointCost(null, 7)).toBe(7);
    expect(rowPointCost(undefined, undefined)).toBeUndefined();
    expect(rowPointCost(null, null)).toBeUndefined();
  });

  it('feeds the same reserve and price the selection uses', () => {
    const cost = rowPointCost(30, undefined);
    expect(auctionReserve('auction', false, cost)).toBe(30);
    expect(listedPickPrice('budget', false, cost, 3)).toBe(30);
    expect(pointsOnRowSelect({ alreadySelected: false, currentPoints: 1, isEpb: false, pointCost: cost, reserve: 30 })).toBe(30);
  });
});

describe('bidProblems (each reason the live region announces)', () => {
  it('a valid bid and a pick without a bid have none', () => {
    expect(bidProblems(12, 40, 12)).toEqual([]);
    expect(bidProblems(12, 40, 40)).toEqual([]);
    expect(bidProblems(12, null, 999)).toEqual([]);
    expect(bidProblems(null, 40, 41.5)).toEqual([]);
  });

  it('12.5 with reserve 12 is not a whole number, but not below the reserve', () => {
    expect(bidProblems(12, 40, 12.5)).toEqual(['notWhole']);
  });

  it('11 with reserve 12 is below the reserve only', () => {
    expect(bidProblems(12, 40, 11)).toEqual(['belowReserve']);
  });

  it('40.5 with 40 left is both not whole and over budget', () => {
    expect(bidProblems(12, 40, 40.5)).toEqual(['notWhole', 'overBudget']);
  });

  it('41 with 40 left is over budget only; 11.5 with reserve 12 is not whole and below', () => {
    expect(bidProblems(12, 40, 41)).toEqual(['overBudget']);
    expect(bidProblems(12, 40, 11.5)).toEqual(['notWhole', 'belowReserve']);
  });

  it('a reserve above the budget can make a bid both below the reserve and over budget', () => {
    expect(bidProblems(30, 25, 28)).toEqual(['belowReserve', 'overBudget']);
  });

  it('an unparsable bid (NaN) is reported as not a whole number', () => {
    expect(bidProblems(1, 40, Number.NaN)).toEqual(['notWhole']);
  });
});

describe('isPickBlocked (confirm button, armed dialog and handleConfirm)', () => {
  const auction = { hasSelection: true, listedPrice: null, reserve: 12, remainingBudget: 40 };

  it('blocks without a selection', () => {
    expect(isPickBlocked({ ...auction, hasSelection: false, typedPoints: 20 })).toBe(true);
  });

  it('a typed auction bid above the budget blocks the pick; at the budget it does not', () => {
    expect(isPickBlocked({ ...auction, typedPoints: 41 })).toBe(true);
    expect(isPickBlocked({ ...auction, typedPoints: 40 })).toBe(false);
  });

  it('a bid below the reserve or not a whole number blocks the pick', () => {
    expect(isPickBlocked({ ...auction, typedPoints: 11 })).toBe(true);
    expect(isPickBlocked({ ...auction, typedPoints: 12.5 })).toBe(true);
    expect(isPickBlocked({ ...auction, typedPoints: 12 })).toBe(false);
  });

  it('an auction reserve above the budget blocks every bid, through bidProblems alone', () => {
    // No bid passes both the reserve (30) and the budget (25), so bidProblems always names a reason.
    for (const typedPoints of [1, 24, 25, 26, 29, 30, 31, 25.5, Number.NaN]) {
      expect(bidProblems(30, 25, typedPoints).length).toBeGreaterThan(0);
      expect(isPickBlocked({ ...auction, reserve: 30, remainingBudget: 25, typedPoints })).toBe(true);
    }
  });

  it('a listed price above the budget blocks; the typed value is ignored for listed prices', () => {
    const listed = { hasSelection: true, reserve: null, remainingBudget: 25 };
    expect(isPickBlocked({ ...listed, listedPrice: 30, typedPoints: 1 })).toBe(true);
    expect(isPickBlocked({ ...listed, listedPrice: 25, typedPoints: 999 })).toBe(false);
    expect(isPickBlocked({ ...listed, listedPrice: 30, remainingBudget: null, typedPoints: 1 })).toBe(false);
  });

  it('a snake pick (no price, no bid) is never blocked once selected', () => {
    const snake = { hasSelection: true, listedPrice: null, reserve: null, remainingBudget: null, typedPoints: 0.5 };
    expect(isPickBlocked(snake)).toBe(false);
  });
});
