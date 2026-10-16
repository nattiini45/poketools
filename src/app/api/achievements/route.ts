import { NextResponse } from 'next/server';
import { listAchievementDefinitions } from '@/lib/supabase/queries/achievements';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';
import type { AchievementDefinition } from '@/types/achievement';

// Public achievement catalog (non-hidden only)
export async function GET() {
  try {
    const definitions = await listAchievementDefinitions();
    const visible = definitions.filter((definition) => !definition.hidden);

    return NextResponse.json<ApiResult<AchievementDefinition[]>>({
      success: true,
      data: visible,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch achievements');
  }
}
