import { NextRequest, NextResponse } from 'next/server';
import { requireCreator } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getPresetById,
  updatePreset,
  deletePreset,
} from '@/lib/supabase/queries/broadcast-presets';
import type { ApiResult } from '@/types/api';
import type { BroadcastPreset } from '@/types/broadcast';
import { broadcastPresetUpdateSchema, formatZodErrors } from '@/lib/validation';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

type RouteParams = { params: Promise<{ id: string }> };

/** PATCH /api/broadcast/presets/[id] — update preset name or config */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requireCreator();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_PRESET_ID');
    if (invalidId) return invalidId;

    const existing = await getPresetById(id);
    if (!existing) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Preset not found', code: 'preset_not_found' },
        { status: 404 }
      );
    }
    if (existing.owner_id !== player.playerId && !player.isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Not authorized to update this preset', code: 'preset_update_forbidden' },
        { status: 403 }
      );
    }

    const rawBody = await request.json();
    const zodResult = broadcastPresetUpdateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    const updates: Partial<Pick<BroadcastPreset, 'name' | 'config'>> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.config !== undefined) updates.config = body.config;

    const updated = await updatePreset(id, updates);
    return NextResponse.json<ApiResult<BroadcastPreset>>({
      success: true,
      data: updated,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update broadcast preset');
  }
}

/** DELETE /api/broadcast/presets/[id] — delete a preset */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requireCreator();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_PRESET_ID');
    if (invalidId) return invalidId;

    const existing = await getPresetById(id);
    if (!existing) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Preset not found', code: 'preset_not_found' },
        { status: 404 }
      );
    }
    if (existing.owner_id !== player.playerId && !player.isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Not authorized to delete this preset', code: 'preset_delete_forbidden' },
        { status: 403 }
      );
    }

    await deletePreset(id);
    return NextResponse.json<ApiResult<{ deleted: true }>>({
      success: true,
      data: { deleted: true },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete broadcast preset');
  }
}
