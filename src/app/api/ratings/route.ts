import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboardEntries } from '@/lib/supabase/queries/ratings';
import { publicReads } from '@/lib/cache/public-reads';
import { withoutHiddenPlayers } from '@/lib/players/hidden-players';
import { safeErrorResponse } from '@/lib/api/error-response';
import { cacheHeaders } from '@/lib/api/cache';
import type { ApiResult } from '@/types/api';
import type { RatingLeaderboardEntry } from '@/types/rating';

// Public: no auth required — leaderboard
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const minGamesRaw = searchParams.get('min_games');
    const parsedMinGames = minGamesRaw ? Number.parseInt(minGamesRaw, 10) : undefined;
    const minGames =
      Number.isFinite(parsedMinGames ?? Number.NaN) && (parsedMinGames ?? 0) >= 0
        ? parsedMinGames
        : undefined;

    const [entries, hidden] = await Promise.all([getLeaderboardEntries(minGames), publicReads.hiddenPlayerIds()]);
    const leaderboard = withoutHiddenPlayers(entries, hidden);

    return NextResponse.json<ApiResult<RatingLeaderboardEntry[]>>(
      { success: true, data: leaderboard },
      { headers: cacheHeaders(300, 60) }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch rating leaderboard');
  }
}
