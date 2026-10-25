/**
 * The confirmations of the destructive Test Players actions: which actions ask
 * first, what the dialog says (English and German, naming the player and the
 * season), and that the shared ConfirmDialog gets that text.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from '@/i18n/core';
import { adminTestPlayersMessages } from '@/i18n/messages/admin-test-players';
import type { Player } from '@/types/player';

const dialogs = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

vi.mock('@/components/ui/ConfirmDialog', () => ({
  default: (props: Record<string, unknown>) => {
    dialogs.props.push(props);
    return null;
  },
}));

import { TestPlayersConfirmDialog } from '../TestPlayersConsole';
import {
  confirmCopy,
  confirmationFor,
  playerActionNeedsConfirm,
  type PendingConfirmation,
} from '../test-players-confirm';
import type { PlayerActionKey } from '../test-players-text';

const en = createTranslator(adminTestPlayersMessages, 'en');
const de = createTranslator(adminTestPlayersMessages, 'de');

function player(name: string, authUserId: string | null): Player {
  return { id: `id-${name}`, name, ps_username: null, auth_user_id: authUserId } as unknown as Player;
}

const withLogin = player('EvoTest01', 'auth-1');
const withoutLogin = player('EvoTest02', null);
const SEASON = '11111111-1111-4111-8111-111111111111';

describe('playerActionNeedsConfirm', () => {
  it('asks before resetting data and before clearing a login', () => {
    for (const row of [withLogin, withoutLogin]) {
      expect(playerActionNeedsConfirm('reset', row)).toBe(true);
      expect(playerActionNeedsConfirm('clear_login', row)).toBe(true);
    }
  });

  it('asks before minting only when that replaces an existing login', () => {
    expect(playerActionNeedsConfirm('mint_login', withLogin)).toBe(true);
    expect(playerActionNeedsConfirm('mint_login', withoutLogin)).toBe(false);
  });
});

describe('confirmationFor', () => {
  it('returns the pending confirmation for the clicked row', () => {
    expect(confirmationFor('reset', withLogin)).toEqual({ kind: 'reset', player: withLogin });
    expect(confirmationFor('mint_login', withLogin)).toEqual({ kind: 'mint_login', player: withLogin });
  });

  it('returns null when the action runs at once', () => {
    expect(confirmationFor('mint_login', withoutLogin)).toBeNull();
  });
});

describe('confirmCopy', () => {
  const pendings: Array<[string, PendingConfirmation]> = [
    ['reset', { kind: 'reset', player: withLogin }],
    ['replace login', { kind: 'mint_login', player: withLogin }],
    ['clear login', { kind: 'clear_login', player: withLogin }],
    ['remove from season', { kind: 'remove_from_league', player: withLogin, season: SEASON }],
    ['delete matches', { kind: 'delete_test_matches', season: SEASON }],
  ];

  it.each(pendings)('has a title, message and confirm label for %s in both languages', (_label, pending) => {
    for (const t of [en, de]) {
      const copy = confirmCopy(t, pending);
      expect(copy.title).not.toBe('');
      expect(copy.message).not.toBe('');
      expect(copy.confirmLabel).not.toBe('');
      // No unresolved placeholder and no leaked message key.
      expect(copy.message).not.toMatch(/[{}]|confirm\./);
    }
    expect(confirmCopy(en, pending).message).not.toBe(confirmCopy(de, pending).message);
  });

  it('names the player for the player actions', () => {
    for (const kind of ['reset', 'mint_login', 'clear_login'] as PlayerActionKey[]) {
      const pending: PendingConfirmation = { kind, player: withLogin };
      expect(confirmCopy(en, pending).message).toContain('EvoTest01');
      expect(confirmCopy(de, pending).message).toContain('EvoTest01');
    }
  });

  it('names the player and the season for Remove from Season', () => {
    const pending: PendingConfirmation = { kind: 'remove_from_league', player: withLogin, season: SEASON };
    for (const t of [en, de]) {
      const { message } = confirmCopy(t, pending);
      expect(message).toContain('EvoTest01');
      expect(message).toContain(SEASON);
    }
  });

  it('names the season for Delete Test-Only Matches', () => {
    const pending: PendingConfirmation = { kind: 'delete_test_matches', season: SEASON };
    expect(confirmCopy(en, pending).message).toContain(SEASON);
    expect(confirmCopy(de, pending).message).toContain(SEASON);
  });

  it('says in English what is lost and in German with the du form', () => {
    const reset = confirmCopy(en, { kind: 'reset', player: withLogin });
    expect(reset.title).toBe('Reset data?');
    expect(reset.message).toContain('cannot be undone');
    expect(confirmCopy(de, { kind: 'reset', player: withLogin }).title).toBe('Daten zurücksetzen?');
    expect(confirmCopy(en, { kind: 'mint_login', player: withLogin }).title).toBe('Reset login?');
    expect(confirmCopy(de, { kind: 'mint_login', player: withLogin }).title).toBe('Login zurücksetzen?');
  });
});

describe('TestPlayersConfirmDialog', () => {
  function render(copy: Parameters<typeof TestPlayersConfirmDialog>[0]['copy']) {
    dialogs.props.length = 0;
    renderToStaticMarkup(<TestPlayersConfirmDialog copy={copy} onClose={() => {}} onConfirm={() => {}} />);
    return dialogs.props[0];
  }

  it('stays closed while nothing waits', () => {
    expect(render(null).open).toBe(false);
  });

  it('opens the shared ConfirmDialog with the pending text', () => {
    const copy = confirmCopy(de, { kind: 'delete_test_matches', season: SEASON });
    const props = render(copy);
    expect(props.open).toBe(true);
    expect(props.title).toBe(copy.title);
    expect(props.message).toBe(copy.message);
    expect(props.confirmLabel).toBe(copy.confirmLabel);
  });
});
