import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getAggregateForPokemon,
  getPlayerAggregatesForPokemon,
  getTotalGamesInScope,
} from '@/lib/supabase/queries/aggregates';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import { publicReads } from '@/lib/cache/public-reads';
import { getItemUsageForPokemon } from '@/lib/supabase/queries/teams';
import { CACHE } from '@/lib/api/cache';
import { isValidUuid } from '@/lib/utils/uuid';
import { getSpeciesNatDex } from '@/lib/pkmn/dex';
import type { ApiResult } from '@/types/api';
import type { AggregateScope, PokemonDetailStats, PokemonPlayerRow } from '@/types/game';

// Public: no auth required — competitive stats for a single Pokémon.
// Usage, moves and per-player rows read the pre-computed aggregates.
// Item usage has no aggregate table: it is a targeted, bounded read counted in
// SQL (`get_item_usage_for_pokemon`, at most 50 items) from teams linked to
// completed matches, served through the tagged public read cache (H9). Only
// cache keys bounded by real data are cached (see `readItemUsage`).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const decodedName = decodePathSegment(name);
  // Malformed percent-encoding is a bad request, not a server error.
  if (decodedName === null) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Pokemon name is not valid URL encoding', code: 'stats_pokemon_name_invalid' },
      { status: 400 }
    );
  }

  // Only real species reach the database and the read cache: an unknown name
  // is a 404 before any read, and every read (and cache key) uses the
  // canonical name, the same NatDex resolution the species page uses. This
  // keeps an anonymous caller from minting unbounded cache entries.
  const resolved = getSpeciesNatDex(decodedName);
  if (!resolved) {
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: `Pokemon "${decodedName}" not found`,
        code: 'pokemon_not_found',
        params: { pokemon: decodedName },
      },
      { status: 404 }
    );
  }
  const pokemonName = resolved.entity.name;

  const { searchParams } = new URL(request.url);
  const scopeType = (searchParams.get('scope') ?? 'all_time') as AggregateScope;
  const scopeId = searchParams.get('scope_id') || null;
  const playerId = searchParams.get('player_id') || undefined;

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

  if (playerId !== undefined && !isValidUuid(playerId)) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'player_id must be a valid UUID', code: 'stats_player_id_invalid' },
      { status: 400 }
    );
  }

  // all_time takes no scope id (an extra one would only split the cache).
  const scopedId = scopeType === 'all_time' ? null : scopeId;

  try {
    const totalGames = await getTotalGamesInScope(scopeType, scopedId);

    // If player_id is specified, use player_aggregates for the main stats
    if (playerId) {
      const playerAggs = await getPlayerAggregatesForPokemon(pokemonName, scopeType, scopedId, playerId);
      const agg = playerAggs[0] ?? null;
      const items = await readItemUsage(pokemonName, scopeType, scopedId, playerId, agg !== null);

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
        return NextResponse.json<ApiResult<PokemonDetailStats>>(
          { success: true, data: emptyResult },
          { headers: CACHE.STATS }
        );
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

      return NextResponse.json<ApiResult<PokemonDetailStats>>(
        { success: true, data: result },
        { headers: CACHE.STATS }
      );
    }

    // No player filter — fetch global aggregate, per-player breakdown, and items in parallel
    const [agg, playerAggs] = await Promise.all([
      getAggregateForPokemon(pokemonName, scopeType, scopedId),
      getPlayerAggregatesForPokemon(pokemonName, scopeType, scopedId),
    ]);
    const items = await readItemUsage(pokemonName, scopeType, scopedId, null, agg !== null);

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
      return NextResponse.json<ApiResult<PokemonDetailStats>>(
        { success: true, data: emptyResult },
        { headers: CACHE.STATS }
      );
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

    return NextResponse.json<ApiResult<PokemonDetailStats>>(
      { success: true, data: result },
      { headers: CACHE.STATS }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch Pokemon stats');
  }
}

/**
 * Item usage for one response. The shared read cache is keyed by species,
 * scope id and player id; the species is canonical, but a scope id or player
 * id is any UUID an anonymous caller sends. So only keys bounded by real data
 * go through the cache: the all-time read without a player (one entry per
 * species), and any scope or player that has aggregate rows for the species
 * (`hasAggregate`). Everything else reads the bounded SQL function directly
 * and adds no cache entry, so random ids cannot grow the cache.
 */
function readItemUsage(
  pokemonName: string,
  scopeType: AggregateScope,
  scopeId: string | null,
  playerId: string | null,
  hasAggregate: boolean
): Promise<PokemonDetailStats['items']> {
  const bounded = hasAggregate || (scopeType === 'all_time' && playerId === null);
  return bounded
    ? publicReads.itemUsage(pokemonName, scopeType, scopeId, playerId)
    : getItemUsageForPokemon(pokemonName, scopeType, scopeId, playerId ?? undefined);
}

/** `decodeURIComponent`, or null for malformed percent-encoding (URIError only). */
function decodePathSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch (err) {
    if (err instanceof URIError) return null;
    throw err;
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

