'use client';

/**
 * Hooks that render API errors in the viewer's language (i18n-core §4.2).
 *
 * ```tsx
 * const errorText = useApiErrorText(errorsSeasons);
 * const [error, setError] = useState<ApiErrorLike | null>(null);
 * if (!json.success) setError(json);          // store the object, not text
 * } catch (e) { setError(toApiErrorLike(e)); }
 * {error && <p role="alert">{errorText(error)}</p>}
 * ```
 *
 * `errorsCommon` is always consulted first, so domain catalogs never repeat
 * `network_error`, `unknown_error` or `validation_failed`. The returned
 * function is stable for a given locale and catalog set.
 */
import { useMemo } from 'react';
import { apiErrorText, type ApiErrorLike } from './api-errors';
import { useLocale } from './client';
import type { ErrorCatalog } from './messages/errors';
import type { PkmnParamLocalizer } from './pkmn-seam';

export type ApiErrorTextFn = (res: ApiErrorLike | null | undefined) => string;

const interned = new Map<string, readonly ErrorCatalog[]>();

/** One array instance per catalog set, so the memo below survives re-renders. */
function internCatalogs(catalogs: readonly ErrorCatalog[]): readonly ErrorCatalog[] {
  const key = catalogs.map((ns) => ns.id).join('|');
  const existing = interned.get(key);
  if (existing) return existing;
  const frozen = Object.freeze([...catalogs]);
  interned.set(key, frozen);
  return frozen;
}

export function useApiErrorText(...catalogs: ErrorCatalog[]): ApiErrorTextFn {
  const locale = useLocale();
  const list = internCatalogs(catalogs);
  return useMemo<ApiErrorTextFn>(() => (res) => apiErrorText(res, { locale, catalogs: list }), [locale, list]);
}

/**
 * As `useApiErrorText`, localizing Pokémon-name params (`pokemon`, `move`, …) through the pkmn layer.
 *
 * The result is memoised on the identity of `pkmn`: pass a stable localizer
 * (module-level, or from `useMemo`/a context value), not an inline object,
 * or a new function is returned on every render.
 */
export function useApiErrorTextWithPkmn(pkmn: PkmnParamLocalizer, ...catalogs: ErrorCatalog[]): ApiErrorTextFn {
  const locale = useLocale();
  const list = internCatalogs(catalogs);
  return useMemo<ApiErrorTextFn>(
    () => (res) => apiErrorText(res, { locale, catalogs: list, pkmn }),
    [locale, list, pkmn],
  );
}
