import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getTrainerAvatar3D, upsertTrainerAvatar3D } from '@/lib/supabase/queries/trainer-avatars-3d';
import type { ApiResult } from '@/types/api';
import type { TrainerConfig } from '@/lib/draft-room/trainer-config';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_HAIR = 5;
const MAX_HAT = 4;

function validateConfig(body: unknown): TrainerConfig | null {
  if (!body || typeof body !== 'object') return null;
  const c = body as Record<string, unknown>;

  const str = (v: unknown): v is string => typeof v === 'string';
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

  if (!str(c.skinTone) || !HEX_RE.test(c.skinTone)) return null;
  if (!num(c.hairStyle) || c.hairStyle < 0 || c.hairStyle > MAX_HAIR) return null;
  if (!str(c.hairColor) || !HEX_RE.test(c.hairColor)) return null;
  if (!str(c.outfitColor) || !HEX_RE.test(c.outfitColor)) return null;
  if (!str(c.pantsColor) || !HEX_RE.test(c.pantsColor)) return null;
  if (!num(c.hatStyle) || c.hatStyle < 0 || c.hatStyle > MAX_HAT) return null;
  if (!str(c.hatColor) || !HEX_RE.test(c.hatColor)) return null;
  if (!str(c.teamColor) || !HEX_RE.test(c.teamColor)) return null;

  return {
    skinTone: c.skinTone,
    hairStyle: c.hairStyle,
    hairColor: c.hairColor,
    outfitColor: c.outfitColor,
    pantsColor: c.pantsColor,
    hatStyle: c.hatStyle,
    hatColor: c.hatColor,
    teamColor: c.teamColor,
  };
}

/**
 * GET /api/avatar/3d
 * Returns the authenticated player's 3D trainer config.
 */
export async function GET() {
  try {
    const session = await requireAuth();
    const playerId = session.player?.playerId;
    if (!playerId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Player registration required', code: 'player_registration_required' },
        { status: 403 }
      );
    }

    const config = await getTrainerAvatar3D(playerId);

    return NextResponse.json<ApiResult<{ config: TrainerConfig | null }>>({
      success: true,
      data: { config },
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch 3D avatar');
  }
}

/**
 * PUT /api/avatar/3d
 * Saves the authenticated player's 3D trainer config.
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireAuth();
    const playerId = session.player?.playerId;
    if (!playerId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Player registration required', code: 'player_registration_required' },
        { status: 403 }
      );
    }

    // A literal JSON `null` body parses successfully to null — guard before
    // reading fields so an invalid/missing body yields a 400, not a 500.
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Request body must be a JSON object', code: 'invalid_json' },
        { status: 400 }
      );
    }

    // Validate ownership: can only save own avatar
    const targetPlayerId = (body as Record<string, unknown>).player_id;
    if (targetPlayerId && targetPlayerId !== playerId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Cannot modify another player\'s avatar', code: 'avatar_3d_not_owned' },
        { status: 403 }
      );
    }

    const config = validateConfig((body as Record<string, unknown>).config);
    if (!config) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Invalid avatar configuration', code: 'avatar_3d_config_invalid' },
        { status: 400 }
      );
    }

    await upsertTrainerAvatar3D(playerId, config);

    return NextResponse.json<ApiResult<{ saved: true }>>({
      success: true,
      data: { saved: true },
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to save 3D avatar', 500, 'avatar_3d_save_failed');
  }
}
