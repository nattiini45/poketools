import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getAggregateScopesForPokemon,
  getPlayerIdsForPokemon,
} from '@/lib/supabase/queries/aggregates';
import { listSeasonsByIds } from '@/lib/supabase/queries/seasons';
import { listTournamentsByIds } from '@/lib/supabase/queries/tournaments';
import { getPlayersByIds } from '@/lib/supabase/queries/players';
import type { ApiResult } from '@/types/api';
import type { PokemonFilterOptions } from '@/types/game';

// Public — returns available filter options for a Pokémon's stats page.
// Reads from pre-computed aggregates only (CLAUDE.md rule #4).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const pokemonName = decodeURIComponent(name);

  try {
    // Get all scopes where this Pokémon has aggregate data
    const scopes = await getAggregateScopesForPokemon(pokemonName);

    // Separate league and tournament scope_ids
    const leagueScopeIds = scopes
      .filter((s) => s.scope_type === 'league' && s.scope_id)
      .map((s) => s.scope_id as string);

    const tournamentScopeIds = scopes
      .filter((s) => s.scope_type === 'tournament' && s.scope_id)
      .map((s) => s.scope_id as string);

    const playerIds = await getPlayerIdsForPokemon(pokemonName);

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
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch filter options');
  }
}
