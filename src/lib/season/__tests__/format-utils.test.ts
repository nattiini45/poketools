import { describe, it, expect } from 'vitest';

import { isDraftLike, isEvolutionPointBuy, isLeagueDoubles, assertEpbSeason, leagueDraftHref } from '../format-utils';
import { UserFacingError } from '@/lib/api/user-facing-error';

describe('leagueDraftHref', () => {
  it('sends Evolution Point Buy to the draft arena', () => {
    expect(leagueDraftHref('s1', 'evolution_point_buy')).toBe('/leagues/s1/draft-room');
  });

  it('sends the plain draft format to the draft page, never the EPB-only arena', () => {
    expect(leagueDraftHref('s1', 'draft')).toBe('/leagues/s1/draft');
  });

  it.each(['singles', 'doubles', '', 'unknown_format'])('has no draft page for %j', (format) => {
    expect(leagueDraftHref('s1', format)).toBeNull();
  });
});

describe('isDraftLike', () => {
  it('is true for draft and evolution_point_buy', () => {
    expect(isDraftLike('draft')).toBe(true);
    expect(isDraftLike('evolution_point_buy')).toBe(true);
  });

  it('is false for singles/doubles', () => {
    expect(isDraftLike('singles')).toBe(false);
    expect(isDraftLike('doubles')).toBe(false);
  });
});

describe('isEvolutionPointBuy', () => {
  it('matches only the exact identifier', () => {
    expect(isEvolutionPointBuy('evolution_point_buy')).toBe(true);
    expect(isEvolutionPointBuy('draft')).toBe(false);
    expect(isEvolutionPointBuy('')).toBe(false);
  });
});

describe('assertEpbSeason (format gate)', () => {
  it('passes for evolution_point_buy seasons', () => {
    expect(() => assertEpbSeason({ format_type: 'evolution_point_buy' })).not.toThrow();
  });

  it('throws 404 UserFacingError for missing seasons', () => {
    try {
      assertEpbSeason(null);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UserFacingError);
      expect((err as UserFacingError).statusCode).toBe(404);
      expect((err as UserFacingError).code).toBe('season_not_found');
    }
  });

  it.each(['singles', 'doubles', 'draft'] as const)(
    'throws 400 format_mismatch for %s seasons (legacy leagues stay untouched)',
    (format) => {
      try {
        assertEpbSeason({ format_type: format });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(UserFacingError);
        expect((err as UserFacingError).statusCode).toBe(400);
        expect((err as UserFacingError).code).toBe('format_mismatch');
      }
    }
  );
});

describe('draft gate over every league type', () => {
  const MATRIX = [
    { format: 'singles', draftLike: false, href: null },
    { format: 'doubles', draftLike: false, href: null },
    { format: 'draft', draftLike: true, href: '/leagues/s1/draft' },
    { format: 'evolution_point_buy', draftLike: true, href: '/leagues/s1/draft-room' },
    { format: 'custom', draftLike: false, href: null },
  ] as const;

  it.each(MATRIX)('$format: isDraftLike $draftLike, draft page $href', ({ format, draftLike, href }) => {
    expect(isDraftLike(format)).toBe(draftLike);
    expect(leagueDraftHref('s1', format)).toBe(href);
    expect(isEvolutionPointBuy(format)).toBe(format === 'evolution_point_buy');
  });
});

describe('assertEpbSeason (custom)', () => {
  it('throws 400 format_mismatch for a custom league', () => {
    try {
      assertEpbSeason({ format_type: 'custom' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as UserFacingError).statusCode).toBe(400);
      expect((err as UserFacingError).code).toBe('format_mismatch');
    }
  });
});

describe('isLeagueDoubles', () => {
  const doubles = { is_doubles: true };
  const singles = { is_doubles: false };

  it.each([
    ['singles', false],
    ['draft', false],
    ['evolution_point_buy', false],
    ['doubles', true],
  ] as const)('%s follows the league type, whatever its stages say', (format, expected) => {
    expect(isLeagueDoubles(format, [])).toBe(expected);
    expect(isLeagueDoubles(format, [doubles, doubles])).toBe(expected);
    expect(isLeagueDoubles(format, [singles])).toBe(expected);
  });

  it('custom is doubles only when it has stages and every stage is doubles', () => {
    expect(isLeagueDoubles('custom', [])).toBe(false);
    expect(isLeagueDoubles('custom', [singles])).toBe(false);
    expect(isLeagueDoubles('custom', [doubles, singles])).toBe(false);
    expect(isLeagueDoubles('custom', [doubles])).toBe(true);
    expect(isLeagueDoubles('custom', [doubles, doubles])).toBe(true);
  });
});

