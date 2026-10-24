import { describe, expect, it, vi } from 'vitest';
import type { Player } from '@/types/player';
import { PLAYER_SORT_COLUMNS } from '@/lib/players/player-sort';
import {
  DEFAULT_ROSTER_PAGE_SIZE,
  ROSTER_MAX_PAGE,
  buildRosterSearch,
  lastPage,
  localDateTimeToIso,
  openDialog,
  parseRosterUrl,
  roleConfirmKind,
  rosterQuery,
  revealNotice,
  rosterView,
  type RosterUrlState,
} from '../roster-helpers';

describe('localDateTimeToIso', () => {
  it('reads a datetime-local value as wall-clock time in the browser zone and sends the instant', () => {
    const expected = new Date(2099, 0, 15, 14, 30).toISOString();

    expect(localDateTimeToIso('2099-01-15T14:30')).toBe(expected);
  });

  it('always carries an explicit offset the server schema accepts', () => {
    expect(localDateTimeToIso('2099-06-01T08:00')).toMatch(/Z$|[+-]\d{2}:\d{2}$/);
  });

  it('accepts seconds', () => {
    expect(localDateTimeToIso('2099-01-15T14:30:45')).toBe(new Date(2099, 0, 15, 14, 30, 45).toISOString());
  });

  it.each(['', '2099-01-15', 'tomorrow', '2099-13-45T99:99', '2099-01-15T14:30Z'])(
    'returns null for %j',
    (value) => {
      expect(localDateTimeToIso(value)).toBeNull();
    },
  );
});

describe('openDialog', () => {
  const target = { id: 'p-1', name: 'Ash' } as Player;

  it('opens exactly the dialog the action names', () => {
    expect(openDialog(target, 'ban')).toBe('ban');
    expect(openDialog(target, 'suspend')).toBe('suspend');
  });

  it('opens nothing without a target', () => {
    expect(openDialog(null, 'ban')).toBeNull();
  });
});

describe('rosterQuery', () => {
  it('turns a 1-based page into an offset', () => {
    expect(rosterQuery({ page: 3, perPage: 50, search: '' })).toBe('limit=50&offset=100');
  });

  it('adds a trimmed search and encodes it', () => {
    expect(rosterQuery({ page: 1, perPage: 20, search: '  a&b c ' })).toBe('limit=20&offset=0&search=a%26b+c');
  });

  it('never sends a negative offset', () => {
    expect(rosterQuery({ page: 0, perPage: 20, search: '' })).toBe('limit=20&offset=0');
  });
});

describe('rosterQuery sorting', () => {
  it('adds the sort column and direction of the table header state', () => {
    expect(rosterQuery({ page: 1, perPage: 50, search: '', sort: { key: 'ps_username', direction: 'desc' } })).toBe(
      'limit=50&offset=0&sort=ps_username&dir=desc',
    );
  });

  it('keeps the search next to the sort and sends every orderable column', () => {
    for (const key of PLAYER_SORT_COLUMNS) {
      const query = new URLSearchParams(
        rosterQuery({ page: 2, perPage: 20, search: 'ash', sort: { key, direction: 'asc' } }),
      );
      expect(query.get('sort')).toBe(key);
      expect(query.get('dir')).toBe('asc');
      expect(query.get('search')).toBe('ash');
      expect(query.get('offset')).toBe('20');
    }
  });

  it('leaves the default order to the server without a sort', () => {
    expect(rosterQuery({ page: 1, perPage: 50, search: '', sort: null })).toBe('limit=50&offset=0');
  });

  it('never sends a column the API does not order by', () => {
    expect(rosterQuery({ page: 1, perPage: 50, search: '', sort: { key: 'actions', direction: 'asc' } })).toBe(
      'limit=50&offset=0',
    );
  });
});

describe('lastPage', () => {
  it('rounds up and is at least 1', () => {
    expect(lastPage(101, 50)).toBe(3);
    expect(lastPage(100, 50)).toBe(2);
    expect(lastPage(0, 50)).toBe(1);
  });
});

const params = (query: string) => new URLSearchParams(query);

