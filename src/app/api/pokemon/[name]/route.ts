import { NextRequest, NextResponse } from 'next/server';
import { getSpecies, getSpeciesTypeInfo } from '@/lib/pkmn/dex';
import type { ApiResult } from '@/types/api';
import type { PokemonSpeciesInfo } from '@/types/game';

// Public: no auth required — returns species data from @pkmn/data (server-side only).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  const species = getSpecies(decodedName);

  if (!species) {
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

  const typeInfo = getSpeciesTypeInfo(species.name);
  const abilities: string[] = [];
  for (const key of ['0', '1', 'H', 'S'] as const) {
    const abilityName = species.abilities[key];
    if (abilityName) abilities.push(abilityName);
  }

  const data: PokemonSpeciesInfo = {
    name: species.name,
    types: typeInfo?.types ?? [],
    baseStats: {
      hp: species.baseStats.hp,
      atk: species.baseStats.atk,
      def: species.baseStats.def,
      spa: species.baseStats.spa,
      spd: species.baseStats.spd,
      spe: species.baseStats.spe,
    },
    abilities,
  };

  return NextResponse.json<ApiResult<PokemonSpeciesInfo>>({
    success: true,
    data,
  });
}
