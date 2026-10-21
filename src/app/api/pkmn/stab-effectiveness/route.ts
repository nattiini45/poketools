import { NextRequest, NextResponse } from 'next/server';
import { getStabMultiplierBatch } from '@/lib/pkmn/dex';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';

interface StabPair {
  attacker: string;
  defender: string;
}

/** POST /api/pkmn/stab-effectiveness — Public: batch STAB multiplier lookup. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { pairs?: StabPair[]; gen?: number };
    const pairs = body.pairs;

    if (!Array.isArray(pairs) || pairs.length === 0 || pairs.length > 100) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Provide 1–100 { attacker, defender } pairs',
          code: 'validation_failed',
          params: { issues: 'Provide 1–100 { attacker, defender } pairs' },
        },
        { status: 400 },
      );
    }

    for (const pair of pairs) {
      if (typeof pair.attacker !== 'string' || typeof pair.defender !== 'string') {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: 'Each pair requires attacker and defender strings',
            code: 'validation_failed',
            params: { issues: 'Each pair requires attacker and defender strings' },
          },
          { status: 400 },
        );
      }
    }

    const gen = typeof body.gen === 'number' && body.gen >= 1 && body.gen <= 9 ? body.gen : 9;
    const multipliers = getStabMultiplierBatch(pairs, gen);

    return NextResponse.json<ApiResult<Record<string, number>>>({
      success: true,
      data: multipliers,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to compute STAB effectiveness');
  }
}
