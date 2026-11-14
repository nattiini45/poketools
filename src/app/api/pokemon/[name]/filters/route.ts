import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getAggregateScopesForPokemon,
  getPlayerIdsForPokemon,
} from '@/lib/supabase/queries/aggregates';
import { listSeasonsByIds } from '@/lib/supabase/queries/seasons';
import { listTournamentsByIds } from '@/lib/supabase/queries/tournaments';
import { getPlayersByIds } from '@/lib/supabase/queries/players';
import { readHistoricalUsage } from '@/lib/stats/historical-statistics';
import { CACHE } from '@/lib/api/cache';
import type { ApiResult } from '@/types/api';
import type { PokemonFilterOptions } from '@/types/game';

// Public — returns available filter options for a Pokémon's stats page.
// Reads pre-computed live and approved historical counters.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const pokemonName = decodeURIComponent(name);

  try {
    // Get all scopes where this Pokémon has aggregate data
    const [scopes, livePlayerIds, historical] = await Promise.all([
      getAggregateScopesForPokemon(pokemonName),
      getPlayerIdsForPokemon(pokemonName),
      readHistoricalUsage({ scopeType: 'all_time', scopeId: null }),
    ]);

    // Separate league and tournament scope_ids
    const leagueScopeIds = scopes
      .filter((s) => s.scope_type === 'league' && s.scope_id)
      .map((s) => s.scope_id as string);

    const tournamentScopeIds = scopes
      .filter((s) => s.scope_type === 'tournament' && s.scope_id)
      .map((s) => s.scope_id as string);

    const playerIds = [...new Set([
      ...livePlayerIds,
      ...(historical.data?.players ?? []).filter((player) => player.pokemon.some((counter) =>
        counter.pokemonName === pokemonName && ((counter.appearances ?? 0) > 0 || (counter.kos ?? 0) > 0),
      )).map((player) => player.playerId),
    ])];

    // Batch-fetch names in parallel via query modules
    const [allLeagues, allTournaments, playerMap] = await Promise.all([
      leagueScopeIds.length > 0 ? listSeasonsByIds(leagueScopeIds) : [],
      tournamentScopeIds.length > 0 ? listTournamentsByIds(tournamentScopeIds) : [],
      playerIds.length > 0 ? getPlayersByIds(playerIds) : new Map(),
    ]);

    const leagues = allLeagues.map((s) => ({ id: s.id, name: s.name }));

    // Only include standalone tournaments (not stages of a league)
    const tournaments = allTournaments
      .filter((t) => !t.season_id)
      .map((t) => ({ id: t.id, name: t.name }));

    const players = Array.from(playerMap.values())
      .map((p) => ({ id: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const result: PokemonFilterOptions = {
      leagues,
      tournaments,
      players,
    };

    return NextResponse.json<ApiResult<PokemonFilterOptions>>({
      success: true,
      data: result,
    }, { headers: CACHE.NONE });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch filter options');
  }
}
