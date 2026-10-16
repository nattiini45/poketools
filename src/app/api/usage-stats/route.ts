import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { parsePagination } from '@/lib/api/pagination';
import { getHybridUsageList } from '@/lib/supabase/queries/usage-hybrid';
import { getBaseStats } from '@/lib/pkmn/dex';
import { getLastImportDate } from '@/lib/supabase/queries/meta-usage';
import type { ApiResult } from '@/types/api';
import type { UsageStatsListResponse } from '@/types/usage';

// Public: no auth required — usage stats list for a format (with optional league hybrid)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format');

  if (!format) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'format query param is required', code: 'usage_format_required' },
      { status: 400 },
    );
  }

  const seasonId = searchParams.get('season_id') ?? undefined;
  const tournamentId = searchParams.get('tournament_id') ?? undefined;
  const { limit, offset, search } = parsePagination(searchParams);
  const minUsage = searchParams.get('min_usage')
    ? parseFloat(searchParams.get('min_usage')!)
    : undefined;

  try {
    const { data, total, source } = await getHybridUsageList({
      format,
      seasonId,
      tournamentId,
      limit,
      offset,
      minUsage,
      search,
    });

    // Enrich with type info and sprite IDs from @pkmn/data
    // Filter out entries with null/empty pokemon_name (corrupted cache data)
    const enriched = data
      .filter((item) => !!item.pokemon_name)
      .map((item) => {
        const info = getBaseStats(item.pokemon_name);
        return {
          ...item,
          types: info?.types?.map(String) ?? [],
          sprite_id: item.pokemon_name.toLowerCase().replace(/[^a-z0-9]/g, ''),
          base_stats: info?.baseStats,
        };
      });

    const lastUpdated = await getLastImportDate();

    const response: UsageStatsListResponse = {
      format,
      source,
      last_updated: lastUpdated?.toISOString() ?? '',
      pokemon: enriched,
      total,
    };

    return NextResponse.json<ApiResult<UsageStatsListResponse>>({
      success: true,
      data: response,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch usage stats');
  }
}
