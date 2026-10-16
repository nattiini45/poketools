import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { setPlayerWorldExperience } from '@/lib/supabase/queries/players';
import { safeErrorResponse } from '@/lib/api/error-response';
import { isWorldExperience, type WorldExperience } from '@/types/player';
import type { ApiResult } from '@/types/api';

/**
 * PATCH /api/account/world-experience
 *
 * Stores the signed-in player's 3D world experience preference
 * (`players.world_experience`): 'auto' (capability detection decides),
 * 'on' (always render the route tier — hard floors still apply) or 'off'
 * (always the simple Lite version).
 *
 * Ownership is by construction: the write targets `player.playerId` from the
 * session, never an id from the request body.
 */
export async function PATCH(request: NextRequest) {
  try {
    const player = await requirePlayer();

    // A literal `null` (or any non-object) JSON body parses successfully, so
    // the `.catch` fallback never fires for it — normalize every non-object
    // parse result onto the same 400 path instead of throwing a TypeError
    // (which would surface as a 500 through `safeErrorResponse`).
    const parsed: unknown = await request.json().catch(() => null);
    const rawBody = (
      parsed !== null && typeof parsed === 'object' ? parsed : {}
    ) as { worldExperience?: unknown };
    const worldExperience: unknown = rawBody.worldExperience;
    if (!isWorldExperience(worldExperience)) {
      // Distinct safe message for the only client-reachable failure cause —
      // not a generalized error (AGENTS.md Security Requirement 5).
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: "worldExperience must be one of 'auto', 'on' or 'off'.",
          code: 'world_experience_invalid',
        },
        { status: 400 }
      );
    }

    await setPlayerWorldExperience(player.playerId, worldExperience);

    return NextResponse.json<ApiResult<{ worldExperience: WorldExperience }>>({
      success: true,
      data: { worldExperience },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to save the 3D world setting', 500, 'world_experience_save_failed');
  }
}