describe('parseRosterUrl', () => {
  it('reads the defaults from an empty query string', () => {
    expect(parseRosterUrl(params(''))).toEqual({
      q: '',
      sort: null,
      page: 1,
      perPage: DEFAULT_ROSTER_PAGE_SIZE,
    });
  });

  it('reads every parameter', () => {
    expect(parseRosterUrl(params('q=ash&sort=ps_username&dir=desc&page=3&perPage=100'))).toEqual({
      q: 'ash',
      sort: { key: 'ps_username', direction: 'desc' },
      page: 3,
      perPage: 100,
    });
  });

  it('clips a search longer than 100 characters', () => {
    expect(parseRosterUrl(params(`q=${'a'.repeat(150)}`)).q).toHaveLength(100);
  });

  it('ignores a sort column the API does not order by, and its direction', () => {
    expect(parseRosterUrl(params('sort=password&dir=desc')).sort).toBeNull();
    expect(parseRosterUrl(params('sort=actions')).sort).toBeNull();
  });

  it('ignores a direction without a sort and falls back to ascending for a bad one', () => {
    expect(parseRosterUrl(params('dir=desc')).sort).toBeNull();
    expect(parseRosterUrl(params('sort=status&dir=sideways')).sort).toEqual({ key: 'status', direction: 'asc' });
    expect(parseRosterUrl(params('sort=status')).sort).toEqual({ key: 'status', direction: 'asc' });
  });

  it.each(['0', '-2', '1.5', 'abc', '', '2abc', '1e3', String(ROSTER_MAX_PAGE + 1), '99999999999'])(
    'falls back to page 1 for page=%j',
    (page) => {
      expect(parseRosterUrl(params(`page=${page}`)).page).toBe(1);
    },
  );

  it('accepts the last page the URL may name', () => {
    expect(parseRosterUrl(params(`page=${ROSTER_MAX_PAGE}`)).page).toBe(ROSTER_MAX_PAGE);
  });

  it.each(['25', '0', '200', 'many', ''])('falls back to the default page size for perPage=%j', (perPage) => {
    expect(parseRosterUrl(params(`perPage=${perPage}`)).perPage).toBe(DEFAULT_ROSTER_PAGE_SIZE);
  });

  it('accepts each page size of the table', () => {
    for (const size of [20, 50, 100]) {
      expect(parseRosterUrl(params(`perPage=${size}`)).perPage).toBe(size);
    }
  });
});

describe('buildRosterSearch', () => {
  const defaults: RosterUrlState = { q: '', sort: null, page: 1, perPage: DEFAULT_ROSTER_PAGE_SIZE };

  it('leaves every default out', () => {
    expect(buildRosterSearch(defaults)).toBe('');
    expect(buildRosterSearch({ ...defaults, q: '   ' })).toBe('');
  });

  it('writes only what differs from the defaults', () => {
    expect(buildRosterSearch({ ...defaults, page: 2 })).toBe('page=2');
    expect(buildRosterSearch({ ...defaults, perPage: 20 })).toBe('perPage=20');
    expect(buildRosterSearch({ ...defaults, q: 'a b' })).toBe('q=a+b');
    expect(buildRosterSearch({ ...defaults, sort: { key: 'name', direction: 'desc' } })).toBe('sort=name&dir=desc');
  });

  it('round-trips a full state through parseRosterUrl', () => {
    const state: RosterUrlState = {
      q: 'ash & co',
      sort: { key: 'discord_id', direction: 'asc' },
      page: 4,
      perPage: 100,
    };
    expect(parseRosterUrl(params(buildRosterSearch(state)))).toEqual(state);
  });

  it('round-trips the defaults', () => {
    expect(parseRosterUrl(params(buildRosterSearch(defaults)))).toEqual(defaults);
  });

  it('never writes a sort column the API does not order by', () => {
    expect(buildRosterSearch({ ...defaults, sort: { key: 'actions', direction: 'asc' } })).toBe('');
  });
});

describe('rosterView', () => {
  it('shows the loading line until the first request settles', () => {
    expect(rosterView({ loaded: false, hasLoadedOnce: false, hasLoadError: false })).toBe('loading');
    // A retry after a failed first load goes back to loading.
    expect(rosterView({ loaded: false, hasLoadedOnce: false, hasLoadError: true })).toBe('loading');
  });

  it('blocks when the first load failed, so an empty roster is never claimed', () => {
    expect(rosterView({ loaded: true, hasLoadedOnce: false, hasLoadError: true })).toBe('blocked');
  });

  it('keeps the table when a refresh fails after rows arrived', () => {
    expect(rosterView({ loaded: true, hasLoadedOnce: true, hasLoadError: true })).toBe('table');
  });

  it('shows the table after a successful load', () => {
    expect(rosterView({ loaded: true, hasLoadedOnce: true, hasLoadError: false })).toBe('table');
  });
});

describe('roleConfirmKind', () => {
  it('asks to grant a role the player lacks and to revoke one they hold', () => {
    expect(roleConfirmKind({ is_admin: false, is_creator: false }, 'is_admin')).toBe('makeAdmin');
    expect(roleConfirmKind({ is_admin: true, is_creator: false }, 'is_admin')).toBe('removeAdmin');
    expect(roleConfirmKind({ is_admin: false, is_creator: false }, 'is_creator')).toBe('makeCreator');
    expect(roleConfirmKind({ is_admin: false, is_creator: true }, 'is_creator')).toBe('removeCreator');
  });

  it('reads only the flag of the field it is asked about', () => {
    expect(roleConfirmKind({ is_admin: true, is_creator: false }, 'is_creator')).toBe('makeCreator');
    expect(roleConfirmKind({ is_admin: false, is_creator: true }, 'is_admin')).toBe('makeAdmin');
  });
});

describe('revealNotice', () => {
  it('scrolls the notice into view without jumping the page', () => {
    const scrollIntoView = vi.fn();

    revealNotice({ scrollIntoView });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
  });

  it('tolerates a missing node and an environment without scrollIntoView', () => {
    expect(() => revealNotice(null)).not.toThrow();
    expect(() => revealNotice({})).not.toThrow();
  });
});
