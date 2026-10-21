import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { draftPoolCreateSchema } from '@/lib/validation/schemas';
import { LEGACY_POINTS_MAX } from '@/lib/draft/points-limits';
import {
  buildPoolCreateBody,
  defaultPriceForVisibility,
  effectivePickOrder,
  EMPTY_NUMBER_FIELD,
  PoolBudgetFields,
  poolFieldIds,
  showsDefaultPriceField,
  validateDefaultPrice,
  validatePoolBudget,
  validatePoolCreateForm,
  type NumberFieldState,
} from '../DraftPoolManager';

const SEASON = '11111111-1111-4111-8111-111111111111';

describe('buildPoolCreateBody', () => {
  it('snake: no budget, no default price', () => {
    expect(buildPoolCreateBody(SEASON, 'snake', 100, '5')).toEqual({ season_id: SEASON, draft_type: 'snake' });
  });

  it('auction: the budget under the key the route reads, never a default price', () => {
    expect(buildPoolCreateBody(SEASON, 'auction', 120, '5')).toEqual({ season_id: SEASON, draft_type: 'auction', budget: 120 });
  });

  it('budget: budget plus the default price when one is filled in', () => {
    expect(buildPoolCreateBody(SEASON, 'budget', 180, '5')).toEqual({
      season_id: SEASON,
      draft_type: 'budget',
      budget: 180,
      default_point_cost: 5,
    });
    expect(buildPoolCreateBody(SEASON, 'budget', 180, '0')).toMatchObject({ default_point_cost: 0 });
  });

  it('budget: an empty default price is left out (the pool keeps no default; unpriced costs 0)', () => {
    expect(buildPoolCreateBody(SEASON, 'budget', 180, '')).not.toHaveProperty('default_point_cost');
    expect(buildPoolCreateBody(SEASON, 'budget', 180, '  ')).not.toHaveProperty('default_point_cost');
  });

  it('every body it builds passes the route schema with budget and price intact', () => {
    for (const body of [
      buildPoolCreateBody(SEASON, 'snake', 100, ''),
      buildPoolCreateBody(SEASON, 'auction', 100, ''),
      buildPoolCreateBody(SEASON, 'budget', 180, '7'),
    ]) {
      expect(draftPoolCreateSchema.parse(body)).toEqual(body);
    }
  });
});

const field = (value: string, badInput = false): NumberFieldState => ({ value, badInput });

describe('buildPoolCreateBody (point-buy seasons)', () => {
  it('never sends a default price for a point-buy season', () => {
    expect(buildPoolCreateBody(SEASON, 'budget', 180, '5', { pointBuy: true })).toEqual({
      season_id: SEASON,
      draft_type: 'budget',
      budget: 180,
    });
  });
});

describe('validatePoolBudget', () => {
  it('accepts whole numbers from 1 to LEGACY_POINTS_MAX', () => {
    for (const v of ['1', '180', String(LEGACY_POINTS_MAX)]) expect(validatePoolBudget(field(v))).toBeNull();
  });

  it.each(['', '  ', '0', '-1', '1.5', String(LEGACY_POINTS_MAX + 1), 'abc'])('rejects %j', (v) => {
    expect(validatePoolBudget(field(v))).toBe('budgetInvalid');
  });

  it('rejects text the browser could not parse (badInput), even though value reads empty', () => {
    expect(validatePoolBudget(field('', true))).toBe('budgetInvalid');
  });
});

describe('validateDefaultPrice', () => {
  it('empty means no default', () => {
    expect(validateDefaultPrice(field(''), 180)).toBeNull();
    expect(validateDefaultPrice(field('   '), 180)).toBeNull();
  });

  it('badInput is an error, not "empty"', () => {
    expect(validateDefaultPrice(field('', true), 180)).toBe('priceInvalid');
  });

  it('accepts whole numbers from 0 up to the budget', () => {
    expect(validateDefaultPrice(field('0'), 180)).toBeNull();
    expect(validateDefaultPrice(field('180'), 180)).toBeNull();
    expect(validateDefaultPrice(field(String(LEGACY_POINTS_MAX)), null)).toBeNull();
  });

  it.each(['-1', '2.5', String(LEGACY_POINTS_MAX + 1), 'x'])('rejects %j', (v) => {
    expect(validateDefaultPrice(field(v), null)).toBe('priceInvalid');
  });

  it('a price above the budget is an error', () => {
    expect(validateDefaultPrice(field('181'), 180)).toBe('priceAboveBudget');
  });
});

