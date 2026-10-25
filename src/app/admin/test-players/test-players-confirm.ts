/**
 * Which Test Players actions ask first, and what the dialog says.
 *
 * Pure so the wiring is testable without a DOM: the console asks
 * `confirmationFor` when a button is clicked and stores the answer as the
 * pending confirmation; the shared ConfirmDialog shows `confirmCopy` of it.
 *
 * Asked first: every action that resets, removes, deletes or replaces data or
 * credentials. One click: Create / Repair (only upserts the standard players),
 * Refresh, and Mint Login on a player who has no login yet (it creates one and
 * replaces nothing).
 */
import type { Translator } from '@/i18n/core';
import type en from '@/i18n/messages/admin-test-players/en';
import type { Player } from '@/types/player';
import type { PlayerActionKey } from './test-players-text';

type TestPlayersTranslator = Translator<typeof en>;

/** An action waiting for the admin's yes; carries everything the dialog names. */
export type PendingConfirmation =
  | { kind: PlayerActionKey; player: Player }
  | { kind: 'remove_from_league'; player: Player; season: string }
  | { kind: 'delete_test_matches'; season: string };

export interface ConfirmCopy {
  title: string;
  message: string;
  confirmLabel: string;
}

/** Whether a per-player action destroys or replaces something and so asks first. */
export function playerActionNeedsConfirm(action: PlayerActionKey, player: Pick<Player, 'auth_user_id'>): boolean {
  switch (action) {
    case 'reset':
    case 'clear_login':
      return true;
    case 'mint_login':
      // Minting for a player with a login replaces its password.
      return Boolean(player.auth_user_id);
  }
}

/** The confirmation a per-player button click opens, or null when it runs at once. */
export function confirmationFor(action: PlayerActionKey, player: Player): PendingConfirmation | null {
  return playerActionNeedsConfirm(action, player) ? { kind: action, player } : null;
}

export function confirmCopy(t: TestPlayersTranslator, pending: PendingConfirmation): ConfirmCopy {
  switch (pending.kind) {
    case 'reset':
      return {
        title: t('confirm.reset.title'),
        message: t('confirm.reset.message', { name: pending.player.name }),
        confirmLabel: t('confirm.reset.confirm'),
      };
    case 'mint_login':
      return {
        title: t('confirm.replaceLogin.title'),
        message: t('confirm.replaceLogin.message', { name: pending.player.name }),
        confirmLabel: t('confirm.replaceLogin.confirm'),
      };
    case 'clear_login':
      return {
        title: t('confirm.clearLogin.title'),
        message: t('confirm.clearLogin.message', { name: pending.player.name }),
        confirmLabel: t('confirm.clearLogin.confirm'),
      };
    case 'remove_from_league':
      return {
        title: t('confirm.removeFromSeason.title'),
        message: t('confirm.removeFromSeason.message', { name: pending.player.name, season: pending.season }),
        confirmLabel: t('confirm.removeFromSeason.confirm'),
      };
    case 'delete_test_matches':
      return {
        title: t('confirm.deleteMatches.title'),
        message: t('confirm.deleteMatches.message', { season: pending.season }),
        confirmLabel: t('confirm.deleteMatches.confirm'),
      };
  }
}
