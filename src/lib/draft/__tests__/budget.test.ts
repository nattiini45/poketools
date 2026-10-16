import { describe, expect, it } from 'vitest';
import {
  evaluateCompletion,
  hasLegalPick,
  minCompletion,
  seasonRemainingPoints,
  type SeasonPointLedger,
} from '../budget';

describe('minCompletion', () => {
  it('sums the cheapest prices and caps the count at the list length', () => {
    expect(minCompletion([3, 5, 8, 13], 2)).toEqual({ count: 2, cost: 8 });
    expect(minCompletion([3, 5], 4)).toEqual({ count: 2, cost: 8 });
    expect(minCompletion([3, 5], 0)).toEqual({ count: 0, cost: 0 });
    expect(minCompletion([3, 5], -1)).toEqual({ count: 0, cost: 0 });
    expect(minCompletion([], 3)).toEqual({ count: 0, cost: 0 });
  });
});

describe('evaluateCompletion — initial draft', () => {
  it('budget 180, 7 picks spent 150, candidate 22, cheapest other 10 → BUDGET_INFEASIBLE {shortfall 2, slots 1}', () => {
    // 9-slot roster, 7 picked: 2 open (the candidate's slot and one more).
    const result = evaluateCompletion({ remaining: 180 - 150, openSlots: 2, price: 22, otherLegalPricesSorted: [10, 12, 15] });
    expect(result).toEqual({
      ok: false,
      code: 'BUDGET_INFEASIBLE',
      params: { shortfall: 2, slots: 1, remaining_after: 8, min_cost: 10 },
    });
  });

  it('the same player can take a 20-point line (exactly 10 left for the last slot)', () => {
    expect(evaluateCompletion({ remaining: 30, openSlots: 2, price: 20, otherLegalPricesSorted: [10, 12] })).toEqual({
      ok: true,
      remainingAfter: 10,
    });
  });

  it('spec example shape: "at least 4 points short of filling your last 2 roster slots"', () => {
    const result = evaluateCompletion({ remaining: 20, openSlots: 3, price: 10, otherLegalPricesSorted: [7, 7, 9] });
    expect(result).toMatchObject({ ok: false, code: 'BUDGET_INFEASIBLE', params: { shortfall: 4, slots: 2 } });
  });

  it('INSUFFICIENT_BUDGET comes first when the price alone exceeds the budget', () => {
    expect(evaluateCompletion({ remaining: 9, openSlots: 5, price: 10, otherLegalPricesSorted: [] })).toEqual({
      ok: false,
      code: 'INSUFFICIENT_BUDGET',
      params: { price: 10, remaining: 9 },
    });
  });

  it('NOT_ENOUGH_LINES when fewer legal lines remain than open slots after the pick', () => {
    expect(evaluateCompletion({ remaining: 100, openSlots: 4, price: 5, otherLegalPricesSorted: [5, 6] })).toEqual({
      ok: false,
      code: 'NOT_ENOUGH_LINES',
      params: { slots: 3, available: 2 },
    });
  });

  it('NOT_ENOUGH_LINES outranks BUDGET_INFEASIBLE (SQL order)', () => {
    const result = evaluateCompletion({ remaining: 10, openSlots: 3, price: 5, otherLegalPricesSorted: [50] });
    expect(result).toMatchObject({ code: 'NOT_ENOUGH_LINES' });
  });

  it('the last open slot only needs the price itself', () => {
    expect(evaluateCompletion({ remaining: 7, openSlots: 1, price: 7, otherLegalPricesSorted: [] })).toEqual({
      ok: true,
      remainingAfter: 0,
    });
  });
});

describe('evaluateCompletion — redraft (same rule, SPEC Prompt 6 §8)', () => {
  // leftover 3 + drops 8 + 11 + 14 = 36 redraft points for 3 replacement slots.
  const budget = 3 + 8 + 11 + 14;

  it('the redraft budget is 36', () => {
    expect(budget).toBe(36);
  });

  it('picks 17 / 10 / 9 are accepted one after another', () => {
    const first = evaluateCompletion({ remaining: budget, openSlots: 3, price: 17, otherLegalPricesSorted: [9, 10, 12] });
    expect(first).toEqual({ ok: true, remainingAfter: 19 });
    const second = evaluateCompletion({ remaining: 19, openSlots: 2, price: 10, otherLegalPricesSorted: [9, 12] });
    expect(second).toEqual({ ok: true, remainingAfter: 9 });
    const third = evaluateCompletion({ remaining: 9, openSlots: 1, price: 9, otherLegalPricesSorted: [12] });
    expect(third).toEqual({ ok: true, remainingAfter: 0 });
  });

  it('17 first with the cheapest other lines at 10 + 10 → shortfall 1', () => {
    const result = evaluateCompletion({ remaining: budget, openSlots: 3, price: 17, otherLegalPricesSorted: [10, 10, 14] });
    expect(result).toEqual({
      ok: false,
      code: 'BUDGET_INFEASIBLE',
      params: { shortfall: 1, slots: 2, remaining_after: 19, min_cost: 20 },
    });
  });
});

