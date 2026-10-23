/**
 * The admin player picker's client-safe pieces (`GET /api/admin/player-search`):
 * search URL, response parser and the rules that grey a hit out. One copy for
 * the roster, substitute, link and enrolment pickers.
 */
import { describe, expect, it } from 'vitest';
import {
  parsePlayerSearch,
  playerSearchUrl,
  searchTruncation,
  unavailableForAdd,
  unavailableForEnrolment,
  unavailableForLink,
  unavailableForSubstitute,
  type PlayerSearchHit,
} from '../player-search';

const hit = (id: string, isGuest = false): PlayerSearchHit => ({ id, name: `Player ${id}`, is_guest: isGuest });
const ids = (...values: string[]) => new Set(values);

describe('playerSearchUrl', () => {
  it('scopes a league picker with season_id and leaves a {q} slot for the Combobox', () => {
    const url = playerSearchUrl({ seasonId: '0b5f0c5e-6a1c-4e7b-9f55-2d6f4f6b8a10' });

    expect(url).toContain('/api/admin/player-search?');
    expect(url).toContain('season_id=0b5f0c5e-6a1c-4e7b-9f55-2d6f4f6b8a10');
    expect(url).not.toContain('tournament_id');
    expect(url).toContain('limit=20');
    expect(url.endsWith('&q={q}')).toBe(true);
  });

  it('asks for registered accounts only when the picker needs them (guest link)', () => {
    expect(playerSearchUrl({ seasonId: 's1' }, { registeredOnly: true })).toContain('&registered=1&');
    expect(playerSearchUrl({ seasonId: 's1' })).not.toContain('registered');
  });

  it('scopes an enrolment picker with tournament_id only', () => {
    const url = playerSearchUrl({ tournamentId: 't1' });

    expect(url).toContain('tournament_id=t1');
    expect(url).not.toContain('season_id');
    expect(url.endsWith('&q={q}')).toBe(true);
  });

  it('survives a query with reserved characters once the Combobox fills the slot', () => {
    const filled = playerSearchUrl({ seasonId: 's1' }).replace('{q}', encodeURIComponent('a&b=c d 50% #1'));
    const params = new URL(filled, 'http://localhost').searchParams;

    expect(params.get('q')).toBe('a&b=c d 50% #1');
    expect(params.get('season_id')).toBe('s1');
    expect(params.get('limit')).toBe('20');
  });
});

describe('parsePlayerSearch', () => {
  it('reads hits and the total of a success', () => {
    expect(
      parsePlayerSearch({
        success: true,
        data: [
          { id: 'p1', name: 'Mara', is_guest: false },
          { id: 'p2', name: 'Maro', is_guest: true },
        ],
        total: 63,
      }),
    ).toEqual({
      ok: true,
      hits: [
        { id: 'p1', name: 'Mara', is_guest: false },
        { id: 'p2', name: 'Maro', is_guest: true },
      ],
      total: 63,
    });
  });

  it('falls back to the hit count when the body carries no total', () => {
    expect(parsePlayerSearch({ success: true, data: [{ id: 'p1', name: 'Mara' }] })).toEqual({
      ok: true,
      hits: [{ id: 'p1', name: 'Mara', is_guest: false }],
      total: 1,
    });
  });

  it('keeps only id, name and is_guest of a hit and drops malformed rows', () => {
    const outcome = parsePlayerSearch({
      success: true,
      data: [{ id: 'p1', name: 'Mara', discord_id: 'SECRET', status: 'banned' }, { id: 7 }, null, 'x'],
    });

    expect(outcome).toEqual({ ok: true, hits: [{ id: 'p1', name: 'Mara', is_guest: false }], total: 1 });
    expect(JSON.stringify(outcome)).not.toContain('SECRET');
    expect(JSON.stringify(outcome)).not.toContain('banned');
  });

  it('turns a refusal into an error that keeps its code, not an empty list', () => {
    expect(
      parsePlayerSearch({ success: false, error: 'Admin access required for this resource', code: 'forbidden' }),
    ).toEqual({
      ok: false,
      error: { error: 'Admin access required for this resource', code: 'forbidden' },
    });
  });

  it('treats a body that is neither a success nor an error as a failure', () => {
    expect(parsePlayerSearch(null).ok).toBe(false);
    expect(parsePlayerSearch(undefined).ok).toBe(false);
    expect(parsePlayerSearch({ success: true }).ok).toBe(false);
    expect(parsePlayerSearch({ success: true, data: 'nope' }).ok).toBe(false);
    expect(parsePlayerSearch('<html>502</html>').ok).toBe(false);
  });
});

describe('searchTruncation', () => {
  it('reports shown and total when the page holds fewer hits than matches', () => {
    expect(searchTruncation({ ok: true, hits: [hit('a'), hit('b')], total: 63 })).toEqual({ shown: 2, total: 63 });
  });

  it('is null when the page holds every match', () => {
    expect(searchTruncation({ ok: true, hits: [hit('a')], total: 1 })).toBeNull();
    expect(searchTruncation({ ok: true, hits: [], total: 0 })).toBeNull();
  });
});

describe('unavailableForAdd', () => {
  it('greys out players already on the roster, then those already staged', () => {
    expect(unavailableForAdd(hit('a'), ids('a'), ids())).toBe('onRoster');
    expect(unavailableForAdd(hit('b'), ids('a'), ids('b'))).toBe('selected');
    expect(unavailableForAdd(hit('a'), ids('a'), ids('a'))).toBe('onRoster');
  });

  it('offers everyone else, guests included', () => {
    expect(unavailableForAdd(hit('c'), ids('a'), ids('b'))).toBeNull();
    expect(unavailableForAdd(hit('g', true), ids(), ids())).toBeNull();
  });
});

describe('unavailableForSubstitute', () => {
  it('never offers the player being replaced', () => {
    expect(unavailableForSubstitute(hit('out'), 'out', ids('out'), ids())).toBe('outgoing');
  });

  it('greys out roster players: a replacement comes from outside the roster', () => {
    expect(unavailableForSubstitute(hit('a'), 'out', ids('a', 'out'), ids())).toBe('onRoster');
  });

  it('greys out players already enrolled in the phase being substituted in', () => {
    expect(unavailableForSubstitute(hit('p'), 'out', ids('out'), ids('p'))).toBe('inPhase');
  });

  it('offers a player outside the roster and the phase', () => {
    expect(unavailableForSubstitute(hit('n'), 'out', ids('out'), ids('p'))).toBeNull();
  });

  it('offers everyone outside the roster while no player is being replaced yet', () => {
    expect(unavailableForSubstitute(hit('n'), undefined, ids(), ids())).toBeNull();
  });
});

describe('unavailableForLink', () => {
  it('rejects other guests and the guest itself', () => {
    expect(unavailableForLink(hit('x', true), 'g')).toBe('guest');
    expect(unavailableForLink(hit('g'), 'g')).toBe('guest');
  });

  it('offers a non-guest account', () => {
    expect(unavailableForLink(hit('acc'), 'g')).toBeNull();
  });
});

describe('unavailableForEnrolment', () => {
  it('greys out players already enrolled', () => {
    expect(unavailableForEnrolment(hit('a'), ids('a'))).toBe('enrolled');
  });

  it('offers players not enrolled yet', () => {
    expect(unavailableForEnrolment(hit('b'), ids('a'))).toBeNull();
  });
});
