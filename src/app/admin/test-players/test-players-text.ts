/**
 * Pure text helpers of the Test Players console. The console stores keys and
 * values (never translated text) and turns them into text while rendering, so
 * a language switch re-renders correctly.
 */
import type { ApiErrorLike } from '@/i18n/api-errors';
import type { Translator } from '@/i18n/core';
import type en from '@/i18n/messages/admin-test-players/en';
import type { ApiErrorTextFn } from '@/i18n/use-api-error';

type TestPlayersTranslator = Translator<typeof en>;

export type PlayerActionKey = 'reset' | 'mint_login' | 'clear_login';

/** Message keys a failed request can show (no placeholders). */
export type ErrorKey =
  | 'error.network'
  | 'error.loadFailed'
  | 'error.ensureFailed'
  | 'error.removeFailed'
  | 'error.deleteMatchesFailed'
  | 'error.seasonRequiredRemove'
  | 'error.seasonRequiredDelete'
  | 'error.noPlayers'
  | `error.failed.${PlayerActionKey}`;

/**
 * A failed request: the API body, shown through the error catalogs, or a
 * local message when the body carries neither `error` nor `code` (or the
 * request never got an answer).
 */
export type ConsoleError = { api: ApiErrorLike; fallback: ErrorKey } | { local: ErrorKey };

/** A success message, kept as data until it is rendered. */
export type ConsoleNotice =
  | { kind: 'ensured'; count: number }
  | { kind: 'minted'; name: string }
  | { kind: 'done'; action: PlayerActionKey; name: string }
  | { kind: 'removed'; name: string; season: string }
  | { kind: 'deleted'; count: number; season: string };

export function noticeText(t: TestPlayersTranslator, notice: ConsoleNotice): string {
  switch (notice.kind) {
    case 'ensured':
      return t('notice.ensured', { count: notice.count });
    case 'minted':
      return t('notice.minted', { name: notice.name });
    case 'done':
      return t(`notice.done.${notice.action}`, { name: notice.name });
    case 'removed':
      return t('notice.removed', { name: notice.name, season: notice.season });
    case 'deleted':
      return t('notice.deleted', { count: notice.count, season: notice.season });
  }
}

export function errorText(t: TestPlayersTranslator, apiErrorText: ApiErrorTextFn, error: ConsoleError): string {
  if ('local' in error) return t(error.local);
  return error.api.error || error.api.code ? apiErrorText(error.api) : t(error.fallback);
}
