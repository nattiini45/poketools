import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { wikiReportUpdateSchema, formatZodErrors } from '@/lib/validation';
import { updateNoteReportStatus } from '@/lib/supabase/queries/wiki-notes';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;

    const rawBody = await request.json();
    const zodResult = wikiReportUpdateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    await updateNoteReportStatus(id, zodResult.data.status);
    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'wiki.report.update',
      resource_type: 'wiki_note_report',
      resource_id: id,
      metadata: { status: zodResult.data.status },
      ip_address: request.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json<ApiResult<{ updated: true }>>({
      success: true,
      data: { updated: true },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update wiki report');
  }
}