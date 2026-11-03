import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageNotFoundGate, type PageLookups } from '../page-gate';

const ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const HEADERS = new Headers({ 'x-forwarded-for': '203.0.113.7' });

function lookups(over: Partial<PageLookups> = {}): PageLookups {
  return {
    shareLinkIsLive: vi.fn().mockResolvedValue(true),
    libraryEntryIsPublished: vi.fn().mockResolvedValue(true),
    leagueExists: vi.fn().mockResolvedValue(true),
    tournamentExists: vi.fn().mockResolvedValue(true),
    shareLinkCheckAllowed: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

function noReads(l: PageLookups) {
  for (const read of Object.values(l)) expect(read).not.toHaveBeenCalled();
}

afterEach(() => vi.restoreAllMocks());

describe('pageNotFoundGate', () => {
  it('ignores every other path without a read', async () => {
    const l = lookups();
    for (const path of [
      '/', '/teams/library', '/teams/shared', `/teams/shared/${ID}/extra`, '/teams/other/x', '/leagues', '/tournaments',
      '/leagues/x/y', '/wiki', '/wiki/tera/nope', '/pokemon', '/players/nope', '/api/teams/shared/nope',
    ]) {
      expect(await pageNotFoundGate(path, HEADERS, l), path).toBeNull();
    }
    noReads(l);
  });

  describe('team pages', () => {
    it('lets a live share link through', async () => {
      const l = lookups();
      expect(await pageNotFoundGate(`/teams/shared/${ID}`, HEADERS, l)).toBeNull();
      expect(l.shareLinkIsLive).toHaveBeenCalledWith(ID);
    });

    it('answers not found for a disabled or unknown share link', async () => {
      expect(await pageNotFoundGate(`/teams/shared/${ID}`, HEADERS, lookups({ shareLinkIsLive: vi.fn().mockResolvedValue(false) }))).toBe('not_found');
    });

    it('checks a library entry the same way', async () => {
      expect(await pageNotFoundGate(`/teams/library/${ID}/`, HEADERS, lookups())).toBeNull();
      expect(await pageNotFoundGate(`/teams/library/${ID}`, HEADERS, lookups({ libraryEntryIsPublished: vi.fn().mockResolvedValue(false) }))).toBe('not_found');
    });
  });

  it('reads nothing for a share link once the caller\'s allowance is spent', async () => {
    const l = lookups({ shareLinkCheckAllowed: vi.fn().mockResolvedValue(false) });
    expect(await pageNotFoundGate(`/teams/shared/${ID}`, HEADERS, l)).toBeNull();
    expect(l.shareLinkCheckAllowed).toHaveBeenCalledWith(HEADERS);
    expect(l.shareLinkIsLive).not.toHaveBeenCalled();
  });

  describe('leagues and tournaments', () => {
    it('checks the league or tournament by id', async () => {
      const l = lookups();
      expect(await pageNotFoundGate(`/leagues/${ID}`, HEADERS, l)).toBeNull();
      expect(await pageNotFoundGate(`/tournaments/${ID}`, HEADERS, l)).toBeNull();
      expect(l.leagueExists).toHaveBeenCalledWith(ID);
      expect(l.tournamentExists).toHaveBeenCalledWith(ID);
    });

    it('answers not found for a row that does not exist', async () => {
      expect(await pageNotFoundGate(`/leagues/${ID}`, HEADERS, lookups({ leagueExists: vi.fn().mockResolvedValue(false) }))).toBe('not_found');
      expect(await pageNotFoundGate(`/tournaments/${ID}`, HEADERS, lookups({ tournamentExists: vi.fn().mockResolvedValue(false) }))).toBe('not_found');
    });
  });

  it('answers not found for a malformed id without a read', async () => {
    const l = lookups();
    for (const path of ['/teams/shared/not-a-token', '/teams/shared/%E0%A4%A', '/teams/library/nope', '/leagues/nope', '/tournaments/1']) {
      expect(await pageNotFoundGate(path, HEADERS, l), path).toBe('not_found');
    }
    noReads(l);
  });

  it('answers not found for an unknown species or wiki name without a read', async () => {
    const l = lookups();
    expect(await pageNotFoundGate('/pokemon/not-a-real-pokemon', HEADERS, l)).toBe('not_found');
    expect(await pageNotFoundGate('/wiki/moves/not-a-move', HEADERS, l)).toBe('not_found');
    expect(await pageNotFoundGate('/pokemon/Garchomp', HEADERS, l)).toBeNull();
    expect(await pageNotFoundGate('/wiki/moves/Earthquake', HEADERS, l)).toBeNull();
    noReads(l);
  });

  it('lets the page decide when a read fails, and logs the cause', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('db down');
    const l = lookups({ leagueExists: vi.fn().mockRejectedValue(failure) });
    expect(await pageNotFoundGate(`/leagues/${ID}`, HEADERS, l)).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[page-gate]'), failure);
  });
});