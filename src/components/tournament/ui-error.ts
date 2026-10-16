import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';

/**
 * An error a tournament admin screen shows: an API failure, rendered with
 * `useApiErrorText` (the server's code in the viewer's language, else its
 * English text), or one of the component's own message keys. State holds
 * this, never translated text, so a language switch re-renders it
 * (i18n-core §1.7).
 */
export type UiError<K extends string> = { readonly api: ApiErrorLike } | { readonly key: K };

/** A failed API body (`{ success: false, error, code?, params? }`) as a `UiError`. */
export function apiFailure<K extends string>(body: unknown): UiError<K> {
  return { api: toApiErrorLike(body) };
}
