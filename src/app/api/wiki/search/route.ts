import { NextRequest, NextResponse } from 'next/server';
import { searchMoves, searchItems, searchAbilities, searchSpecies } from '@/lib/pkmn/dex';
import { typeSearchKeys } from '@/lib/pkmn/i18n/names/misc';
import { localizeName } from '@/lib/pkmn/i18n/names';
import { rankedSearch } from '@/lib/pkmn/i18n/search';
import { RESULT_KIND } from '@/lib/wiki/search-result';
import { getRequestDataLocale } from '@/i18n/server';
import { isLocale } from '@/i18n/config';
import { safeErrorResponse } from '@/lib/api/error-response';
import { CACHE } from '@/lib/api/cache';
import type { ApiResult } from '@/types/api';
import type { WikiSearchResult, WikiEntityType } from '@/types/wiki';

const TERA_TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice',
  'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug',
  'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy', 'Stellar',
] as const;

// Public: no auth required. Every category matches English and official German names (with umlaut
// transliteration), whatever the viewer's language: "Glurak" finds Charizard, "Feuer" the Fire tera type.
// `name` stays the canonical English name; `label` carries the display name localized to the viewer's
// data locale, resolved here so a search UI never needs the name maps in its chunk (issue #140).
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const typeFilter = searchParams.get('type') as WikiEntityType | null;

    // `?lang=` pins the localized body to the URL so the shared CDN cache never serves one viewer's
    // locale to another; without it the cookie-derived body is private and must not be cached.
    const rawLang = searchParams.get('lang');
    const explicitLang = isLocale(rawLang) ? rawLang : null;
    const headers = explicitLang ? CACHE.HOUR : CACHE.NONE;

    if (!query || query.length < 2) {
      return NextResponse.json<ApiResult<WikiSearchResult[]>>(
        { success: true, data: [] },
        { headers },
      );
    }

    const dataLocale = explicitLang ?? getRequestDataLocale(request);
    const entry = (type: WikiEntityType, name: string): WikiSearchResult => ({
      type,
      name,
      label: localizeName(RESULT_KIND[type], name, dataLocale),
      shortDesc: '',
    });

    const results: WikiSearchResult[] = [];
    const MAX_RESULTS = 20;
    const perCategory = typeFilter ? MAX_RESULTS : 5;

    if (!typeFilter || typeFilter === 'pokemon') {
      const species = searchSpecies(query, 9, perCategory);
      for (const s of species) {
        results.push(entry('pokemon', s.name));
      }
    }

    if (!typeFilter || typeFilter === 'move') {
      const moves = searchMoves(query, 9, perCategory);
      for (const m of moves) {
        results.push(entry('move', m.name));
      }
    }

    if (!typeFilter || typeFilter === 'item') {
      const items = searchItems(query, 9, perCategory);
      for (const i of items) {
        results.push(entry('item', i.name));
      }
    }

    if (!typeFilter || typeFilter === 'ability') {
      const abilities = searchAbilities(query, 9, perCategory);
      for (const a of abilities) {
        results.push(entry('ability', a.name));
      }
    }

    if (!typeFilter || typeFilter === 'tera') {
      // Ranked (exact, prefix, word prefix, substring); equal ranks keep the TERA_TYPES order.
      const teraTypes = rankedSearch(TERA_TYPES, query, typeSearchKeys, { limit: perCategory });
      for (const type of teraTypes) {
        results.push(entry('tera', type));
      }
    }

    return NextResponse.json<ApiResult<WikiSearchResult[]>>(
      { success: true, data: results.slice(0, MAX_RESULTS) },
      { headers },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to search the wiki');
  }
}
