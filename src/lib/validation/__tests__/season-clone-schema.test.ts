import { describe, expect, it } from 'vitest';
import {
  seasonCloneOptionsSchema,
  seasonCreateRequestSchema,
  seasonCreateSchema,
} from '@/lib/validation';

const SOURCE = '11111111-1111-4111-8111-111111111111';

describe('seasonCreateRequestSchema', () => {
  it('keeps clone_from optional: a plain create body parses without it', () => {
    const parsed = seasonCreateRequestSchema.safeParse({ name: 'Spring', format_type: 'singles' });

    expect(parsed.success).toBe(true);
    expect(parsed.success && 'clone_from' in parsed.data).toBe(false);
  });

  it('accepts a bare source id with both flags off', () => {
    const parsed = seasonCreateRequestSchema.safeParse({
      name: 'Spring',
      format_type: 'singles',
      clone_from: { season_id: SOURCE },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.clone_from).toEqual({
      season_id: SOURCE,
      copy_roster: false,
      copy_admins: false,
    });
  });

  it('carries explicit flags through', () => {
    const parsed = seasonCreateRequestSchema.parse({
      name: 'Spring',
      format_type: 'singles',
      clone_from: { season_id: SOURCE, copy_roster: true, copy_admins: true },
    });

    expect(parsed.clone_from).toEqual({ season_id: SOURCE, copy_roster: true, copy_admins: true });
  });

  it('rejects a non-uuid source id, a non-boolean flag and a bare string', () => {
    const base = { name: 'Spring', format_type: 'singles' };

    expect(seasonCreateRequestSchema.safeParse({ ...base, clone_from: { season_id: 'nope' } }).success).toBe(false);
    expect(seasonCreateRequestSchema.safeParse({ ...base, clone_from: {} }).success).toBe(false);
    expect(
      seasonCreateRequestSchema.safeParse({ ...base, clone_from: { season_id: SOURCE, copy_roster: 'yes' } }).success,
    ).toBe(false);
    expect(
      seasonCreateRequestSchema.safeParse({ ...base, clone_from: { season_id: SOURCE, copy_admins: 1 } }).success,
    ).toBe(false);
    expect(seasonCreateRequestSchema.safeParse({ ...base, clone_from: SOURCE }).success).toBe(false);
  });

  it('still validates the create fields', () => {
    expect(seasonCreateRequestSchema.safeParse({ format_type: 'singles', clone_from: { season_id: SOURCE } }).success).toBe(
      false,
    );
  });
});

describe('seasonCloneOptionsSchema', () => {
  it('defaults both flags to false', () => {
    expect(seasonCloneOptionsSchema.parse({ season_id: SOURCE })).toEqual({
      season_id: SOURCE,
      copy_roster: false,
      copy_admins: false,
    });
  });
});

describe('seasonCreateSchema (unchanged)', () => {
  it('parses a body with clone_from but strips the key', () => {
    const parsed = seasonCreateSchema.parse({
      name: 'Spring',
      format_type: 'singles',
      clone_from: { season_id: SOURCE, copy_roster: true },
    });

    expect(parsed).toEqual({ name: 'Spring', format_type: 'singles' });
    expect('clone_from' in parsed).toBe(false);
  });
});
