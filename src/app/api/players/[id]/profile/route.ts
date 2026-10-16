import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { composePlayerProfile } from '@/lib/profile/compose';
import { toPublicPlayer } from '@/lib/players/public-player';
import type { ApiResult } from '@/types/api';
import type { PlayerProfile, PublicPlayerProfile } from '@/types/profile';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Any signed-in player can view any player's profile (stats, leagues,
 * matches, achievements). The player row in it is the full row only for the
 * player themself or a site admin, decided from the LIVE player `requireAuth`
 * returns (never the token copy). Everyone else gets the `PublicPlayer` card
 * (`toPublicPlayer`): no identity, moderation or admin columns.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    const profile = await composePlayerProfile(id);

    if (!profile) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Player not found', code: 'player_not_found' },
        { status: 404 }
      );
    }

    const viewer = session.player;
    const seesFullRow = viewer != null && (viewer.playerId === id || viewer.isAdmin === true);
    if (seesFullRow) {
      return NextResponse.json<ApiResult<PlayerProfile>>({ success: true, data: profile });
    }

    const publicProfile: PublicPlayerProfile = { ...profile, player: toPublicPlayer(profile.player) };
    return NextResponse.json<ApiResult<PublicPlayerProfile>>({ success: true, data: publicProfile });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch player profile');
  }
}
