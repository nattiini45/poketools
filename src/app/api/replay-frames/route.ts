import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getReplayFrames } from '@/lib/pkmn/replay-frames';
import { checkPublicRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

/**
 * GET /api/replay-frames?url={replayUrl}
 *
 * Fetches a Pokémon Showdown replay and returns pre-computed battle frames
 * for turn-by-turn playback. No auth required — replays are public data.
 */
// Public: no auth required
export async function GET(request: NextRequest) {
  const rateResult = await checkPublicRateLimit('replay-frames', request, { limit: 30, windowSeconds: 60 });
  if (!rateResult.allowed) return rateLimitedResponse(rateResult.retryAfterSeconds);

  const url = request.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Missing required parameter: url', code: 'replay_url_missing' },
      { status: 400 }
    );
  }

  // Basic validation: must look like a Showdown replay URL or ID
  const isValidUrl = /^(https?:\/\/replay\.pokemonshowdown\.com\/)?[\w-]+$/.test(url);
  if (!isValidUrl) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Invalid replay URL or ID', code: 'replay_url_invalid' },
      { status: 400 }
    );
  }

  try {
    const result = await getReplayFrames(url);

    return NextResponse.json(result, {
      headers: {
        // Cache replay frames for 1 hour — replays are immutable
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to process replay');
  }
}
