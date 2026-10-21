import { describe, expect, it } from 'vitest';
import { defaultPickOrder, isPickOrderAllowed, isTurnEnforced, poolFormat, pricingOfDraftType } from '../pool-format';

describe('pool-format', () => {
  it('derives the pre-split order from draft_type', () => {
    expect(defaultPickOrder('snake')).toBe('snake');
    expect(defaultPickOrder('budget')).toBe('free');
    expect(defaultPickOrder('auction')).toBe('free');
  });

  it('enforces turns for snake and linear only', () => {
    expect(isTurnEnforced('snake')).toBe(true);
    expect(isTurnEnforced('linear')).toBe(true);
    expect(isTurnEnforced('free')).toBe(false);
  });

  it('allows any order except a turn order for an auction', () => {
    expect(isPickOrderAllowed('budget', 'snake')).toBe(true);
    expect(isPickOrderAllowed('snake', 'linear')).toBe(true);
    expect(isPickOrderAllowed('auction', 'free')).toBe(true);
    expect(isPickOrderAllowed('auction', 'snake')).toBe(false);
    expect(isPickOrderAllowed('auction', 'linear')).toBe(false);
  });

  it('reads draft_type as pricing; queue pools are snake + point buy whatever their columns say', () => {
    expect(pricingOfDraftType('snake')).toBe('none');
    expect(pricingOfDraftType('budget')).toBe('fixed');
    expect(pricingOfDraftType('auction')).toBe('auction');
    expect(poolFormat({ draft_type: 'budget', pick_order: 'linear', engine: 'legacy' })).toEqual({ order: 'linear', pricing: 'fixed' });
    expect(poolFormat({ draft_type: 'snake', pick_order: 'free', engine: 'queue' })).toEqual({ order: 'snake', pricing: 'pointBuy' });
  });
});