describe('validatePoolCreateForm', () => {
  const form = (draftType: 'snake' | 'auction' | 'budget', budget: string, price: string, pointBuy = false) =>
    validatePoolCreateForm({ draftType, budget: field(budget), defaultPrice: field(price), pointBuy });

  it('snake checks nothing (no budget or price fields)', () => {
    expect(form('snake', 'abc', 'abc')).toEqual({ budget: null, defaultPrice: null, valid: true });
  });

  it('auction checks the budget only', () => {
    expect(form('auction', '0', 'abc')).toEqual({ budget: 'budgetInvalid', defaultPrice: null, valid: false });
    expect(form('auction', '120', 'abc').valid).toBe(true);
  });

  it('budget checks both, and the price against the budget', () => {
    expect(form('budget', '180', '')).toEqual({ budget: null, defaultPrice: null, valid: true });
    expect(form('budget', '180', '200')).toEqual({ budget: null, defaultPrice: 'priceAboveBudget', valid: false });
    expect(form('budget', '', '5')).toEqual({ budget: 'budgetInvalid', defaultPrice: null, valid: false });
  });

  it('a point-buy season never checks the (hidden) default price', () => {
    expect(form('budget', '180', '200', true)).toEqual({ budget: null, defaultPrice: null, valid: true });
  });

  it('every valid form builds a body the route schema accepts', () => {
    for (const [type, budget, price] of [
      ['budget', '1', '1'],
      ['budget', String(LEGACY_POINTS_MAX), String(LEGACY_POINTS_MAX)],
      ['budget', '180', '0'],
      ['auction', '1', ''],
    ] as const) {
      expect(form(type, budget, price).valid).toBe(true);
      const body = buildPoolCreateBody(SEASON, type, Number(budget), price);
      expect(draftPoolCreateSchema.safeParse(body).success).toBe(true);
    }
  });
});

describe('defaultPriceForVisibility (stale default-price state)', () => {
  it('resets the price once its field is hidden, so a stale badInput cannot block Create later', () => {
    // budget -> snake -> budget with unparsable text left in the (now unmounted) input.
    let price = field('', true);
    price = defaultPriceForVisibility(price, showsDefaultPriceField('snake'));
    expect(price).toEqual(EMPTY_NUMBER_FIELD);
    price = defaultPriceForVisibility(price, showsDefaultPriceField('budget'));
    expect(validatePoolCreateForm({ draftType: 'budget', budget: field('180'), defaultPrice: price })).toEqual({
      budget: null,
      defaultPrice: null,
      valid: true,
    });
  });

  it('resets when hidden by the draft type or by a point-buy season alike, keeps it while shown', () => {
    expect(defaultPriceForVisibility(field('7'), showsDefaultPriceField('auction'))).toEqual(EMPTY_NUMBER_FIELD);
    expect(defaultPriceForVisibility(field('7'), showsDefaultPriceField('budget', true))).toEqual(EMPTY_NUMBER_FIELD);
    expect(defaultPriceForVisibility(field('7'), showsDefaultPriceField('budget'))).toEqual(field('7'));
  });

  it('a hidden price field is never validated, whatever its state', () => {
    for (const type of ['snake', 'auction'] as const) {
      const form = validatePoolCreateForm({ draftType: type, budget: field('180'), defaultPrice: field('', true) });
      expect(form.valid).toBe(true);
    }
  });
});

describe('PoolBudgetFields ids (two pool managers on one page)', () => {
  const fields = () =>
    createElement(PoolBudgetFields, {
      budget: field('0'),
      onBudgetChange: () => {},
      budgetError: 'budget error',
      showsDefaultPrice: true,
      defaultPrice: field('x'),
      onDefaultPriceChange: () => {},
      defaultPriceError: 'price error',
    });

  it('poolFieldIds derives every id from its base', () => {
    const a = Object.values(poolFieldIds('a'));
    const b = Object.values(poolFieldIds('b'));
    expect(new Set([...a, ...b]).size).toBe(a.length + b.length);
  });

  it('two instances in one tree render distinct ids, each wired to its own label, hint and errors', () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, fields(), fields()));
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(ids.length);
    const fors = [...html.matchAll(/ for="([^"]+)"/g)].map((m) => m[1]);
    const described = [...html.matchAll(/ aria-describedby="([^"]+)"/g)].flatMap((m) => m[1].split(' '));
    expect(fors).toHaveLength(4);
    expect(described).toHaveLength(6);
    for (const ref of [...fors, ...described]) expect(ids).toContain(ref);
    // No two labels or descriptions point at the same element across the instances.
    expect(new Set(fors).size).toBe(4);
    expect(new Set(described).size).toBe(6);
  });
});

describe('pick order in the create body', () => {
  it('sends the chosen order with any pricing but auction', () => {
    expect(buildPoolCreateBody(SEASON, 'budget', 100, '', { pickOrder: 'snake' })).toEqual({
      season_id: SEASON,
      draft_type: 'budget',
      pick_order: 'snake',
      budget: 100,
    });
    expect(buildPoolCreateBody(SEASON, 'snake', 100, '', { pickOrder: 'linear' })).toMatchObject({ pick_order: 'linear' });
  });

  it('an auction always runs in free order', () => {
    expect(effectivePickOrder('auction', 'snake')).toBe('free');
    expect(effectivePickOrder('auction', 'linear')).toBe('free');
    expect(buildPoolCreateBody(SEASON, 'auction', 100, '', { pickOrder: 'linear' })).toMatchObject({ pick_order: 'free' });
  });

  it('omits the order when none is given (the route derives it)', () => {
    expect(buildPoolCreateBody(SEASON, 'budget', 100, '')).not.toHaveProperty('pick_order');
  });
});
