import { describe, expect, it } from 'vitest';
import { createRatingScope, matchCountsForRatings } from '@/lib/rating/rating-scope';

describe('native rating scope admission', () => {
  it('does not interpret a legacy-only scope as permission to count native test leagues', () => {
    expect(() => matchCountsForRatings({ phase_id: 'phase' }, createRatingScope([]))).toThrow('Phase rating scope is missing');
  });

  it('uses the native test-league set independently of tournament ids', () => {
    const scope = { testSeasonTournamentIds: new Set(['normal-phase']), testSeasonPhaseIds: new Set(['test-phase']) };
    expect(matchCountsForRatings({ phase_id: 'test-phase' }, scope)).toBe(false);
    expect(matchCountsForRatings({ phase_id: 'normal-phase' }, scope)).toBe(true);
  });
});
