import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getAggregateForPokemon,
  getPlayerAggregatesForPokemon,
  getTotalGamesInScope,
} from '@/lib/supabase/queries/aggregates';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import { publicReads } from '@/lib/cache/public-reads';
import { withoutHiddenPlayers } from '@/lib/players/hidden-players';
import { getItemUsageForPokemon } from '@/lib/supabase/queries/teams';
import { CACHE } from '@/lib/api/cache';
import { isValidUuid } from '@/lib/utils/uuid';
import { getSpeciesNatDex } from '@/lib/pkmn/dex';
import { readHistoricalUsage } from '@/lib/stats/historical-statistics';
import { pokemonDetailStats } from '@/lib/stats/pokemon-detail';
import { combinePokemonUsage } from '@/lib/stats/combined-statistics';
import { packExtensions } from '@/lib/pack-extensions';
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
  const scopeType = (searchParams.get('scope') ?? 'all_time') as AggregateScope | 'archive';
  const scopeId = searchParams.get('scope_id') || null;
  const playerId = searchParams.get('player_id') || undefined;

  if (!['tournament', 'league', 'all_time', 'archive'].includes(scopeType)) {
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

  if (playerId !== undefined && !isValidUuid(playerId)) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'player_id must be a valid UUID', code: 'stats_player_id_invalid' },
      { status: 400 }
    );
  }

  // all_time takes no scope id (an extra one would only split the cache).
  const scopedId = scopeType === 'all_time' ? null : scopeId;

  try {
    const [historical, totalGames, livePlayers, aggregate] = await Promise.all([
      readHistoricalUsage({ scopeType, scopeId: scopedId, playerId }),
      scopeType === 'archive' ? Promise.resolve(0) : getTotalGamesInScope(scopeType, scopedId),
      scopeType === 'archive' ? Promise.resolve([]) : getPlayerAggregatesForPokemon(pokemonName, scopeType, scopedId, playerId),
      scopeType === 'archive' || playerId ? Promise.resolve(null) : getAggregateForPokemon(pokemonName, scopeType, scopedId),
    ]);
    const selectedAggregate = playerId ? livePlayers[0] ?? null : aggregate;
    const result = pokemonDetailStats(pokemonName, selectedAggregate, totalGames, historical.data, historical.history);
    result.items = scopeType === 'archive' ? [] : await readItemUsage(pokemonName, scopeType, scopedId, playerId ?? null, selectedAggregate !== null);

    if (!playerId) {
      const hidden = await publicReads.hiddenPlayerIds();
      const visibleLive = withoutHiddenPlayers(livePlayers, hidden);
      const earlier = new Map((historical.data?.players ?? [])
        .filter((row) => row.pokemon.some((counter) => counter.pokemonName === pokemonName))
        .map((row) => [row.playerId, row]));
      const current = new Map(visibleLive.map((row) => [row.player_id, row]));
      const historicalPlayerIds = [...earlier.values()].filter((row) => row.pokemon.some((counter) =>
        counter.pokemonName === pokemonName && ((counter.appearances ?? 0) > 0 || (counter.kos ?? 0) > 0),
      )).map((row) => row.playerId);
      const playerIds = [...new Set([...current.keys(), ...historicalPlayerIds])].filter((id) => !hidden.includes(id));
      const names = playerIds.length > 0 ? await resolvePlayerNames(playerIds) : {};
      result.players = playerIds.map((id): PokemonPlayerRow => {
        const live = current.get(id);
        const previous = earlier.get(id);
        const row = pokemonDetailStats(pokemonName, live ?? null, totalGames,
          previous ? { battleCount: historical.data?.battleCount ?? 0, pokemon: previous.pokemon, coverage: [] } : null,
          historical.history);
        return {
          player_id: id, player_name: names[id] ?? null,
          games: previous ? combinePokemonUsage(live ? [live] : [], totalGames, {
            battleCount: historical.data?.battleCount ?? 0, pokemon: previous.pokemon, coverage: [],
          }).find((entry) => entry.pokemon_name === pokemonName)?.total_games ?? null : live?.total_games ?? null,
          kos_dealt: row.kos_dealt, koed_rate: row.koed_rate,
          bring_rate: row.bring_rate, lead_rate: row.lead_rate, win_rate: row.win_rate,
        };
      });
    }

    return NextResponse.json<ApiResult<PokemonDetailStats>>(
      { success: true, data: result },
      { headers: packExtensions.historicalUsage ? CACHE.NONE : CACHE.STATS }
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
