import { NextRequest, NextResponse } from 'next/server';
import { requireCreator } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getPresetsByOwner,
  createPreset,
} from '@/lib/supabase/queries/broadcast-presets';
import type { ApiResult } from '@/types/api';
import type { BroadcastPreset } from '@/types/broadcast';
import type { BroadcastPresetType } from '@/types/broadcast';
import { broadcastPresetCreateSchema, formatZodErrors } from '@/lib/validation';

/** GET /api/broadcast/presets — list presets for the current creator */
export async function GET() {
  try {
    const player = await requireCreator();
    const presets = await getPresetsByOwner(player.playerId);
    return NextResponse.json<ApiResult<BroadcastPreset[]>>({
      success: true,
      data: presets,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to list broadcast presets');
  }
}

/** POST /api/broadcast/presets — create a new preset */
export async function POST(request: NextRequest) {
  try {
    const player = await requireCreator();
    const rawBody = await request.json();
    const zodResult = broadcastPresetCreateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    const preset = await createPreset({
      name: body.name,
      owner_id: player.playerId,
      preset_type: body.preset_type as BroadcastPresetType,
      config: body.config,
    });

    return NextResponse.json<ApiResult<BroadcastPreset>>({
      success: true,
      data: preset,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create broadcast preset');
  }
}
