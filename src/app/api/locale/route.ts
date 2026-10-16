import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  DEFAULT_LOCALE,
  LANGUAGE_COOKIE_MAX_AGE,
  LOCALE_COOKIE,
  PKMN_LANG_COOKIE,
  isLocale,
  isPkmnTermsPreference,
  type Locale,
  type PkmnTermsPreference,
} from '@/i18n/config';
import type { ApiResult } from '@/types/api';

// Public: no auth required
//
// Sets the language cookies (i18n-core §2.2). The only writer of
// `plc_locale` and `plc_pkmn_lang`, called only by
// `applyLanguagePreference()` (`src/i18n/switch-language.ts`). The cookies
// are not httpOnly: `global-error.tsx` reads `plc_locale` client-side.

const INVALID_MESSAGE = "locale must be 'en' or 'de'; pkmnTerms must be 'follow' or 'en'.";
const ALLOWED_KEYS = new Set(['locale', 'pkmnTerms']);

type LocaleData = { locale: Locale; pkmnTerms: PkmnTermsPreference };

function invalid(): NextResponse<ApiResult<never>> {
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: INVALID_MESSAGE, code: 'locale_invalid' },
    { status: 400 },
  );
}

function parseBody(raw: unknown): { locale?: Locale; pkmnTerms?: PkmnTermsPreference } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.length === 0 || keys.some((key) => !ALLOWED_KEYS.has(key))) return null;
  const out: { locale?: Locale; pkmnTerms?: PkmnTermsPreference } = {};
  if ('locale' in body) {
    if (!isLocale(body.locale)) return null;
    out.locale = body.locale;
  }
  if ('pkmnTerms' in body) {
    if (!isPkmnTermsPreference(body.pkmnTerms)) return null;
    out.pkmnTerms = body.pkmnTerms;
  }
  return out;
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  return origin === request.nextUrl.origin;
}

export async function POST(request: NextRequest): Promise<NextResponse<ApiResult<LocaleData>>> {
  try {
    if (!sameOrigin(request)) {
      console.error('[api/locale] cross-origin language change refused:', request.headers.get('origin'));
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Cross-origin language change refused.', code: 'locale_cross_origin' },
        { status: 403 },
      );
    }

    const raw: unknown = await request.json().catch(() => null);
    const parsed = parseBody(raw);
    if (!parsed) return invalid();

    const currentLocale = request.cookies.get(LOCALE_COOKIE)?.value;
    const currentPkmn = request.cookies.get(PKMN_LANG_COOKIE)?.value;
    const data: LocaleData = {
      locale: parsed.locale ?? (isLocale(currentLocale) ? currentLocale : DEFAULT_LOCALE),
      pkmnTerms: parsed.pkmnTerms ?? (currentPkmn === 'en' ? 'en' : 'follow'),
    };

    const res = NextResponse.json<ApiResult<LocaleData>>({ success: true, data });
    const cookieOptions = {
      path: '/',
      maxAge: LANGUAGE_COOKIE_MAX_AGE,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      httpOnly: false,
    };
    if (parsed.locale) res.cookies.set(LOCALE_COOKIE, parsed.locale, cookieOptions);
    if (parsed.pkmnTerms === 'en') res.cookies.set(PKMN_LANG_COOKIE, 'en', cookieOptions);
    if (parsed.pkmnTerms === 'follow') res.cookies.delete({ name: PKMN_LANG_COOKIE, path: '/' });
    return res;
  } catch (err) {
    return safeErrorResponse(err, 'Failed to save the language setting', 500, 'locale_save_failed');
  }
}
