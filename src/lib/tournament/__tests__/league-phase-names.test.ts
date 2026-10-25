import { describe, expect, it } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { assertPhaseNameFree, findDuplicatePhaseName } from '../league-phase';

const phases = [
  { id: 'p1', name: 'Hinrunde' },
  { id: 'p2', name: 'Playoffs' },
];

describe('findDuplicatePhaseName', () => {
  it('finds an exact match', () => {
    expect(findDuplicatePhaseName('Playoffs', phases)).toBe(true);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(findDuplicatePhaseName('  playOFFS ', phases)).toBe(true);
  });

  it('ignores Unicode composition (NFC)', () => {
    const composed = [{ id: 'p1', name: 'Grüppen' }];
    expect(findDuplicatePhaseName('Grüppen', composed)).toBe(true);
  });

  it('does not treat a different name as a duplicate', () => {
    expect(findDuplicatePhaseName('Finale', phases)).toBe(false);
    expect(findDuplicatePhaseName('Play offs', phases)).toBe(false);
  });

  it('skips the phase named by exceptId', () => {
    expect(findDuplicatePhaseName('Playoffs', phases, 'p2')).toBe(false);
    expect(findDuplicatePhaseName('Playoffs', phases, 'p1')).toBe(true);
  });

  it('is false for an empty league', () => {
    expect(findDuplicatePhaseName('Playoffs', [])).toBe(false);
  });
});

describe('assertPhaseNameFree', () => {
  it('passes a free name', () => {
    expect(() => assertPhaseNameFree('Finale', phases)).not.toThrow();
  });

  it('throws 409 PHASE_NAME_TAKEN for a taken name', () => {
    try {
      assertPhaseNameFree(' hinrunde', phases);
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(UserFacingError);
      expect((error as UserFacingError).code).toBe('PHASE_NAME_TAKEN');
      expect((error as UserFacingError).statusCode).toBe(409);
    }
  });

  it('passes the own name when exceptId names the phase', () => {
    expect(() => assertPhaseNameFree('Hinrunde', phases, 'p1')).not.toThrow();
  });
});
