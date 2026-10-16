'use client';

import type { ApiErrorLike } from './api-errors';
import type { Locale, PkmnTermsPreference } from './config';

/**
 * The only writer of the language cookies (i18n-core §2.3, D14): posts to
 * `POST /api/locale`, then refreshes the server tree. A route-world page
 * (`[data-world-route]`) reloads instead, so the 3D world is rebuilt in the
 * new language under a fresh loading ceremony (complete at reveal).
 */

interface LocaleResponseBody {
  success?: boolean;
  error?: string;
  code?: string;
  params?: Record<string, string | number>;
}

function isBody(v: unknown): v is LocaleResponseBody {
  return typeof v === 'object' && v !== null;
}

export async function applyLanguagePreference(
  input: { locale?: Locale; pkmnTerms?: PkmnTermsPreference },
  router: { refresh(): void },
): Promise<{ ok: true } | { ok: false; error: ApiErrorLike }> {
  let res: Response;
  try {
    res = await fetch('/api/locale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch (err) {
    console.error('[i18n] language switch request failed:', err);
    return { ok: false, error: { code: 'network_error' } };
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok || !isBody(body) || body.success !== true) {
    const error: ApiErrorLike = isBody(body)
      ? { error: body.error ?? null, code: body.code ?? null, params: body.params ?? null }
      : { error: `HTTP ${res.status}` };
    console.error('[i18n] language switch refused:', res.status, error);
    return { ok: false, error };
  }

  if (input.locale) document.documentElement.lang = input.locale;
  if (document.querySelector('[data-world-route]')) {
    window.location.reload();
  } else {
    router.refresh();
  }
  return { ok: true };
}
