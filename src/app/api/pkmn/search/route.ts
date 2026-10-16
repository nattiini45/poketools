import { NextRequest, NextResponse } from 'next/server';
import {
  searchSpecies, searchMoves, searchItems, searchAbilities,
  searchSpeciesRich,
  getLegalAbilities, getAbility,
} from '@/lib/pkmn/dex';
// Language-aware rich/description searches (pkmn-l10n §3.6): `?lang=de` swaps each row's English Showdown
// `shortDesc` for the German game text and adds `shortDescLang`. Names and ids stay English.
import {
  searchMovesRich, searchItemsRich, searchAbilitiesRich,
  searchMovesForSpecies, searchAbilitiesForSpecies,
  searchItemsByDescription, searchAbilitiesByDescription,
} from '@/lib/pkmn/dex-l10n.server';
import { listSpeciesForFormat } from '@/lib/pkmn/species-list';
import { localizeDesc } from '@/lib/pkmn/i18n/descriptions.server';
import { toID } from '@/lib/pkmn/i18n/id';
import { isLocale, type Locale } from '@/i18n/config';
import { safeErrorResponse } from '@/lib/api/error-response';
import { CACHE } from '@/lib/api/cache';
import type { ApiResult } from '@/types/api';

// Public: no auth required — server-side dex search for teambuilder autocomplete
// Optional `species` param filters moves/abilities to only legal ones for that species
// Optional `lang` (en | de; absent or invalid = en) localizes descriptions; it is part of the URL, so the
// long cache stays correct per language.
// Pure dex data (no DB), immutable per deploy — long cache is safe

const INVALID_TYPE = 'type must be species, move, item, or ability';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const type = searchParams.get('type') ?? 'species';
    const mode = searchParams.get('mode') ?? 'name'; // 'name' (default) or 'description'
    const rich = searchParams.get('rich') === '1';
    const species = searchParams.get('species'); // filter to legal for this species
    const rawLang = searchParams.get('lang');
    const lang: Locale = isLocale(rawLang) ? rawLang : 'en';
    const opts = { lang };
    // poke_type: filter species by Pokémon type (e.g. poke_type=Fire)
    const pokeType = searchParams.get('poke_type')?.toLowerCase() ?? null;
    const parsedGen = Number.parseInt(searchParams.get('gen') ?? '9', 10);
    const gen = Number.isInteger(parsedGen) && parsedGen >= 1 ? parsedGen : 9;

    // Allow listing all species with q=* or empty query when type=pokemon/species and list=1
    const listAll = searchParams.get('list') === '1';
    if (listAll && (type === 'species' || type === 'pokemon')) {
      // Optional `format` (e.g. gen9ou) enriches each species with display tier
      // and a `legal` flag for the format. Whitelist-validate; invalid → ignore.
      const rawFormat = searchParams.get('format');
      const format = rawFormat && /^[a-z0-9]{1,40}$/.test(rawFormat) ? rawFormat : null;
      const all = listSpeciesForFormat(gen, format);
      const filtered = pokeType
        ? all.filter((s) => s.types?.some((t) => t.toLowerCase() === pokeType))
        : all;
      return NextResponse.json<ApiResult<unknown[]>>(
        { success: true, data: filtered },
        { headers: CACHE.HOUR },
      );
    }

    // List all legal abilities for a species (no query needed)
    if (listAll && (type === 'ability' || type === 'abilities') && species) {
      const legal = getLegalAbilities(species, gen);
      const data = legal.map((a) => {
        const ability = getAbility(a.name, gen);
        const englishDesc = (ability as unknown as { shortDesc?: string } | undefined)?.shortDesc ?? '';
        const row = {
          name: a.name,
          // The @pkmn id (toID), not a whitespace-stripped lowercase name: "Mind's Eye" → "mindseye".
          id: toID(a.name),
          shortDesc: englishDesc,
        };
        if (lang !== 'de') return row;
        const desc = localizeDesc('ability', a.name, englishDesc, lang);
        return { ...row, shortDesc: desc.text, shortDescLang: desc.lang };
      });
      return NextResponse.json<ApiResult<unknown[]>>({ success: true, data });
    }

    if (!query || query.length < 2) {
      return NextResponse.json<ApiResult<unknown[]>>({ success: true, data: [] });
    }

    let results: unknown[];

    switch (type) {
      case 'species':
      case 'pokemon':
        results = rich ? searchSpeciesRich(query, gen) : searchSpecies(query, gen);
        break;
      case 'move':
      case 'moves':
        if (species && rich) {
          results = await searchMovesForSpecies(query, species, gen, undefined, opts);
        } else {
          results = rich ? searchMovesRich(query, gen, undefined, opts) : searchMoves(query, gen);
        }
        break;
      case 'item':
      case 'items':
        if (mode === 'description') {
          results = searchItemsByDescription(query, gen, undefined, opts);
        } else {
          results = rich ? searchItemsRich(query, gen, undefined, opts) : searchItems(query, gen);
        }
        break;
      case 'ability':
      case 'abilities':
        if (mode === 'description') {
          results = searchAbilitiesByDescription(query, gen, undefined, opts);
        } else if (species && rich) {
          results = searchAbilitiesForSpecies(query, species, gen, opts);
        } else {
          results = rich ? searchAbilitiesRich(query, gen, undefined, opts) : searchAbilities(query, gen);
        }
        break;
      default:
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: INVALID_TYPE, code: 'validation_failed', params: { issues: INVALID_TYPE } },
          { status: 400 },
        );
    }

    return NextResponse.json<ApiResult<unknown[]>>(
      { success: true, data: results },
      { headers: CACHE.HOUR }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to search Pokémon data');
  }
}
