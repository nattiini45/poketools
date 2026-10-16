import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getTemplate, deleteTemplate } from '@/lib/supabase/queries/draft-pool-templates';
import type { ApiResult } from '@/types/api';
import type { DraftPoolTemplate } from '@/types/draft-pool';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/draft-pool-templates/[id]
 * Get a single template with its entries.
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<DraftPoolTemplate>>> {
  try {
    await requireAdmin();
    const { id } = await params;
    const template = await getTemplate(id);
    if (!template) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Template not found', code: 'pool_template_not_found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: template });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch draft pool template');
  }
}

/**
 * DELETE /api/draft-pool-templates/[id]
 * Delete a template. Admin only.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<null>>> {
  try {
    await requireAdmin();
    const { id } = await params;
    const template = await getTemplate(id);
    if (!template) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Template not found', code: 'pool_template_not_found' },
        { status: 404 }
      );
    }
    await deleteTemplate(id);
    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete draft pool template');
  }
}
