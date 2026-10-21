import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getSpeedBenchmarks } from '@/lib/pkmn/speed-benchmarks';
import type { ApiResult } from '@/types/api';
import type { SpeedTiersResponse } from '@/types/speed';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format');

  if (!format) {
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: 'format query param is required',
        code: 'validation_failed',
        params: { issues: 'format query param is required' },
      },
      { status: 400 },
    );
  }

  const limit = parseInt(searchParams.get('limit') ?? '20', 10);
  const includeScarf = searchParams.get('include_scarf') !== 'false';
  const level = parseInt(searchParams.get('level') ?? '100', 10);
  const seasonId = searchParams.get('season_id') ?? undefined;

  try {
    const benchmarks = await getSpeedBenchmarks(format, {
      limit,
      includeScarf,
      level,
      seasonId,
    });

    const speeds = benchmarks.map((b) => b.speed);
    const minSpeed = Math.min(...speeds, 0);
    const maxSpeed = Math.max(...speeds, 1);

    // Compute common ranges using base speed thresholds
    const uninvested = benchmarks.filter((b) => b.evs === 0);
    const invested = benchmarks.filter((b) => b.evs === 252 && !b.item);
    const scarfed = benchmarks.filter((b) => b.item === 'Choice Scarf');

    // Mid tier: base speed 90-110 (invested)
    const midTier = invested.filter((b) => b.baseSpe >= 90 && b.baseSpe <= 110);
    // Fast tier: base speed 120+ (invested)
    const fastTier = invested.filter((b) => b.baseSpe >= 120);

    const safeRange = (arr: number[]): [number, number] => {
      if (arr.length === 0) return [0, 0];
      return [Math.min(...arr), Math.max(...arr)];
    };

    const response: SpeedTiersResponse = {
      format,
      benchmarks,
      min_speed: minSpeed,
      max_speed: maxSpeed,
      common_ranges: {
        slow: safeRange(uninvested.map((b) => b.speed)),
        mid: safeRange(midTier.map((b) => b.speed)),
        fast: safeRange(fastTier.map((b) => b.speed)),
        scarf: safeRange(scarfed.map((b) => b.speed)),
      },
    };

    return NextResponse.json<ApiResult<SpeedTiersResponse>>({
      success: true,
      data: response,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch speed tiers');
  }
}
