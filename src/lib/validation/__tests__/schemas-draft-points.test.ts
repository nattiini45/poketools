import { describe, it, expect } from 'vitest';
import { LEGACY_POINTS_MAX } from '@/lib/draft/points-limits';
import {
  draftPoolCreateSchema,
  draftPoolEntryCreateSchema,
  draftPoolEntryUpdateSchema,
  draftPoolTemplateCreateSchema,
} from '../schemas';

const U1 = '11111111-1111-4111-8111-111111111111';

/** Legacy prices share the bid bound, so no accepted price is out of reach of an accepted bid. */
describe('legacy point_cost bound', () => {
  const create = (point_cost: unknown) =>
    draftPoolEntryCreateSchema.safeParse({ season_id: U1, pokemon_name: 'Ralts', point_cost }).success;
  const update = (point_cost: unknown) => draftPoolEntryUpdateSchema.safeParse({ point_cost }).success;
  const template = (point_cost: unknown) =>
    draftPoolTemplateCreateSchema.safeParse({
      name: 'Pool',
      pool_mode: 'point_buy',
      entries: [{ pokemon_name: 'Ralts', point_cost }],
    }).success;

  it.each([
    ['pool entry create', create],
    ['pool entry update', update],
    ['pool template entry', template],
  ])('%s: 0..LEGACY_POINTS_MAX integers or null', (_name, accepts) => {
    expect(accepts(0)).toBe(true);
    expect(accepts(null)).toBe(true);
    expect(accepts(undefined)).toBe(true);
    expect(accepts(LEGACY_POINTS_MAX)).toBe(true);
    expect(accepts(LEGACY_POINTS_MAX + 1)).toBe(false);
    expect(accepts(-1)).toBe(false);
    expect(accepts(1.5)).toBe(false);
  });
});

/** A pool default price only means something for budget drafts; elsewhere it is refused, not stored. */
describe('draftPoolCreateSchema default_point_cost by draft_type', () => {
  const parse = (draft_type: string, default_point_cost: unknown, budget: number | undefined = 180) =>
    draftPoolCreateSchema.safeParse({ season_id: U1, draft_type, budget, default_point_cost });

  it('accepts a default price on a budget draft', () => {
    expect(parse('budget', 5).success).toBe(true);
    expect(parse('budget', 0).success).toBe(true);
  });

  it.each(['snake', 'auction'])('refuses a non-null default price for draft_type %s (issue on default_point_cost)', (type) => {
    for (const price of [0, 5]) {
      const result = parse(type, price);
      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual([
        expect.objectContaining({
          path: ['default_point_cost'],
          message: `only budget drafts take a default price (got draft_type ${type})`,
        }),
      ]);
    }
    // Without a budget too: the refusal does not depend on the budget comparison. (A body without
    // the key, since `parse`'s default would turn an explicit undefined back into 180.)
    const noBudget = draftPoolCreateSchema.safeParse({ season_id: U1, draft_type: type, default_point_cost: 5 });
    expect(noBudget.success).toBe(false);
    expect(noBudget.error?.issues).toEqual([
      expect.objectContaining({
        path: ['default_point_cost'],
        message: `only budget drafts take a default price (got draft_type ${type})`,
      }),
    ]);
  });

  it.each(['snake', 'auction', 'budget'])('accepts a null or omitted default price for draft_type %s', (type) => {
    expect(parse(type, null).success).toBe(true);
    expect(parse(type, undefined).success).toBe(true);
  });
});
