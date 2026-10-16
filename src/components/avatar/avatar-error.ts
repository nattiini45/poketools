import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { avatarMessages } from '@/i18n/messages/avatar';
import { errorsAi } from '@/i18n/messages/errors/ai';
import { errorsAuth } from '@/i18n/messages/errors/auth';
import { errorsPlayers } from '@/i18n/messages/errors/players';
import type avatarEn from '@/i18n/messages/avatar/en';

/** A panel-local fallback message (`avatarMessages.errors.<key>`). */
export type AvatarErrorKey = keyof (typeof avatarEn)['errors'];

/**
 * What an avatar panel keeps in state for a failed action: the API's error
 * body (or the caught error), plus the panel's own fallback message key. Never
 * translated text, so a language switch re-renders it correctly.
 */
export interface AvatarError {
  api: ApiErrorLike | null;
  fallback: AvatarErrorKey;
}

function hasText(api: ApiErrorLike | null): api is ApiErrorLike {
  return !!api && ((typeof api.error === 'string' && api.error.trim() !== '') || !!api.code);
}

/** A failed `{ success: false, error, code?, params? }` response body. */
export function avatarErrorFromBody(body: unknown, fallback: AvatarErrorKey): AvatarError {
  const api = toApiErrorLike(body);
  return { api: hasText(api) ? api : null, fallback };
}

/** A thrown error (a fetch `TypeError` becomes the `network_error` code). */
export function avatarErrorFromCatch(err: unknown, fallback: AvatarErrorKey): AvatarError {
  const api = toApiErrorLike(err);
  return { api: hasText(api) ? api : null, fallback };
}

/** A purely local error (client-side validation). */
export function avatarLocalError(fallback: AvatarErrorKey): AvatarError {
  return { api: null, fallback };
}

/**
 * Renders an `AvatarError`: the API's message (English as sent, or its code
 * translated) when there is one, else the panel's fallback. Calls no React
 * hook of its own beyond `useT` / `useApiErrorText`, so the panels' plain-call
 * tests can replace both.
 */
export function useAvatarErrorText(): (error: AvatarError) => string {
  const t = useT(avatarMessages);
  const apiText = useApiErrorText(errorsPlayers, errorsAuth, errorsAi);
  return (error) => (hasText(error.api) ? apiText(error.api) : t(`errors.${error.fallback}`));
}
