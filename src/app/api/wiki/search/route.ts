import { NextRequest, NextResponse } from 'next/server';
import { searchMoves, searchItems, searchAbilities, searchSpecies } from '@/lib/pkmn/dex';
import { typeSearchKeys } from '@/lib/pkmn/i18n/names/misc';
import { rankedSearch } from '@/lib/pkmn/i18n/search';
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
// Returned names stay English; the client localizes them at display time.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const typeFilter = searchParams.get('type') as WikiEntityType | null;

    if (!query || query.length < 2) {
      return NextResponse.json<ApiResult<WikiSearchResult[]>>(
        { success: true, data: [] },
        { headers: CACHE.HOUR },
      );
    }

    const results: WikiSearchResult[] = [];
    const MAX_RESULTS = 20;
    const perCategory = typeFilter ? MAX_RESULTS : 5;

    if (!typeFilter || typeFilter === 'pokemon') {
      const species = searchSpecies(query, 9, perCategory);
      for (const s of species) {
        results.push({ type: 'pokemon', name: s.name, shortDesc: '' });
      }
    }

    if (!typeFilter || typeFilter === 'move') {
      const moves = searchMoves(query, 9, perCategory);
      for (const m of moves) {
        results.push({ type: 'move', name: m.name, shortDesc: '' });
      }
    }

    if (!typeFilter || typeFilter === 'item') {
      const items = searchItems(query, 9, perCategory);
      for (const i of items) {
        results.push({ type: 'item', name: i.name, shortDesc: '' });
      }
    }

    if (!typeFilter || typeFilter === 'ability') {
      const abilities = searchAbilities(query, 9, perCategory);
      for (const a of abilities) {
        results.push({ type: 'ability', name: a.name, shortDesc: '' });
      }
    }

    if (!typeFilter || typeFilter === 'tera') {
      // Ranked (exact, prefix, word prefix, substring); equal ranks keep the TERA_TYPES order.
      const teraTypes = rankedSearch(TERA_TYPES, query, typeSearchKeys, { limit: perCategory });
      for (const type of teraTypes) {
        results.push({ type: 'tera', name: type, shortDesc: '' });
      }
    }

    return NextResponse.json<ApiResult<WikiSearchResult[]>>(
      { success: true, data: results.slice(0, MAX_RESULTS) },
      { headers: CACHE.HOUR },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to search the wiki');
  }
}
