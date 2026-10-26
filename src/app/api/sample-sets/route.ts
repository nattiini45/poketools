import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getSampleSets } from '@/lib/supabase/queries/sample-sets';
import { resolveMoveset } from '@/lib/pkmn/set-resolver';
import { parseFormatId } from '@/lib/pkmn/format-id';
import {
  getGenFromBaseFormat,
  getTierFromBaseFormat,
  normalizeTierForSets,
} from '@/lib/pkmn/format-mapping';
import type { ApiResult } from '@/types/api';
import type { ResolvedSampleSet } from '@/types/sample-sets';

// Public: no auth required — sample sets for a Pokémon
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const pokemon = searchParams.get('pokemon');

  if (!pokemon) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'pokemon query param is required', code: 'sample_sets_pokemon_required' },
      { status: 400 },
    );
  }

  let generation = searchParams.get('generation')
    ? parseInt(searchParams.get('generation')!, 10)
    : undefined;
  let format = searchParams.get('format') ?? undefined;
  const includeOutdated = searchParams.get('include_outdated') === 'true';

  // Accept full format slugs ("gen9ou") — the sets table stores bare tiers ("ou")
  if (format && parseFormatId(format.toLowerCase()) !== null) {
    generation = generation ?? getGenFromBaseFormat(format);
    format = normalizeTierForSets(getTierFromBaseFormat(format));
  }

  try {
    const rows = await getSampleSets(pokemon, {
      generation,
      format,
      includeOutdated,
    });

    const sets: ResolvedSampleSet[] = rows.map((row) => ({
      set_name: row.set_name,
      format: row.format,
      pokemon_set: resolveMoveset(row.pokemon_name, row.moveset, row.generation),
      raw_moveset: row.moveset,
      description: row.description,
      outdated: row.outdated,
    }));

    return NextResponse.json<ApiResult<{ pokemon_name: string; generation: number; sets: ResolvedSampleSet[] }>>({
      success: true,
      data: {
        pokemon_name: pokemon,
        generation: generation ?? 9,
        sets,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch sample sets');
  }
}
