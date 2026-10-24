import { describe, expect, it } from 'vitest';
import {
  BEST_OF_MAX,
  BEST_OF_MIN,
  BEST_OF_VALUES,
  bestOfChoices,
  isValidBestOf,
  newEvenBestOfIssues,
} from '../best-of';

describe('BEST_OF_VALUES', () => {
  it('is exactly the odd numbers 1 to 15', () => {
    expect(BEST_OF_VALUES).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
    expect(BEST_OF_VALUES[0]).toBe(BEST_OF_MIN);
    expect(BEST_OF_VALUES[BEST_OF_VALUES.length - 1]).toBe(BEST_OF_MAX);
  });
});

describe('isValidBestOf', () => {
  it.each([1, 3, 5, 15])('accepts %s', (value) => {
    expect(isValidBestOf(value)).toBe(true);
  });

  it.each([0, 2, 4, 14, 16, 17, -1, -3, 1.5, 3.0001, '3', null, undefined, NaN])(
    'rejects %s',
    (value) => {
      expect(isValidBestOf(value)).toBe(false);
    }
  );
});

describe('bestOfChoices', () => {
  it('offers the odd values when nothing is stored', () => {
    expect(bestOfChoices()).toEqual([...BEST_OF_VALUES]);
    expect(bestOfChoices(null)).toEqual([...BEST_OF_VALUES]);
  });

  it('adds nothing for a stored value that is already offered', () => {
    expect(bestOfChoices(3)).toEqual([...BEST_OF_VALUES]);
  });

  it('merges a stored legacy even value in sorted position', () => {
    expect(bestOfChoices(4)).toEqual([1, 3, 4, 5, 7, 9, 11, 13, 15]);
    expect(bestOfChoices(14)).toEqual([1, 3, 5, 7, 9, 11, 13, 14, 15]);
  });

  it('does not merge values outside 1 to 15 or non-integers', () => {
    expect(bestOfChoices(0)).toEqual([...BEST_OF_VALUES]);
    expect(bestOfChoices(16)).toEqual([...BEST_OF_VALUES]);
    expect(bestOfChoices(2.5)).toEqual([...BEST_OF_VALUES]);
  });

  it('does not mutate the shared list', () => {
    bestOfChoices(4);
    expect(BEST_OF_VALUES).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
  });
});

describe('newEvenBestOfIssues', () => {
  it('passes odd values and an empty update', () => {
    expect(newEvenBestOfIssues({}, { best_of_default: 3 })).toEqual([]);
    expect(newEvenBestOfIssues({ best_of_default: 5, bo_overrides: { '1': 7 } }, { best_of_default: 2 })).toEqual([]);
  });

  it('passes an even value the record already holds', () => {
    expect(
      newEvenBestOfIssues(
        { best_of_default: 2, bo_overrides: { '1': 4 } },
        { best_of_default: 2, bo_overrides: { '1': 4 } },
      ),
    ).toEqual([]);
  });

  it('refuses an even default that differs from the stored one', () => {
    expect(newEvenBestOfIssues({ best_of_default: 4 }, { best_of_default: 2 })).toEqual([
      'best_of_default: best of must be an odd number',
    ]);
    expect(newEvenBestOfIssues({ best_of_default: 2 }, { best_of_default: 3 })).toHaveLength(1);
  });

  it('refuses a new even override, or one stored under another key', () => {
    expect(newEvenBestOfIssues({ bo_overrides: { '2': 4 } }, { bo_overrides: { '1': 4 } })).toEqual([
      'bo_overrides.2: best of must be an odd number',
    ]);
    expect(newEvenBestOfIssues({ bo_overrides: { '1': 6 } }, { bo_overrides: null })).toHaveLength(1);
  });
});
