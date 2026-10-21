import { NextRequest, NextResponse } from 'next/server';
import { getAllItems, type ListingRow } from '@/lib/pkmn/dex-l10n.server';
import { isLocale, type Locale } from '@/i18n/config';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';

// Public: no auth required
// Full item list per generation — used for item picker in teambuilder.
// Optional `lang` (en | de; absent or invalid = en): with `de`, each row's `desc` is the German game text and the
// row carries `descLang`. The param is part of the URL, so the long cache stays correct per language.
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=86400' };

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const parsedGen = Number.parseInt(searchParams.get('gen') ?? '9', 10);
    const gen = Number.isInteger(parsedGen) && parsedGen >= 1 ? parsedGen : 9;
    const rawLang = searchParams.get('lang');
    const lang: Locale = isLocale(rawLang) ? rawLang : 'en';

    const items = getAllItems(gen, { lang });

    return NextResponse.json<ApiResult<ListingRow[]>>(
      { success: true, data: items },
      { headers: CACHE_HEADERS },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch items');
  }
}
