import type { NextRequest } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { handleLegacyMatchDecision } from '@/lib/match/match-decisions';
import type { MatchDecisionRouteParams } from '@/lib/match/match-decisions-core';

export async function POST(request: NextRequest, context: MatchDecisionRouteParams) {
  try {
    const player = await requirePlayer();
    return handleLegacyMatchDecision(request, context, player);
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update match');
  }
}
