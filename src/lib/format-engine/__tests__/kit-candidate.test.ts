import { describe, expect, it } from 'vitest';
import { isKitCandidate } from '../kit-candidate';

describe('isKitCandidate', () => {
  const phase = { id: 't-1', season_id: 's-1', season_format_type: 'custom' as const };

  it('is a phase of a custom league', () => {
    expect(isKitCandidate(phase)).toBe(true);
  });

  it('is not a standalone tournament, nor a phase of another league type', () => {
    expect(isKitCandidate({ ...phase, season_id: null })).toBe(false);
    expect(isKitCandidate({ ...phase, season_format_type: null })).toBe(false);
    expect(isKitCandidate({ ...phase, season_format_type: 'swiss' as never })).toBe(false);
  });
});
