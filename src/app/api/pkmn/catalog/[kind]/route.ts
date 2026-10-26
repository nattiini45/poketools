import { NextRequest, NextResponse } from 'next/server';
import { isLocale } from '@/i18n/config';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  isCatalogKind,
  isCatalogScope,
  type CatalogIndex,
  type CatalogText,
} from '@/lib/pkmn/catalog-index';
import { buildCatalogIndex, buildCatalogText, catalogEtag, extendingPreset, isCatalogGen } from '@/lib/pkmn/catalog-index.server';
import { getPreset } from '@/lib/pkmn/format-catalog';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ kind: string }>;
}

/** Long edge cache: the catalog is immutable per deploy, and the ETag is a hash of the content. */
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

function invalid(field: string): NextResponse {
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: `Invalid ${field}`, code: 'validation_failed', params: { issues: field } },
    { status: 400 },
  );
}

/**
 * GET /api/pkmn/catalog/[kind]
 *
 * Public: no auth required. The entry catalog the Ruleset Studio pickers read: every Pokémon (`species`), move, item or
 * ability of one generation, for the generation's own universe (`scope=standard`, default) or its whole National Dex
 * (`scope=national`).
 *
 * `part=index` (default) is the short rows (ids, names, types, tiers, numbers, an icon sheet cell); `part=text` is the
 * one-line descriptions of moves, items and abilities in `lang` (`en` default, `de` falls back to English per entry).
 * `preset` extends the rows with the roster entries of a Champions preset that the dex files under a later generation.
 * One request per kind, generation and scope; the response is built once per process and cached for a long time.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { kind } = await params;
    if (!isCatalogKind(kind)) {
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Catalog kind not found', code: 'not_found_generic' }, { status: 404 });
    }
    const search = new URL(request.url).searchParams;
    const gen = Number(search.get('gen') ?? '9');
    if (!isCatalogGen(gen)) return invalid('gen');
    const scope = search.get('scope') ?? 'standard';
    if (!isCatalogScope(scope)) return invalid('scope');
    const part = search.get('part') ?? 'index';
    if (part !== 'index' && part !== 'text') return invalid('part');
    const presetParam = search.get('preset');
    if (presetParam !== null && getPreset(presetParam) === undefined) return invalid('preset');
    const preset = extendingPreset(presetParam, gen);

    let catalog: CatalogIndex | CatalogText;
    if (part === 'index') {
      catalog = buildCatalogIndex(kind, gen, scope, preset);
    } else {
      if (kind === 'species') return invalid('part');
      const rawLang = search.get('lang');
      const lang = isLocale(rawLang) ? rawLang : 'en';
      catalog = buildCatalogText(kind, gen, scope, lang, preset);
    }

    // The ETag hashes the built content (memoised with it), so a revalidating client gets a 304 only for unchanged data.
    const etag = catalogEtag(catalog);
    const headers = { 'Cache-Control': CACHE_CONTROL, ETag: etag };
    if (request.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304, headers });
    return NextResponse.json<ApiResult<CatalogIndex | CatalogText>>({ success: true, data: catalog }, { headers });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to build the catalog');
  }
}
