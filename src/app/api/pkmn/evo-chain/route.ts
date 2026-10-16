import { NextResponse } from 'next/server';
import { resolveEvoChain, searchBaseFormSpecies } from '@/lib/pkmn/dex';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';

/**
 * GET /api/pkmn/evo-chain?pokemon=charmander
 *   → Resolve the full 3-stage evolution chain for a Pokémon.
 *
 * GET /api/pkmn/evo-chain?q=char
 *   → Search for base-form Pokémon with 3-stage evolution lines.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pokemon = searchParams.get('pokemon');
    const query = searchParams.get('q');

    // Mode 1: Resolve specific chain
    if (pokemon) {
      const chain = resolveEvoChain(pokemon);
      if (!chain) {
        const error = `"${pokemon}" does not have a single 3-stage evolution line. It may be a 2-stage Pokémon, have branching evolutions (like Eevee), or not exist.`;
        return NextResponse.json<ApiResult<never>>(
          { success: false, error, code: 'evo_chain_unsupported', params: { pokemon } },
          { status: 400 }
        );
      }

      return NextResponse.json({ success: true, data: chain });
    }

    // Mode 2: Search base forms
    if (query && query.length >= 2) {
      const results = searchBaseFormSpecies(query);
      return NextResponse.json({ success: true, data: results });
    }

    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: 'Provide ?pokemon=name or ?q=search',
        code: 'validation_failed',
        params: { issues: 'Provide ?pokemon=name or ?q=search' },
      },
      { status: 400 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to resolve evolution chain');
  }
}
