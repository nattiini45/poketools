import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getHybridPokemonDetail } from '@/lib/supabase/queries/usage-hybrid';
import { getSpeciesTypeInfo, getBaseStats, getMove } from '@/lib/pkmn/dex';
import { getFallbackFormats } from '@/lib/pkmn/formats';
import { generationOrDefault } from '@/lib/pkmn/format-id';
import { localizeDesc } from '@/lib/pkmn/i18n/descriptions.server';
import { isLocale, type Locale } from '@/i18n/config';
import type { ApiResult } from '@/types/api';
import type { HybridPokemonDetail, EnrichedMoveEntry } from '@/types/usage';

// Public — full usage detail for a single Pokémon in a format.
// Optional `lang` (en | de; absent or invalid = en): with `de`, each enriched move's `shortDesc` is the German
// game text where one exists (English Showdown text otherwise). Names stay English.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pokemon: string }> }
) {
  const { pokemon } = await params;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format');
  const rawLang = searchParams.get('lang');
  const lang: Locale = isLocale(rawLang) ? rawLang : 'en';

  if (!format) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'format query param is required', code: 'usage_format_required' },
      { status: 400 },
    );
  }

  const pokemonName = decodeURIComponent(pokemon);
  const seasonId = searchParams.get('season_id') ?? undefined;
  const tournamentId = searchParams.get('tournament_id') ?? undefined;

  try {
    // Try primary format first
    let detail = await getHybridPokemonDetail(pokemonName, {
      format,
      seasonId,
      tournamentId,
    });

    let fallbackFormat: string | undefined;

    // If no data in primary format, try fallback formats concurrently
    if (!detail) {
      const fallbacks = getFallbackFormats(format);
      const fallbackResults = await Promise.all(
        fallbacks.map(async (fb) => ({
          format: fb,
          detail: await getHybridPokemonDetail(pokemonName, { format: fb }),
        }))
      );
      // Use the first fallback that returned data (preserves priority order)
      for (const fb of fallbackResults) {
        if (fb.detail) {
          detail = fb.detail;
          fallbackFormat = fb.format;
          break;
        }
      }
    }

    if (!detail) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `No usage data for ${pokemonName}`,
          code: 'usage_no_data',
          params: { pokemon: pokemonName },
        },
        { status: 404 },
      );
    }

    // Enrich with type info and base stats from @pkmn/data
    const typeInfo = getSpeciesTypeInfo(pokemonName);
    const speciesInfo = getBaseStats(pokemonName);

    // Enrich moves with type, category, power from @pkmn/data
    const gen = generationOrDefault(format);
    const enrichedMoves: EnrichedMoveEntry[] = Object.entries(detail.moves)
      .sort(([, a], [, b]) => b - a)
      .map(([moveName, usagePct]) => {
        const move = getMove(moveName, gen);
        const englishDesc = (move as unknown as { shortDesc?: string } | undefined)?.shortDesc;
        return {
          name: moveName,
          usage_pct: usagePct,
          type: move?.type ?? 'Normal',
          category: move?.category ?? 'Status',
          power: move?.basePower ?? null,
          shortDesc:
            englishDesc === undefined
              ? undefined
              : localizeDesc('move', move?.name ?? moveName, englishDesc, lang).text,
        };
      });

    const result: HybridPokemonDetail = {
      ...detail,
      types: typeInfo?.types ?? [],
      base_stats: speciesInfo?.baseStats ?? { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      enriched_moves: enrichedMoves,
      ...(fallbackFormat ? { fallback_format: fallbackFormat } : {}),
    };

    return NextResponse.json<ApiResult<HybridPokemonDetail>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch pokemon usage detail');
  }
}
