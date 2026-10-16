/**
 * The roster manager takes the league's status and archive flag from the admin
 * page (which already read the season row) instead of fetching
 * `GET /api/seasons/[id]` again on load.
 */
import { describe, expect, it } from 'vitest';
import { isSubstitutionClosed, rosterLoadPaths } from '../LeagueRosterManager';

describe('rosterLoadPaths', () => {
  it('loads roster, players and phases only, never the league row', () => {
    const paths = rosterLoadPaths('season-1');

    expect(paths).toEqual([
      '/api/seasons/season-1/participants',
      '/api/players',
      '/api/seasons/season-1/phases',
    ]);
    expect(paths).not.toContain('/api/seasons/season-1');
  });
});

describe('isSubstitutionClosed (from the leagueState prop)', () => {
  it('closes substitutions for a completed or archived league', () => {
    expect(isSubstitutionClosed({ status: 'completed', archived: false })).toBe(true);
    expect(isSubstitutionClosed({ status: 'active', archived: true })).toBe(true);
    expect(isSubstitutionClosed({ status: 'active', archived: false })).toBe(false);
  });
});
