import { describe, expect, it } from 'vitest';
import { expectNoPrivatePlayerData, fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';
import { ltext } from '@/lib/studio-core/ltext';
import type { Json } from '@/types/database';
import { counterpartyIdOf, toNotificationView, type NotificationLookups, type StoredNotification } from '../views';

const SEASON = 's-1';
const row = (over: Partial<StoredNotification>): StoredNotification => ({
  id: 'n-1',
  season_id: SEASON,
  kind: 'challenge_created',
  payload: { role: 'defender', counterparty_id: 'p-2' },
  created_at: '2026-11-08T10:00:00.000Z',
  read_at: null,
  ...over,
});
const lookups: NotificationLookups = {
  leagues: new Map([[SEASON, 'Winter Cup']]),
  names: new Map([[SEASON, new Map([['p-2', 'Mara']])]]),
};

describe('toNotificationView', () => {
  it('names the other player of a challenge and links to the play page', () => {
    expect(toNotificationView(row({}), lookups)).toEqual({
      id: 'n-1',
      kind: 'challenge_created',
      created_at: '2026-11-08T10:00:00.000Z',
      read: false,
      league: { id: SEASON, name: 'Winter Cup' },
      href: `/dashboard/leagues/${SEASON}/play`,
      side: 'defender',
      counterparty: { id: 'p-2', name: 'Mara' },
    });
  });

  it('shows somebody who no longer takes part as a former player, in that league only', () => {
    const elsewhere: NotificationLookups = { ...lookups, names: new Map([['s-2', new Map([['p-2', 'Mara']])]]) };
    expect(toNotificationView(row({}), elsewhere)).toMatchObject({ counterparty: { id: 'p-2', name: null } });
  });

  it('marks a read row', () => {
    expect(toNotificationView(row({ read_at: '2026-11-08T11:00:00.000Z' }), lookups)).toMatchObject({ read: true });
  });

  it('hands a rule notice over with the text of the format and nothing else', () => {
    const message = ltext('en', 'The pool is open.', 'Der Pool ist offen.');
    const view = toNotificationView(row({ kind: 'rule_notice', payload: { message } as unknown as Json }), lookups);
    expect(view).toMatchObject({ kind: 'rule_notice', message });
    expect(view).not.toHaveProperty('counterparty');
  });

  it('copies named fields only: a private column in the payload never reaches the browser', () => {
    const full = fullPlayerRow({ id: 'p-2' });
    const payload = { role: 'defender', counterparty_id: 'p-2', player: full, ...full } as unknown as Json;
    const view = toNotificationView(row({ payload }), lookups);
    expectNoPrivatePlayerData(JSON.stringify(view));
    expect(view).not.toHaveProperty('payload');
  });

  it.each([
    ['an unknown kind', { kind: 'something_new' }],
    ['a payload that is no object', { payload: 'x' }],
    ['a challenge without the other player', { payload: { role: 'defender' } }],
    ['a challenge without a side', { payload: { counterparty_id: 'p-2' } }],
    ['a notice without text', { kind: 'rule_notice', payload: { message: { base: 'en' } } }],
    ['a notice with an unknown base', { kind: 'rule_notice', payload: { message: { base: 'fr', fr: { v: 'x' } } } }],
  ] as [string, Partial<StoredNotification>][])('returns null for %s', (_label, over) => {
    expect(toNotificationView(row(over), lookups)).toBeNull();
  });
});

describe('counterpartyIdOf', () => {
  it('reads the id of a challenge row and null for a notice', () => {
    expect(counterpartyIdOf(row({}))).toBe('p-2');
    expect(counterpartyIdOf(row({ kind: 'rule_notice', payload: {} }))).toBeNull();
  });
});
