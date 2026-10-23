import { describe, expect, it } from 'vitest';
import type { Player } from '@/types/player';
import { PLAYER_SORT_COLUMNS } from '@/lib/players/player-sort';
import { lastPage, localDateTimeToIso, openDialog, rosterQuery } from '../roster-helpers';

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
