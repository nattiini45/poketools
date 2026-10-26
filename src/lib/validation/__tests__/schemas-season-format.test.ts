/**
 * The league type (`seasons.format_type`) in the create and update schemas: the four classic values stay
 * accepted, an unknown value stays rejected, and both schemas share the one enum.
 */
import { describe, expect, it } from 'vitest';
import { seasonCreateSchema, seasonFormatTypeSchema, seasonUpdateSchema } from '../schemas';

const CLASSIC = ['singles', 'doubles', 'draft', 'evolution_point_buy'] as const;
const ALL = [...CLASSIC, 'custom'] as const;

describe('seasonFormatTypeSchema', () => {
  it.each(ALL)('accepts %s', (value) => {
    expect(seasonFormatTypeSchema.safeParse(value).success).toBe(true);
  });

  it.each(['', 'Singles', 'standard', 'Custom', 'custom ', 'unknown_format'])('rejects %j', (value) => {
    expect(seasonFormatTypeSchema.safeParse(value).success).toBe(false);
  });

  it.each([null, undefined, 1, {}, ['singles']])('rejects the non-string %j', (value) => {
    expect(seasonFormatTypeSchema.safeParse(value).success).toBe(false);
  });
});

describe('seasonCreateSchema / seasonUpdateSchema (format_type)', () => {
  it.each(ALL)('create parses %s', (format_type) => {
    const parsed = seasonCreateSchema.safeParse({ name: 'League', format_type });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.format_type).toBe(format_type);
  });

  it.each(ALL)('update parses %s', (format_type) => {
    const parsed = seasonUpdateSchema.safeParse({ format_type });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.format_type).toBe(format_type);
  });

  it('create rejects an unknown value and a missing one', () => {
    expect(seasonCreateSchema.safeParse({ name: 'League', format_type: 'bogus' }).success).toBe(false);
    expect(seasonCreateSchema.safeParse({ name: 'League' }).success).toBe(false);
  });

  it('update rejects an unknown value and accepts an absent one', () => {
    expect(seasonUpdateSchema.safeParse({ format_type: 'bogus' }).success).toBe(false);
    expect(seasonUpdateSchema.safeParse({}).success).toBe(true);
  });
});
