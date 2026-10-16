import { NextRequest, NextResponse } from 'next/server';
import { listMovesForSpecies, type WithDescLang } from '@/lib/pkmn/dex-l10n.server';
import type { MoveSearchResult } from '@/lib/pkmn/dex';
import { isLocale, type Locale } from '@/i18n/config';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';

const SPECIES_REQUIRED = 'species parameter is required';

// Public — list all learnable moves for a species (for teambuilder move picker).
// Optional `lang` (en | de; absent or invalid = en): with `de`, each row's `shortDesc` is the German game text
// and the row carries `shortDescLang`. Names and ids stay English.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ species: string }> },
) {
  try {
    const { species } = await params;
    if (!species) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: SPECIES_REQUIRED, code: 'validation_failed', params: { issues: SPECIES_REQUIRED } },
        { status: 400 },
      );
    }

    const { searchParams } = new URL(request.url);
    const parsedGen = Number.parseInt(searchParams.get('gen') ?? '9', 10);
    const gen = Number.isInteger(parsedGen) && parsedGen >= 1 ? parsedGen : 9;
    const rawLang = searchParams.get('lang');
    const lang: Locale = isLocale(rawLang) ? rawLang : 'en';

    const moves = await listMovesForSpecies(decodeURIComponent(species), gen, { lang });

    return NextResponse.json<ApiResult<WithDescLang<MoveSearchResult>[]>>({
      success: true,
      data: moves,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to list moves for species');
  }
}
