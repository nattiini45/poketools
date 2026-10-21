import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { achievementCreateSchema, formatZodErrors } from '@/lib/validation';
import {
  createAchievementDefinition,
  listAchievementDefinitions,
  type AchievementDefinitionInput,
} from '@/lib/supabase/queries/achievements';
import { logAuditEvent } from '@/lib/audit/log';
import { expirePublicTags, publicTags } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { AchievementDefinition } from '@/types/achievement';

/** GET /api/admin/achievements - list all definitions */
export async function GET() {
  try {
    await requireAdmin();
    const achievements = await listAchievementDefinitions();
    return NextResponse.json<ApiResult<AchievementDefinition[]>>({
      success: true,
      data: achievements,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch achievement definitions');
  }
}

/** POST /api/admin/achievements - create a new definition */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const rawBody = await request.json();
    const zodResult = achievementCreateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const achievement = await createAchievementDefinition(zodResult.data as unknown as AchievementDefinitionInput);
    // Player profiles read the definitions from the public read cache.
    expirePublicTags([publicTags.achievements]);
    logAuditEvent({
      action: 'admin.achievement.create',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'achievement',
      resource_id: achievement.id,
      resource_name: zodResult.data.key,
      metadata: {
        category: zodResult.data.category,
      },
    });
    return NextResponse.json<ApiResult<AchievementDefinition>>(
      { success: true, data: achievement },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create achievement definition');
  }
}