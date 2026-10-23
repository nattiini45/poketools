/**
 * The roster manager takes the league's status and archive flag from the admin
 * page (which already read the season row) instead of fetching
 * `GET /api/seasons/[id]` again on load.
 */
import { describe, expect, it } from 'vitest';
import { isSubstitutionClosed, rosterLoadPaths } from '../LeagueRosterManager';

describe('rosterLoadPaths', () => {
  it('loads roster and phases only: no league row, no preloaded player directory', () => {
    const paths = rosterLoadPaths('season-1');

    expect(paths).toEqual(['/api/seasons/season-1/participants', '/api/seasons/season-1/phases']);
    expect(paths).not.toContain('/api/seasons/season-1');
    // GET /api/players is site-admin only and returns one page: the pickers search instead
    // (see src/lib/players/__tests__/player-search.test.ts).
    expect(paths).not.toContain('/api/players');
  });
});

describe('isSubstitutionClosed (from the leagueState prop)', () => {
  it('closes substitutions for a completed or archived league', () => {
    expect(isSubstitutionClosed({ status: 'completed', archived: false })).toBe(true);
    expect(isSubstitutionClosed({ status: 'active', archived: true })).toBe(true);
    expect(isSubstitutionClosed({ status: 'active', archived: false })).toBe(false);
  });
});
