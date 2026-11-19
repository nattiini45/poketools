import { NextRequest, NextResponse } from 'next/server';
import { getAggregates, getTotalGamesInMixedScope, getTotalGamesInScope } from '@/lib/supabase/queries/aggregates';
import { getPhaseSeasonGameTotal } from '@/lib/supabase/queries/phase-games';
import { aggregatesToUsageRows } from '@/lib/stats/usage-rows';
import { readHistoricalUsage } from '@/lib/stats/historical-statistics';
import { combinePokemonUsage, type CombinedPokemonUsageRow, type HistoricalStatisticsView } from '@/lib/stats/combined-statistics';
import { packExtensions } from '@/lib/pack-extensions';
import type { HistoricalUsageContribution } from '@/lib/pack-extensions/historical-statistics-types';
import { safeErrorResponse } from '@/lib/api/error-response';
import { CACHE } from '@/lib/api/cache';
import { getMoveNatDex } from '@/lib/pkmn/dex';
import { isValidUuid } from '@/lib/utils/uuid';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getPhaseRouteMode, requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { resolveLeaguePhaseRoute } from '@/lib/supabase/queries/phase-route-owners';
import type { ApiResult } from '@/types/api';
import type {
  Aggregate,
  AggregateScope,
  MoveUsageResponse,
  MoveUsageRow,
  MovePokemonTotals,
} from '@/types/game';

type StatsApiResult<T> = ApiResult<T> & {
  history?: HistoricalStatisticsView;
  historical?: HistoricalUsageContribution;
  metricCoverage?: 'live_only';
};

/** Longest accepted `move=` value (real move names are under 32 characters). */
const MAX_MOVE_FILTER_LENGTH = 64;

const STATS_VIEWS = ['usage', 'raw', 'moves'] as const;
type StatsView = (typeof STATS_VIEWS)[number];

function isStatsView(value: string): value is StatsView {
  return (STATS_VIEWS as readonly string[]).includes(value);
}

