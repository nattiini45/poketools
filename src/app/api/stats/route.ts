import { NextRequest, NextResponse } from 'next/server';
import { getAggregates, getTotalGamesInScope } from '@/lib/supabase/queries/aggregates';
import { aggregatesToUsageRows } from '@/lib/stats/usage-rows';
import { safeErrorResponse } from '@/lib/api/error-response';
import { CACHE } from '@/lib/api/cache';
import { getMoveNatDex } from '@/lib/pkmn/dex';
import { isValidUuid } from '@/lib/utils/uuid';
import type { ApiResult } from '@/types/api';
import type {
  Aggregate,
  AggregateScope,
  MoveUsageResponse,
  MoveUsageRow,
  MovePokemonTotals,
  PokemonUsageRow,
} from '@/types/game';

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
  const scopeType = (searchParams.get('scope') ?? 'tournament') as AggregateScope;
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

  if (!['tournament', 'league', 'all_time'].includes(scopeType)) {
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

  if (scopeId && !isValidUuid(scopeId)) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'scope_id must be a valid UUID', code: 'stats_scope_id_invalid' },
      { status: 400 }
    );
  }

  try {
    const aggregates = await getAggregates(scopeType, scopeId);

    if (view === 'raw') {
      return NextResponse.json<ApiResult<Aggregate[]>>(
        { success: true, data: aggregates },
        { headers: CACHE.STATS }
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

      return NextResponse.json<ApiResult<MoveUsageResponse>>(
        { success: true, data: { rows, pokemonTotals } },
        { headers: CACHE.STATS },
      );
    }

    // Default: usage view with computed percentages
    const totalGames = await getTotalGamesInScope(scopeType, scopeId);

    const usageRows: PokemonUsageRow[] = aggregatesToUsageRows(aggregates, totalGames);

    return NextResponse.json<ApiResult<PokemonUsageRow[]>>(
      { success: true, data: usageRows },
      { headers: CACHE.STATS }
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