describe('hasLegalPick (twin of the SQL blocked-slot check)', () => {
  it('is true when the cheapest open-slot completion fits the budget', () => {
    expect(hasLegalPick([9, 10, 12], 3, 31)).toBe(true);
    expect(hasLegalPick([9, 10, 12], 3, 30)).toBe(false);
  });

  it('is false with fewer legal lines than open slots', () => {
    expect(hasLegalPick([1, 2], 3, 100)).toBe(false);
  });

  it('is false without an open slot', () => {
    expect(hasLegalPick([1], 0, 100)).toBe(false);
  });

  it('agrees with "some line passes evaluateCompletion" on random inputs', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    for (let run = 0; run < 300; run++) {
      const prices = Array.from({ length: rand(8) }, () => 1 + rand(25)).sort((a, b) => a - b);
      const open = 1 + rand(4);
      const remaining = rand(60);
      const anyFeasible = prices.some((price, idx) =>
        evaluateCompletion({
          remaining,
          openSlots: open,
          price,
          otherLegalPricesSorted: prices.filter((_, j) => j !== idx),
        }).ok,
      );
      expect(hasLegalPick(prices, open, remaining)).toBe(anyFeasible);
    }
  });
});

describe('seasonRemainingPoints (twin of epb__season_remaining_points)', () => {
  const base: SeasonPointLedger = {
    initialBudget: 180,
    tokenRatio: 3,
    picks: [],
    legacyDraftTokenGrants: [],
    draftTokenPurchases: [],
    legacyRedraftSpend: [],
    redraftRefunds: [],
  };

  it('subtracts non-void picks of non-cancelled pools only', () => {
    const ledger: SeasonPointLedger = {
      ...base,
      picks: [
        { player_id: 'a', points_spent: 100, voided: false, pool_cancelled: false },
        { player_id: 'a', points_spent: 40, voided: true, pool_cancelled: false },
        { player_id: 'a', points_spent: 30, voided: false, pool_cancelled: true },
        { player_id: 'a', points_spent: null, voided: false, pool_cancelled: false },
        { player_id: 'b', points_spent: 170, voided: false, pool_cancelled: false },
      ],
    };
    expect(seasonRemainingPoints(ledger, 'a')).toBe(80);
    expect(seasonRemainingPoints(ledger, 'b')).toBe(10);
    expect(seasonRemainingPoints(ledger, 'nobody')).toBe(180);
  });

  it('subtracts legacy grant tokens × ratio, purchases and legacy redraft spends; adds refunds', () => {
    const ledger: SeasonPointLedger = {
      ...base,
      picks: [{ player_id: 'a', points_spent: 150, voided: false, pool_cancelled: false }],
      legacyDraftTokenGrants: [{ player_id: 'a', token_count: 1 }],
      draftTokenPurchases: [{ player_id: 'a', points_spent: 3 }, { player_id: 'b', points_spent: 3 }],
      legacyRedraftSpend: [{ player_id: 'a', points_spent: 5 }],
      redraftRefunds: [{ player_id: 'a', dropped_price: 12 }],
    };
    // 180 − 150 − 1×3 − 3 − 5 + 12
    expect(seasonRemainingPoints(ledger, 'a')).toBe(31);
  });

  it('redraft budget: leftover 3 + dropped 8 + 11 + 14 = 36; Draft Kill Token points never come back', () => {
    const picks = [
      ...[8, 11, 14].map((p) => ({ player_id: 'a', points_spent: p, voided: false, pool_cancelled: false })),
      { player_id: 'a', points_spent: 180 - 3 - 33 - 6, voided: false, pool_cancelled: false },
    ];
    const afterTokens: SeasonPointLedger = {
      ...base,
      picks,
      draftTokenPurchases: [{ player_id: 'a', points_spent: 3 }, { player_id: 'a', points_spent: 3 }],
    };
    // Initial picks 171, two Draft Kill Tokens 6 → leftover 3.
    expect(seasonRemainingPoints(afterTokens, 'a')).toBe(3);
    // The dropped lines' initial picks stay (they are not voided); their prices come back as refunds.
    const afterDrops: SeasonPointLedger = {
      ...afterTokens,
      redraftRefunds: [8, 11, 14].map((p) => ({ player_id: 'a', dropped_price: p })),
    };
    expect(seasonRemainingPoints(afterDrops, 'a')).toBe(36);
    // Redraft picks 17 + 10 + 9 spend it exactly.
    const afterRedraft: SeasonPointLedger = {
      ...afterDrops,
      picks: [...picks, ...[17, 10, 9].map((p) => ({ player_id: 'a', points_spent: p, voided: false, pool_cancelled: false }))],
    };
    expect(seasonRemainingPoints(afterRedraft, 'a')).toBe(0);
  });
});
