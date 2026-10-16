import { NextRequest, NextResponse } from 'next/server';
import { searchSpeciesRich } from '@/lib/pkmn/dex';
import { buildBenchmarksForSpecies } from '@/lib/pkmn/speed-benchmarks';
import type { ApiResult } from '@/types/api';
import type { SpeedBenchmark } from '@/types/speed';

/**
 * GET /api/pkmn/speed-search?q=gar&gen=9&level=100
 *
 * Search ALL species from @pkmn/data and return speed benchmarks
 * (uninvested / max / scarf) for each match. Unlike /api/pkmn/speed-tiers
 * which only returns meta-usage Pokémon, this endpoint searches the full dex.
 */
export function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q || q.length < 2) {
    return NextResponse.json<ApiResult<SpeedBenchmark[]>>({ success: true, data: [] });
  }

  const gen = parseInt(searchParams.get('gen') ?? '9', 10);
  const level = parseInt(searchParams.get('level') ?? '100', 10);

  const species = searchSpeciesRich(q, gen, 10);
  const benchmarks: SpeedBenchmark[] = [];

  for (const sp of species) {
    benchmarks.push(...buildBenchmarksForSpecies(sp.name, { level, gen }));
  }

  return NextResponse.json<ApiResult<SpeedBenchmark[]>>({ success: true, data: benchmarks });
}
