import { describe, expect, it } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  STANDALONE_LOCKED_FIELDS,
  assertStandaloneSettingsEditable,
  changesStandaloneLockedField,
  isTournamentStarted,
  tournamentLockReason,
} from '../standalone-lock';

const before = {
  bracket_type: 'swiss' as const,
  ruleset_id: '00000000-0000-4000-8000-000000000001',
  is_doubles: false,
};

const OTHER_RULESET = '00000000-0000-4000-8000-000000000002';

function codeOf(fn: () => void): { code?: string; status: number } {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(UserFacingError);
    const e = error as UserFacingError;
    return { code: e.code, status: e.statusCode };
  }
  throw new Error('expected a UserFacingError');
}

describe('isTournamentStarted', () => {
  it('is false for an upcoming tournament without rounds', () => {
    expect(isTournamentStarted({ status: 'upcoming', rounds_total: 0 })).toBe(false);
  });

  it('is true once a round exists', () => {
    expect(isTournamentStarted({ status: 'upcoming', rounds_total: 1 })).toBe(true);
  });

  it.each(['active', 'completed'] as const)('is true when %s', (status) => {
    expect(isTournamentStarted({ status, rounds_total: 0 })).toBe(true);
  });
});

describe('STANDALONE_LOCKED_FIELDS', () => {
  it('names the three locked fields', () => {
    expect([...STANDALONE_LOCKED_FIELDS]).toEqual(['bracket_type', 'ruleset_id', 'is_doubles']);
  });
});

describe('changesStandaloneLockedField', () => {
  it('is true only for a field whose value differs', () => {
    expect(changesStandaloneLockedField(before, { bracket_type: 'single_elim' })).toBe(true);
    expect(changesStandaloneLockedField(before, { ruleset_id: OTHER_RULESET })).toBe(true);
    expect(changesStandaloneLockedField(before, { is_doubles: true })).toBe(true);
  });

  it('is false for resent stored values and an empty body', () => {
    expect(changesStandaloneLockedField(before, { ...before })).toBe(false);
    expect(changesStandaloneLockedField(before, {})).toBe(false);
  });
});

describe('assertStandaloneSettingsEditable', () => {
  it.each([
    [{ bracket_type: 'single_elim' as const }, 'tournament_bracket_locked'],
    [{ ruleset_id: OTHER_RULESET }, 'tournament_ruleset_locked'],
    [{ is_doubles: true }, 'tournament_doubles_locked'],
  ])('refuses a changed field once started (%j)', (body, code) => {
    expect(codeOf(() => assertStandaloneSettingsEditable(before, body, true))).toEqual({ code, status: 400 });
  });

  it('allows the same changes before the start', () => {
    expect(() =>
      assertStandaloneSettingsEditable(
        before,
        { bracket_type: 'single_elim', ruleset_id: OTHER_RULESET, is_doubles: true },
        false
      )
    ).not.toThrow();
  });

  it('allows resending the stored values once started', () => {
    expect(() => assertStandaloneSettingsEditable(before, { ...before }, true)).not.toThrow();
  });

  it('never throws for keys outside the locked fields', () => {
    expect(() =>
      assertStandaloneSettingsEditable(before, { name: 'Renamed', best_of_default: 5 } as never, true)
    ).not.toThrow();
  });
});

describe('tournamentLockReason', () => {
  it('is "started" once the tournament left upcoming, with or without rounds', () => {
    expect(tournamentLockReason({ status: 'active', rounds_total: 0 })).toBe('started');
    expect(tournamentLockReason({ status: 'active', rounds_total: 3 })).toBe('started');
    expect(tournamentLockReason({ status: 'completed', rounds_total: 3 })).toBe('started');
  });

  it('is "rounds" for an upcoming tournament that already has a generated round', () => {
    expect(tournamentLockReason({ status: 'upcoming', rounds_total: 1 })).toBe('rounds');
  });

  it('is null while nothing is frozen, and agrees with isTournamentStarted', () => {
    expect(tournamentLockReason({ status: 'upcoming', rounds_total: 0 })).toBeNull();
    for (const status of ['upcoming', 'active', 'completed'] as const) {
      for (const rounds_total of [0, 2]) {
        const signals = { status, rounds_total };
        expect(tournamentLockReason(signals) !== null).toBe(isTournamentStarted(signals));
      }
    }
  });
});
