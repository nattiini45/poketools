import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { importTeamSchema, formatZodErrors } from '@/lib/validation';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
import { parseTeamText } from '@/lib/pkmn/teams';
import { validateTeam } from '@/lib/pkmn/validation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import type { ImportTeamResponse } from '@/types/team';
import { IMPORT_TEAM_TEXT_MAX } from '@/lib/validation/schemas';

const POKEPASTE_FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetches a paste's raw text, bounded in time and size like pasted text.
 * Returns null on network error, timeout, non-2xx, or an oversized body;
 * each cause is logged distinctly (with the paste id) before returning.
 */
async function fetchPokepaste(pasteId: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`https://pokepast.es/${pasteId}/raw`, {
      signal: AbortSignal.timeout(POKEPASTE_FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (err) {
    console.error(`[api/import-team] pokepast.es fetch failed (network/timeout) for paste ${pasteId}:`, err);
    return null;
  }
  if (!res.ok) {
    console.error(`[api/import-team] pokepast.es returned HTTP ${res.status} for paste ${pasteId}`);
    return null;
  }
  const declared = parseInt(res.headers.get('content-length') ?? '0', 10);
  if (declared > IMPORT_TEAM_TEXT_MAX) {
    console.error(
      `[api/import-team] pokepast.es paste ${pasteId} declares Content-Length ${declared} > ${IMPORT_TEAM_TEXT_MAX}`
    );
    return null;
  }
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    console.error(`[api/import-team] pokepast.es body read failed for paste ${pasteId}:`, err);
    return null;
  }
  if (text.length > IMPORT_TEAM_TEXT_MAX) {
    console.error(
      `[api/import-team] pokepast.es paste ${pasteId} body is ${text.length} chars > ${IMPORT_TEAM_TEXT_MAX}`
    );
    return null;
  }
  return text;
}

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
      const fetched = await fetchPokepaste(pasteId);
      if (fetched === null) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Failed to fetch from pokepast.es', code: 'team_import_pokepaste_fetch_failed' },
          { status: 502 }
        );
      }
      rawText = fetched;
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
      // `ruleset_id` is the id of a ruleset version (the pin the team page was opened with), read only when that ruleset
      // is meant to be seen: the validation here agrees with `POST /api/validate-team` for the same id.
      const ruleset = await readExposedRuleset(body.ruleset_id);
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
