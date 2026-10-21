import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { importTeamSchema, formatZodErrors } from '@/lib/validation';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { parseTeamText } from '@/lib/pkmn/teams';
import { validateTeam } from '@/lib/pkmn/validation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import type { ImportTeamResponse } from '@/types/team';

export async function POST(request: NextRequest) {
  try {
    const player = await requirePlayer();

    const rateResult = await checkRateLimit('import-team', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
    if (!rateResult.allowed) return rateLimitedResponse(rateResult.retryAfterSeconds);

    const rawBody = await request.json();
    const zodResult = importTeamSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const body = zodResult.data;
    let rawText = body.text ?? '';

    // Fetch from pokepast.es if URL provided
    if (body.url) {
      const pokepastMatch = body.url.match(/pokepast\.es\/([a-zA-Z0-9]+)/);
      if (!pokepastMatch) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Invalid pokepast.es URL', code: 'team_import_pokepaste_url_invalid' },
          { status: 400 }
        );
      }
      const pasteId = pokepastMatch[1];
      const res = await fetch(`https://pokepast.es/${pasteId}/raw`);
      if (!res.ok) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Failed to fetch from pokepast.es', code: 'team_import_pokepaste_fetch_failed' },
          { status: 502 }
        );
      }
      rawText = await res.text();
    }

    // Parse the team
    const pokemon = parseTeamText(rawText);
    if (pokemon.length === 0) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Could not parse any Pokémon from the provided text',
          code: 'team_import_no_pokemon',
        },
        { status: 400 }
      );
    }

    // Optionally validate against a ruleset
    let validation = null;
    if (body.ruleset_id) {
      const ruleset = await getRulesetById(body.ruleset_id);
      if (!ruleset) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Ruleset not found', code: 'ruleset_not_found' },
          { status: 404 }
        );
      }
      validation = validateTeam(pokemon, ruleset);
    }

    const result: ImportTeamResponse = { pokemon, validation };
    return NextResponse.json<ApiResult<ImportTeamResponse>>({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to import team');
  }
}
