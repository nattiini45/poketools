import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getAggregateForPokemon,
  getPlayerAggregatesForPokemon,
  getTotalGamesInScope,
} from '@/lib/supabase/queries/aggregates';
import { getItemUsageForPokemon } from '@/lib/supabase/queries/teams';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import type { ApiResult } from '@/types/api';
import type { AggregateScope, PokemonDetailStats, PokemonPlayerRow } from '@/types/game';

// Public — returns competitive stats for a single Pokémon.
// Reads from pre-computed aggregates only (CLAUDE.md rule #4).
// Item stats are a targeted read from teams (no aggregate table has item data).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const pokemonName = decodeURIComponent(name);

  const { searchParams } = new URL(request.url);
  const scopeType = (searchParams.get('scope') ?? 'all_time') as AggregateScope;
  const scopeId = searchParams.get('scope_id') ?? null;
  const playerId = searchParams.get('player_id') ?? undefined;

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

  try {
    const totalGames = await getTotalGamesInScope(scopeType, scopeId);

    // If player_id is specified, use player_aggregates for the main stats
    if (playerId) {
      const [playerAggs, items] = await Promise.all([
        getPlayerAggregatesForPokemon(pokemonName, scopeType, scopeId, playerId),
        getItemUsageForPokemon(pokemonName, scopeType, scopeId, playerId),
      ]);
      const agg = playerAggs[0] ?? null;

      if (!agg) {
        const emptyResult: PokemonDetailStats = {
          pokemon_name: pokemonName,
          total_appearances: 0,
          total_games_in_scope: totalGames,
          usage_percent: 0,
          kos_dealt: 0,
          koed_rate: 0,
          bring_rate: null,
          lead_rate: null,
          win_rate: null,
          moves: [],
          items,
          players: [],
        };
        return NextResponse.json<ApiResult<PokemonDetailStats>>({
          success: true,
          data: emptyResult,
        });
      }

      const result: PokemonDetailStats = {
        pokemon_name: pokemonName,
        total_appearances: agg.total_appearances,
        total_games_in_scope: totalGames,
        usage_percent: totalGames > 0 ? (agg.total_appearances / totalGames) * 100 : 0,
        kos_dealt: agg.total_kos_dealt,
        koed_rate: agg.total_appearances > 0 ? (agg.total_koed / agg.total_appearances) * 100 : 0,
        bring_rate: agg.total_games > 0 ? (agg.total_brought / agg.total_games) * 100 : null,
        lead_rate: agg.total_games > 0 ? (agg.total_led / agg.total_games) * 100 : null,
        win_rate: agg.total_appearances > 0 ? (agg.total_wins / agg.total_appearances) * 100 : null,
        moves: buildMoveList(agg.move_counts, agg.total_appearances),
        items,
        players: [],
      };

      return NextResponse.json<ApiResult<PokemonDetailStats>>({
        success: true,
        data: result,
      });
    }

    // No player filter — fetch global aggregate, per-player breakdown, and items in parallel
    const [agg, playerAggs, items] = await Promise.all([
      getAggregateForPokemon(pokemonName, scopeType, scopeId),
      getPlayerAggregatesForPokemon(pokemonName, scopeType, scopeId),
      getItemUsageForPokemon(pokemonName, scopeType, scopeId),
    ]);

    if (!agg) {
      const emptyResult: PokemonDetailStats = {
        pokemon_name: pokemonName,
        total_appearances: 0,
        total_games_in_scope: totalGames,
        usage_percent: 0,
        kos_dealt: 0,
        koed_rate: 0,
        bring_rate: null,
        lead_rate: null,
        win_rate: null,
        moves: [],
        items,
        players: [],
      };
      return NextResponse.json<ApiResult<PokemonDetailStats>>({
        success: true,
        data: emptyResult,
      });
    }

    // Resolve player names
    const playerIds = playerAggs.map((pa) => pa.player_id);
    const playerNames = await resolvePlayerNames(playerIds);

    const players: PokemonPlayerRow[] = playerAggs.map((pa) => ({
      player_id: pa.player_id,
      player_name: playerNames[pa.player_id] ?? null,
      games: pa.total_games,
      kos_dealt: pa.total_kos_dealt,
      koed_rate: pa.total_appearances > 0 ? (pa.total_koed / pa.total_appearances) * 100 : 0,
      bring_rate: pa.total_games > 0 ? (pa.total_brought / pa.total_games) * 100 : null,
      lead_rate: pa.total_games > 0 ? (pa.total_led / pa.total_games) * 100 : null,
      win_rate: pa.total_appearances > 0 ? (pa.total_wins / pa.total_appearances) * 100 : null,
    }));

    const result: PokemonDetailStats = {
      pokemon_name: pokemonName,
      total_appearances: agg.total_appearances,
      total_games_in_scope: totalGames,
      usage_percent: totalGames > 0 ? (agg.total_appearances / totalGames) * 100 : 0,
      kos_dealt: agg.total_kos_dealt,
      koed_rate: agg.total_appearances > 0 ? (agg.total_koed / agg.total_appearances) * 100 : 0,
      bring_rate: agg.total_games > 0 ? (agg.total_brought / agg.total_games) * 100 : null,
      lead_rate: agg.total_games > 0 ? (agg.total_led / agg.total_games) * 100 : null,
      win_rate: agg.total_appearances > 0 ? (agg.total_wins / agg.total_appearances) * 100 : null,
      moves: buildMoveList(agg.move_counts, agg.total_appearances),
      items,
      players,
    };

    return NextResponse.json<ApiResult<PokemonDetailStats>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch Pokemon stats');
  }
}

function buildMoveList(
  moveCounts: Record<string, number>,
  totalAppearances: number
): { name: string; count: number; usage_percent: number }[] {
  return Object.entries(moveCounts)
    .map(([name, count]) => ({
      name,
      count,
      usage_percent: totalAppearances > 0 ? (count / totalAppearances) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

