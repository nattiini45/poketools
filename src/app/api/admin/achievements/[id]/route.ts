import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { achievementUpdateSchema, formatZodErrors } from '@/lib/validation';
import {
  deleteAchievementDefinition,
  getAchievementDefinition,
  updateAchievementDefinition,
  type AchievementDefinitionInput,
} from '@/lib/supabase/queries/achievements';
import { logAuditEvent } from '@/lib/audit/log';
import { expirePublicTags, publicTags } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { AchievementDefinition } from '@/types/achievement';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** PATCH /api/admin/achievements/:id - update a definition */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_ACHIEVEMENT_ID');
    if (invalidId) return invalidId;
    const rawBody = await request.json();
    const zodResult = achievementUpdateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const updated = await updateAchievementDefinition(id, zodResult.data as unknown as Partial<AchievementDefinitionInput>);
    // Player profiles read the definitions from the public read cache.
    expirePublicTags([publicTags.achievements]);
    logAuditEvent({
      action: 'admin.achievement.update',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'achievement',
      resource_id: id,
      resource_name: updated.key,
      metadata: { updated_fields: Object.keys(zodResult.data) },
    });
    return NextResponse.json<ApiResult<AchievementDefinition>>({
      success: true,
      data: updated,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update achievement definition');
  }
}

/** DELETE /api/admin/achievements/:id - delete a definition */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_ACHIEVEMENT_ID');
    if (invalidId) return invalidId;
    const existing = await getAchievementDefinition(id);
    await deleteAchievementDefinition(id);
    expirePublicTags([publicTags.achievements]);
    logAuditEvent({
      action: 'admin.achievement.delete',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'achievement',
      resource_id: id,
      resource_name: existing?.key ?? id,
    });
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete achievement definition');
  }
}
