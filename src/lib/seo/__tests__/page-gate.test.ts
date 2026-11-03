import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageGate, type PageLookups } from '../page-gate';

const ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const HEADERS = new Headers({ 'x-forwarded-for': '203.0.113.7' });

function lookups(over: Partial<PageLookups> = {}): PageLookups {
  return {
    shareLinkIsLive: vi.fn().mockResolvedValue(true),
    libraryEntryIsPublished: vi.fn().mockResolvedValue(true),
    leagueExists: vi.fn().mockResolvedValue(true),
    tournamentExists: vi.fn().mockResolvedValue(true),
    chargeShareLink: vi.fn().mockResolvedValue({ allowed: true }),
    ...over,
  };
}

function noReads(l: PageLookups) {
  for (const read of Object.values(l)) expect(read).not.toHaveBeenCalled();
}

const NOT_FOUND = { status: 'not_found', shareLimit: null };
const PASS = { status: null, shareLimit: null };

afterEach(() => vi.restoreAllMocks());

describe('pageGate', () => {
  it('ignores every other path without a read', async () => {
    const l = lookups();
    for (const path of [
      '/', '/teams/library', '/teams/shared', `/teams/shared/${ID}/extra`, '/teams/other/x', '/leagues', '/tournaments',
      '/leagues/x/y', '/wiki', '/wiki/tera/nope', '/pokemon', '/players/nope', '/api/teams/shared/nope',
    ]) {
      expect(await pageGate(path, HEADERS, l), path).toEqual(PASS);
    }
    noReads(l);
  });

  describe('team pages', () => {
    it('lets a live share link through and reports its charge', async () => {
      const l = lookups();
      expect(await pageGate(`/teams/shared/${ID}`, HEADERS, l)).toEqual({ status: null, shareLimit: { allowed: true } });
      expect(l.shareLinkIsLive).toHaveBeenCalledWith(ID);
    });

    it('answers not found for a disabled or unknown share link, charging it once', async () => {
      const l = lookups({ shareLinkIsLive: vi.fn().mockResolvedValue(false) });
      expect(await pageGate(`/teams/shared/${ID}`, HEADERS, l)).toEqual({ status: 'not_found', shareLimit: { allowed: true } });
      expect(l.chargeShareLink).toHaveBeenCalledTimes(1);
    });

    it('checks a library entry the same way, without charging the share allowance', async () => {
      const l = lookups();
      expect(await pageGate(`/teams/library/${ID}/`, HEADERS, l)).toEqual(PASS);
      expect(
        await pageGate(`/teams/library/${ID}`, HEADERS, lookups({ libraryEntryIsPublished: vi.fn().mockResolvedValue(false) })),
      ).toEqual(NOT_FOUND);
      expect(l.chargeShareLink).not.toHaveBeenCalled();
    });
  });

  describe('the common team-shared allowance', () => {
    it('charges the caller once per share link request and passes the caller\'s headers', async () => {
      const l = lookups();
      await pageGate(`/teams/shared/${ID}`, HEADERS, l);
      expect(l.chargeShareLink).toHaveBeenCalledTimes(1);
      expect(l.chargeShareLink).toHaveBeenCalledWith(HEADERS);
    });

    it('reads nothing for a share link once the allowance is spent, and says so', async () => {
      const l = lookups({ chargeShareLink: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 41 }) });
      expect(await pageGate(`/teams/shared/${ID}`, HEADERS, l)).toEqual({
        status: null,
        shareLimit: { allowed: false, retryAfterSeconds: 41 },
      });
      expect(l.shareLinkIsLive).not.toHaveBeenCalled();
    });

    it('counts a malformed share token, which the page would never see, and still answers 404', async () => {
      for (const path of ['/teams/shared/not-a-token', '/teams/shared/%E0%A4%A']) {
        const l = lookups();
        expect(await pageGate(path, HEADERS, l), path).toEqual({ status: 'not_found', shareLimit: { allowed: true } });
        expect(l.chargeShareLink, path).toHaveBeenCalledTimes(1);
        expect(l.shareLinkIsLive, path).not.toHaveBeenCalled();
      }
    });

    it('answers the spent allowance before the malformed token', async () => {
      const l = lookups({ chargeShareLink: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 3 }) });
      expect(await pageGate('/teams/shared/nope', HEADERS, l)).toEqual({
        status: null,
        shareLimit: { allowed: false, retryAfterSeconds: 3 },
      });
    });

    it('keeps the charge when the existence read fails after it, so the page does not charge again', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const l = lookups({ shareLinkIsLive: vi.fn().mockRejectedValue(new Error('db down')) });
      expect(await pageGate(`/teams/shared/${ID}`, HEADERS, l)).toEqual({ status: null, shareLimit: { allowed: true } });
    });

    it('reports no charge when the charge itself fails, and a malformed link is still a 404', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const l = lookups({ chargeShareLink: vi.fn().mockRejectedValue(new Error('limiter down')) });
      expect(await pageGate(`/teams/shared/${ID}`, HEADERS, l)).toEqual(PASS);
      expect(await pageGate('/teams/shared/nope', HEADERS, l)).toEqual(NOT_FOUND);
    });
  });

  describe('leagues and tournaments', () => {
    it('checks the league or tournament by id', async () => {
      const l = lookups();
      expect(await pageGate(`/leagues/${ID}`, HEADERS, l)).toEqual(PASS);
      expect(await pageGate(`/tournaments/${ID}`, HEADERS, l)).toEqual(PASS);
      expect(l.leagueExists).toHaveBeenCalledWith(ID);
      expect(l.tournamentExists).toHaveBeenCalledWith(ID);
      expect(l.chargeShareLink).not.toHaveBeenCalled();
    });

    it('answers not found for a row that does not exist', async () => {
      expect(await pageGate(`/leagues/${ID}`, HEADERS, lookups({ leagueExists: vi.fn().mockResolvedValue(false) }))).toEqual(NOT_FOUND);
      expect(await pageGate(`/tournaments/${ID}`, HEADERS, lookups({ tournamentExists: vi.fn().mockResolvedValue(false) }))).toEqual(NOT_FOUND);
    });
  });

  it('answers not found for a malformed library, league or tournament id without a read', async () => {
    const l = lookups();
    for (const path of ['/teams/library/nope', '/leagues/nope', '/tournaments/1']) {
      expect(await pageGate(path, HEADERS, l), path).toEqual(NOT_FOUND);
    }
    noReads(l);
  });

  it('answers not found for an unknown species or wiki name without a read', async () => {
    const l = lookups();
    expect(await pageGate('/pokemon/not-a-real-pokemon', HEADERS, l)).toEqual(NOT_FOUND);
    expect(await pageGate('/pokemon/Mega-not-a-real-pokemon', HEADERS, l)).toEqual(NOT_FOUND);
    expect(await pageGate('/wiki/moves/not-a-move', HEADERS, l)).toEqual(NOT_FOUND);
    expect(await pageGate('/pokemon/Garchomp', HEADERS, l)).toEqual(PASS);
    expect(await pageGate('/wiki/moves/Earthquake', HEADERS, l)).toEqual(PASS);
    noReads(l);
  });

  it('lets the page decide when a read fails, and logs the cause', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('db down');
    const l = lookups({ leagueExists: vi.fn().mockRejectedValue(failure) });
    expect(await pageGate(`/leagues/${ID}`, HEADERS, l)).toEqual(PASS);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[page-gate]'), failure);
  });
});
