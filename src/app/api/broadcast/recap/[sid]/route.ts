import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { composeWeeklyRecap } from '@/lib/broadcast/recap-engine';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { isLocale } from '@/i18n/config';
import { resolveContentLocale } from '@/i18n/content-locale';
import type { ApiResult } from '@/types/api';
import type { EnrichedRecap } from '@/types/broadcast';

interface RouteContext {
  params: Promise<{ sid: string }>;
}

/**
 * GET /api/broadcast/recap/[sid]?tournament_id=X&round_id=Y[&lang=en|de]
 * Public endpoint for recap overlay data.
 * Requires tournament_id and round_id query params to scope the recap.
 * Generated recap text follows `?lang=` when it is a supported locale, else
 * the league's content language (OBS overlays have no viewer cookie).
 *
 * Returns EnrichedRecap with full match data, team rosters, pokemon scores,
 * stat leaders, standings movement, and pokemon usage stats.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { sid } = await context.params;
    const tournamentId = request.nextUrl.searchParams.get('tournament_id');
    const roundId = request.nextUrl.searchParams.get('round_id');
    const lang = request.nextUrl.searchParams.get('lang');

    if (!tournamentId || !roundId) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'tournament_id and round_id query parameters are required',
          code: 'recap_params_required',
        },
        { status: 400 }
      );
    }

    // Look up entities for display names
    const [season, tournament, round] = await Promise.all([
      getSeasonById(sid),
      getTournamentById(tournamentId),
      getRoundById(roundId),
    ]);

    if (!season) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Season not found', code: 'season_not_found' },
        { status: 404 }
      );
    }
    if (!tournament) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament not found', code: 'tournament_not_found' },
        { status: 404 }
      );
    }
    if (!round) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Round not found', code: 'round_not_found' },
        { status: 404 }
      );
    }

    const locale = isLocale(lang) ? lang : await resolveContentLocale({ seasonId: sid });

    const recap = await composeWeeklyRecap({
      seasonId: sid,
      leagueName: season.name,
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      roundId: round.id,
      roundName: round.name,
      roundNumber: round.round_number,
      locale,
    });

    return NextResponse.json<ApiResult<EnrichedRecap>>({
      success: true,
      data: recap,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to generate broadcast recap');
  }
}
