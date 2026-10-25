import { describe, it, expect } from 'vitest';
import {
  confirmMatchSchema,
  gameDeleteSchema,
  matchHistoryQuerySchema,
  matchReopenSchema,
  matchResetSchema,
  matchScheduleSchema,
  reasonSchema,
} from '../index';

describe('reasonSchema', () => {
  it('trims the reason', () => {
    expect(reasonSchema.parse('  wrong winner  ')).toBe('wrong winner');
  });

  it('rejects a reason that is empty after trimming', () => {
    expect(reasonSchema.safeParse('').success).toBe(false);
    expect(reasonSchema.safeParse('   \n ').success).toBe(false);
  });

  it('accepts 500 characters and rejects 501', () => {
    expect(reasonSchema.safeParse('a'.repeat(500)).success).toBe(true);
    expect(reasonSchema.safeParse('a'.repeat(501)).success).toBe(false);
  });
});

describe('confirmMatchSchema reason', () => {
  it('accepts a reason with action dispute and trims it', () => {
    const parsed = confirmMatchSchema.parse({ action: 'dispute', reason: '  score was 2-1  ' });
    expect(parsed.reason).toBe('score was 2-1');
  });

  it('rejects a reason with action confirm, explicit or defaulted', () => {
    const explicit = confirmMatchSchema.safeParse({ action: 'confirm', reason: 'nope' });
    expect(explicit.success).toBe(false);
    expect(confirmMatchSchema.safeParse({ reason: 'nope' }).success).toBe(false);
  });

  it('keeps accepting bodies without a reason', () => {
    expect(confirmMatchSchema.safeParse({}).success).toBe(true);
    expect(confirmMatchSchema.safeParse({ action: 'dispute' }).success).toBe(true);
  });

  it('rejects a blank or over-long dispute reason', () => {
    expect(confirmMatchSchema.safeParse({ action: 'dispute', reason: '  ' }).success).toBe(false);
    expect(confirmMatchSchema.safeParse({ action: 'dispute', reason: 'a'.repeat(501) }).success).toBe(false);
  });
});

describe('matchScheduleSchema', () => {
  it('accepts a Z instant, an offset instant and null', () => {
    expect(matchScheduleSchema.parse({ scheduled_at: '2026-10-24T10:00:00Z' }).scheduled_at).toBe(
      '2026-10-24T10:00:00Z'
    );
    expect(matchScheduleSchema.parse({ scheduled_at: '2026-10-24T10:00:00+02:00' }).scheduled_at).toBe(
      '2026-10-24T10:00:00+02:00'
    );
    expect(matchScheduleSchema.parse({ scheduled_at: null }).scheduled_at).toBeNull();
  });

  it('rejects a local time without an offset', () => {
    expect(matchScheduleSchema.safeParse({ scheduled_at: '2026-10-24T10:00' }).success).toBe(false);
    expect(matchScheduleSchema.safeParse({ scheduled_at: '2026-10-24T10:00:00' }).success).toBe(false);
  });

  it('rejects instants before 2000 and from 2100 on', () => {
    expect(matchScheduleSchema.safeParse({ scheduled_at: '1999-12-31T23:59:59Z' }).success).toBe(false);
    expect(matchScheduleSchema.safeParse({ scheduled_at: '2100-01-01T00:00:00Z' }).success).toBe(false);
    expect(matchScheduleSchema.safeParse({ scheduled_at: '2000-01-01T00:00:00Z' }).success).toBe(true);
    expect(matchScheduleSchema.safeParse({ scheduled_at: '2099-12-31T23:59:59Z' }).success).toBe(true);
  });

  it('requires the field and refuses other types', () => {
    expect(matchScheduleSchema.safeParse({}).success).toBe(false);
    expect(matchScheduleSchema.safeParse({ scheduled_at: 12345 }).success).toBe(false);
    expect(matchScheduleSchema.safeParse({ scheduled_at: '' }).success).toBe(false);
  });
});

describe('matchReopenSchema', () => {
  it('requires a non-empty reason', () => {
    expect(matchReopenSchema.safeParse({}).success).toBe(false);
    expect(matchReopenSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(matchReopenSchema.parse({ reason: ' typo in winner ' })).toEqual({ reason: 'typo in winner' });
  });
});

describe('matchResetSchema', () => {
  it('keeps accepting an empty body and the cascade flag', () => {
    expect(matchResetSchema.parse({})).toEqual({});
    expect(matchResetSchema.parse({ cascade: true })).toEqual({ cascade: true });
  });

  it('takes an optional trimmed reason and refuses a blank one', () => {
    expect(matchResetSchema.parse({ cascade: false, reason: ' dup ' })).toEqual({ cascade: false, reason: 'dup' });
    expect(matchResetSchema.safeParse({ reason: '   ' }).success).toBe(false);
  });
});

describe('gameDeleteSchema', () => {
  it('accepts an empty body or a reason', () => {
    expect(gameDeleteSchema.parse({})).toEqual({});
    expect(gameDeleteSchema.parse({ reason: ' wrong replay ' })).toEqual({ reason: 'wrong replay' });
  });

  it('refuses a blank or over-long reason', () => {
    expect(gameDeleteSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(gameDeleteSchema.safeParse({ reason: 'a'.repeat(501) }).success).toBe(false);
  });
});

describe('matchHistoryQuerySchema', () => {
  it('defaults to the first page of 20', () => {
    expect(matchHistoryQuerySchema.parse({})).toEqual({ offset: 0, limit: 20 });
  });

  it('coerces query strings', () => {
    expect(matchHistoryQuerySchema.parse({ offset: '40', limit: '10' })).toEqual({ offset: 40, limit: 10 });
  });

  it('enforces the bounds', () => {
    expect(matchHistoryQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
    expect(matchHistoryQuerySchema.safeParse({ offset: '1001' }).success).toBe(false);
    expect(matchHistoryQuerySchema.safeParse({ offset: '1000' }).success).toBe(true);
    expect(matchHistoryQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(matchHistoryQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(matchHistoryQuerySchema.safeParse({ limit: '50' }).success).toBe(true);
    expect(matchHistoryQuerySchema.safeParse({ limit: '1.5' }).success).toBe(false);
  });
});
