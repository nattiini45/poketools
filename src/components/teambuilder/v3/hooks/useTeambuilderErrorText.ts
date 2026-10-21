'use client';

import { useCallback } from 'react';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { ErrorCatalog } from '@/i18n/messages/errors';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
import type teambuilderEn from '@/i18n/messages/teambuilder/en';

/** A key of `teambuilder.errors`: client-side failures that have no API code. */
export type TeambuilderErrorKey = keyof typeof teambuilderEn.errors;

/**
 * A failure kept in component state. Never the translated text (i18n-core
 * §1.7): either the API's error object (`error` / `code` / `params`, rendered
 * through the error catalogs) or a `teambuilder.errors` key.
 */
export type TeambuilderError =
  | { kind: 'api'; error: ApiErrorLike }
  | { kind: 'key'; key: TeambuilderErrorKey };

export function errorKey(key: TeambuilderErrorKey): TeambuilderError {
  return { kind: 'key', key };
}

/**
 * The failure of an API body (`{ success: false, error, code? }`): its own
 * error when it carries one, else the `fallback` key.
 */
export function apiFailure(body: unknown, fallback: TeambuilderErrorKey): TeambuilderError {
  const like = toApiErrorLike(body);
  if (like.error || like.code) return { kind: 'api', error: like };
  return errorKey(fallback);
}

/** Renders a `TeambuilderError` in the viewer's language; `errorsCommon` is always consulted. */
export function useTeambuilderErrorText(...catalogs: ErrorCatalog[]): (e: TeambuilderError) => string {
  const t = useT(teambuilderMessages);
  const apiText = useApiErrorText(...catalogs);
  return useCallback((e: TeambuilderError) => (e.kind === 'api' ? apiText(e.error) : t(`errors.${e.key}`)), [t, apiText]);
}
