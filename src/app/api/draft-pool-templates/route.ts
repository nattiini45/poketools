import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { listTemplates, createTemplate } from '@/lib/supabase/queries/draft-pool-templates';
import type { ApiResult } from '@/types/api';
import type { DraftPoolTemplate } from '@/types/draft-pool';
import { draftPoolTemplateCreateSchema, formatZodErrors } from '@/lib/validation';

/**
 * GET /api/draft-pool-templates
 * List all draft pool templates.
 */
export async function GET(): Promise<NextResponse<ApiResult<DraftPoolTemplate[]>>> {
  try {
    await requireAuth();
    const templates = await listTemplates();
    return NextResponse.json({ success: true, data: templates });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch draft pool templates');
  }
}

/**
 * POST /api/draft-pool-templates
 * Create a new template. Admin only.
 * Body: { name, description?, pool_mode, entries }
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResult<DraftPoolTemplate>>> {
  try {
    const player = await requireAdmin();
    const rawBody = await request.json();
    const zodResult = draftPoolTemplateCreateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    const template = await createTemplate(body, player.playerId);
    return NextResponse.json({ success: true, data: template }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create draft pool template');
  }
}
