import { describe, expect, it } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  assertFormatChangeAllowed,
  assertSeasonDateRange,
  editableFormatTypes,
  formatChangeLock,
  isSeasonDateRangeValid,
  isRulesetPinLocked,
  isSeasonStarted,
  type SeasonStartSignals,
} from '../settings-guards';

const upcomingPhase = { status: 'upcoming' as const, rounds_total: 0 };

function signals(overrides: Partial<SeasonStartSignals> = {}): SeasonStartSignals {
  return { status: 'upcoming', phases: [], ...overrides };
}

function thrown(fn: () => void): UserFacingError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(UserFacingError);
    return error as UserFacingError;
  }
  throw new Error('expected a UserFacingError');
}

describe('isRulesetPinLocked', () => {
  const running = signals({ status: 'active' });

  it('locks a started league that has a ruleset, by every start signal', () => {
    expect(isRulesetPinLocked('rs-1', running)).toBe(true);
    expect(isRulesetPinLocked('rs-1', signals({ status: 'completed' }))).toBe(true);
    expect(isRulesetPinLocked('rs-1', signals({ phases: [{ status: 'active', rounds_total: 0 }] }))).toBe(true);
    expect(isRulesetPinLocked('rs-1', signals({ phases: [{ status: 'upcoming', rounds_total: 2 }] }))).toBe(true);
  });

  it('leaves a league that has not started editable', () => {
    expect(isRulesetPinLocked('rs-1', signals())).toBe(false);
    expect(isRulesetPinLocked('rs-1', signals({ phases: [upcomingPhase] }))).toBe(false);
  });

  it('leaves a started league without a ruleset editable: the server still lets it get its first one', () => {
    expect(isRulesetPinLocked(null, running)).toBe(false);
  });
});

describe('isSeasonStarted', () => {
  it('is false for an upcoming league without phases', () => {
    expect(isSeasonStarted(signals())).toBe(false);
  });

  it('is false for an upcoming league whose phases are upcoming without rounds', () => {
    expect(isSeasonStarted(signals({ phases: [upcomingPhase, upcomingPhase] }))).toBe(false);
  });

  it.each(['active', 'completed'] as const)('is true for a %s league', (status) => {
    expect(isSeasonStarted(signals({ status }))).toBe(true);
  });

  it.each(['active', 'completed'] as const)('is true when a phase is %s', (status) => {
    expect(isSeasonStarted(signals({ phases: [upcomingPhase, { status, rounds_total: 0 }] }))).toBe(true);
  });

  it('is true when an upcoming phase already has a round (a running league flipped back to upcoming)', () => {
    expect(isSeasonStarted(signals({ phases: [{ status: 'upcoming', rounds_total: 1 }] }))).toBe(true);
  });
});

describe('formatChangeLock', () => {
  it('reports the point-buy lock first, started or not', () => {
    expect(formatChangeLock('evolution_point_buy', signals())).toBe('point_buy');
    expect(formatChangeLock('evolution_point_buy', signals({ status: 'active' }))).toBe('point_buy');
  });

  it('reports started for a started classic league', () => {
    expect(formatChangeLock('singles', signals({ status: 'active' }))).toBe('started');
  });

  it('is null for a classic league that has not started', () => {
    expect(formatChangeLock('draft', signals({ phases: [upcomingPhase] }))).toBeNull();
  });
});

describe('editableFormatTypes', () => {
  it('offers the three classic types for a classic league', () => {
    expect(editableFormatTypes('singles')).toEqual(['singles', 'doubles', 'draft']);
    expect(editableFormatTypes('draft')).toEqual(['singles', 'doubles', 'draft']);
  });

  it('offers only point buy for a point-buy league', () => {
    expect(editableFormatTypes('evolution_point_buy')).toEqual(['evolution_point_buy']);
  });
});

describe('assertFormatChangeAllowed', () => {
  it('allows resending the stored type, even once started', () => {
    expect(() => assertFormatChangeAllowed('singles', 'singles', signals({ status: 'active' }))).not.toThrow();
    expect(() =>
      assertFormatChangeAllowed('evolution_point_buy', 'evolution_point_buy', signals({ status: 'completed' }))
    ).not.toThrow();
  });

  it('allows a change between classic types before the league started', () => {
    expect(() => assertFormatChangeAllowed('singles', 'doubles', signals({ phases: [upcomingPhase] }))).not.toThrow();
  });

  it('refuses a change after the start with 409 SEASON_FORMAT_LOCKED', () => {
    const error = thrown(() => assertFormatChangeAllowed('singles', 'draft', signals({ status: 'active' })));
    expect(error.code).toBe('SEASON_FORMAT_LOCKED');
    expect(error.statusCode).toBe(409);
  });

  it.each([
    ['singles', 'evolution_point_buy'],
    ['evolution_point_buy', 'singles'],
  ] as const)('refuses %s -> %s before the start with 409 SEASON_FORMAT_POINT_BUY_LOCKED', (from, to) => {
    const error = thrown(() => assertFormatChangeAllowed(from, to, signals()));
    expect(error.code).toBe('SEASON_FORMAT_POINT_BUY_LOCKED');
    expect(error.statusCode).toBe(409);
  });
});

describe('season date range', () => {
  it('accepts equal dates and a later end', () => {
    expect(isSeasonDateRangeValid('2026-05-01', '2026-05-01')).toBe(true);
    expect(isSeasonDateRangeValid('2026-05-01', '2026-06-30')).toBe(true);
  });

  it('rejects an end before the start', () => {
    expect(isSeasonDateRangeValid('2026-05-02', '2026-05-01')).toBe(false);
  });

  it.each([
    [null, '2026-05-01'],
    ['2026-05-01', null],
    ['', '2026-05-01'],
    ['2026-05-01', ''],
    [undefined, undefined],
  ])('accepts a missing date (%s, %s)', (start, end) => {
    expect(isSeasonDateRangeValid(start, end)).toBe(true);
  });

  it('throws 400 SEASON_DATES_INVALID for a reversed range and passes a valid one', () => {
    const error = thrown(() => assertSeasonDateRange('2026-05-02', '2026-05-01'));
    expect(error.code).toBe('SEASON_DATES_INVALID');
    expect(error.statusCode).toBe(400);
    expect(() => assertSeasonDateRange('2026-05-01', '2026-05-02')).not.toThrow();
    expect(() => assertSeasonDateRange(null, '2026-05-02')).not.toThrow();
  });
});
