import { describe, expect, it } from 'vitest';
import { roundUpdateSchema } from '../schemas';

describe('roundUpdateSchema deadline', () => {
  it.each([
    ['a UTC instant', '2026-11-01T18:00:00.000Z'],
    ['an instant with a positive offset', '2026-11-01T19:00:00+01:00'],
    ['an instant with a negative offset', '2026-11-01T13:00:00-05:00'],
  ])('accepts %s', (_label, deadline) => {
    expect(roundUpdateSchema.safeParse({ deadline })).toMatchObject({ success: true, data: { deadline } });
  });

  it('accepts null, which clears the deadline', () => {
    expect(roundUpdateSchema.safeParse({ deadline: null })).toMatchObject({
      success: true,
      data: { deadline: null },
    });
  });

  it('accepts a deadline in the past (an admin may backfill one)', () => {
    expect(roundUpdateSchema.safeParse({ deadline: '2020-01-01T00:00:00Z' }).success).toBe(true);
  });

  it.each([
    ['a calendar date', '2026-11-01'],
    ['a time without an offset', '2026-11-01T18:00:00'],
    ['free text', 'tomorrow'],
    ['an empty string', ''],
    ['a number', 1_792_000_000_000],
    ['an impossible date', '2026-13-45T00:00:00Z'],
  ])('rejects %s', (_label, deadline) => {
    expect(roundUpdateSchema.safeParse({ deadline }).success).toBe(false);
  });

  it('trims the value before it is checked', () => {
    expect(roundUpdateSchema.safeParse({ deadline: ' 2026-11-01T18:00:00Z ' })).toMatchObject({
      success: true,
      data: { deadline: '2026-11-01T18:00:00Z' },
    });
  });

  it('counts a deadline of null as a change on its own', () => {
    expect(roundUpdateSchema.safeParse({ deadline: null }).success).toBe(true);
    expect(roundUpdateSchema.safeParse({}).success).toBe(false);
  });

  describe('force completion', () => {
    it('accepts force with a reason on a completion, and trims the reason', () => {
      expect(roundUpdateSchema.safeParse({ status: 'completed', force: true, reason: '  Opponent left  ' })).toMatchObject({
        success: true,
        data: { status: 'completed', force: true, reason: 'Opponent left' },
      });
    });

    it.each([
      ['no reason', { status: 'completed', force: true }],
      ['an empty reason', { status: 'completed', force: true, reason: '' }],
      ['a whitespace-only reason', { status: 'completed', force: true, reason: '   ' }],
      ['an over-long reason', { status: 'completed', force: true, reason: 'x'.repeat(501) }],
    ])('rejects force with %s', (_label, body) => {
      expect(roundUpdateSchema.safeParse(body).success).toBe(false);
    });

    it('rejects force on any other status, or without one', () => {
      expect(roundUpdateSchema.safeParse({ status: 'active', force: true, reason: 'x' }).success).toBe(false);
      expect(roundUpdateSchema.safeParse({ force: true, reason: 'x', deadline: null }).success).toBe(false);
    });

    it('leaves a plain completion, and force: false, as they were', () => {
      expect(roundUpdateSchema.safeParse({ status: 'completed' }).success).toBe(true);
      expect(roundUpdateSchema.safeParse({ status: 'completed', force: false }).success).toBe(true);
    });
  });

  it('keeps accepting status and best_of alone, and still bounds them', () => {
    expect(roundUpdateSchema.safeParse({ status: 'active' }).success).toBe(true);
    expect(roundUpdateSchema.safeParse({ best_of: 3 }).success).toBe(true);
    expect(roundUpdateSchema.safeParse({ best_of: 99 }).success).toBe(false);
    expect(roundUpdateSchema.safeParse({ status: 'late' }).success).toBe(false);
  });
});