// Public: no auth required. Reads pre-computed stats from the aggregates table.
// Never touches battle_stats directly (CLAUDE.md rule #4).
//
// `view=moves&move=<Move Name>` narrows the moves view to one move (exact
// display-name match, as stored in `aggregates.move_counts`), so a caller that
// needs a single move downloads only that move's rows and the totals of the
// Pokémon that used it. `move` is ignored by the other views.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scopeType = searchParams.get('scope') ?? 'tournament';
  const scopeId = searchParams.get('scope_id') ?? null;
  const view = searchParams.get('view') ?? 'usage';
  const rawMove = searchParams.get('move');
  const moveFilter = rawMove === null ? null : rawMove.trim();

  if (!isStatsView(view)) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'view must be usage, raw, or moves', code: 'stats_view_invalid' },
      { status: 400 }
    );
  }

  if (moveFilter !== null && (moveFilter.length === 0 || moveFilter.length > MAX_MOVE_FILTER_LENGTH)) {
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: `move must be 1-${MAX_MOVE_FILTER_LENGTH} characters`,
        code: 'stats_move_filter_length',
        params: { max: MAX_MOVE_FILTER_LENGTH },
      },
      { status: 400 }
    );
  }

  if (scopeType !== 'tournament' && scopeType !== 'league' && scopeType !== 'all_time' && scopeType !== 'archive' && scopeType !== 'phase') {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'scope must be tournament, league, or all_time', code: 'stats_scope_invalid' },
      { status: 400 }
    );
  }

  if (scopeType !== 'all_time' && !scopeId) {
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: 'scope_id required for tournament and league scopes',
        code: 'stats_scope_id_required',
      },
      { status: 400 }
    );
  }

  if (scopeId && (scopeType === 'archive' ? !/^[a-z0-9][a-z0-9-]{0,99}$/.test(scopeId) : !isValidUuid(scopeId))) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'scope_id must be a valid UUID', code: 'stats_scope_id_invalid' },
      { status: 400 }
    );
  }

  try {
    const scopedId = scopeType === 'all_time' ? null : scopeId;
    let aggregateScope: AggregateScope | 'archive' = scopeType;
    if (scopeType === 'phase') {
      const seasonId = searchParams.get('season_id');
      if (!seasonId || !isValidUuid(seasonId) || !scopedId) {
        throw new UserFacingError('League not found', { code: 'INVALID_SEASON_ID', status: 404 });
      }
      const owner = await resolveLeaguePhaseRoute(seasonId, scopedId, await requireOpenPhaseRouteMode());
      if (!owner) throw new UserFacingError('Phase not found', { code: 'PHASE_NOT_FOUND', status: 404 });
      aggregateScope = owner.kind;
    }
    const [aggregates, historical] = await Promise.all([
      aggregateScope === 'archive' ? Promise.resolve([]) : getAggregates(aggregateScope, scopedId),
      readHistoricalUsage({ scopeType, scopeId: scopedId }),
    ]);
    const mode = view === 'usage' && (scopeType === 'league' || scopeType === 'all_time') ? await getPhaseRouteMode() : 'legacy';
    const nativeUsage = mode === 'phase' || mode === 'frozen_phase';
    const headers = scopeType === 'phase' || nativeUsage || packExtensions.historicalUsage ? CACHE.NONE : CACHE.STATS;
    const provenance = historical.history.state === 'absent' ? {} : { history: historical.history };

    if (view === 'raw') {
      return NextResponse.json<StatsApiResult<Aggregate[]>>(
        { success: true, data: aggregates, ...provenance, ...(historical.data ? { historical: historical.data } : {}) },
        { headers }
      );
    }

    if (view === 'moves') {
      // Resolve move metadata once per unique move name to avoid repeated dex walks.
      const moveMetaCache = new Map<
        string,
        { type: string; category: 'Physical' | 'Special' | 'Status' | null }
      >();

      function resolveMove(name: string) {
        const cached = moveMetaCache.get(name);
        if (cached) return cached;
        const resolved = getMoveNatDex(name);
        const meta = resolved
          ? {
              type: resolved.entity.type,
              category: normaliseCategory(resolved.entity.category),
            }
          : { type: '', category: null };
        moveMetaCache.set(name, meta);
        return meta;
      }

      const rows: MoveUsageRow[] = [];
      const pokemonTotals: MovePokemonTotals[] = [];
      for (const agg of aggregates) {
        const moveEntries: [string, number][] =
          moveFilter === null
            ? Object.entries(agg.move_counts)
            : Object.prototype.hasOwnProperty.call(agg.move_counts, moveFilter)
              ? [[moveFilter, agg.move_counts[moveFilter]]]
              : [];

        // With a move filter, only the Pokémon that used the move are relevant.
        if (moveFilter !== null && moveEntries.length === 0) continue;

        for (const [move, count] of moveEntries) {
          const meta = resolveMove(move);
          rows.push({
            pokemon_name: agg.pokemon_name,
            move_name: move,
            count,
            move_type: meta.type || null,
            move_category: meta.category,
          });
        }
        pokemonTotals.push({
          pokemon_name: agg.pokemon_name,
          total_brought: agg.total_brought,
          total_appearances: agg.total_appearances,
        });
      }
      rows.sort((a, b) => b.count - a.count);

      return NextResponse.json<StatsApiResult<MoveUsageResponse>>(
        { success: true, data: { rows, pokemonTotals }, ...provenance, ...(historical.history.state === 'absent' ? {} : { metricCoverage: 'live_only' }) },
        { headers },
      );
    }

    // Default: usage view with computed percentages
    const totalGames = aggregateScope === 'archive' ? 0
      : nativeUsage && scopeType === 'league' && scopedId ? await getPhaseSeasonGameTotal(scopedId)
        : nativeUsage && scopeType === 'all_time' ? await getTotalGamesInMixedScope('all_time', null)
          : await getTotalGamesInScope(aggregateScope, scopedId);

    const usageRows = historical.data
      ? combinePokemonUsage(aggregates, totalGames, historical.data)
      : aggregatesToUsageRows(aggregates, totalGames);

    return NextResponse.json<StatsApiResult<CombinedPokemonUsageRow[]>>(
      { success: true, data: usageRows, ...provenance },
      { headers }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch stats');
  }
}

function normaliseCategory(
  raw: string | undefined,
): 'Physical' | 'Special' | 'Status' | null {
  if (!raw) return null;
  const upper = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  if (upper === 'Physical' || upper === 'Special' || upper === 'Status') {
    return upper;
  }
  return null;
}
