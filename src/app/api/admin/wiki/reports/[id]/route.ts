import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { wikiReportUpdateSchema, formatZodErrors } from '@/lib/validation';
import { updateNoteReportStatus } from '@/lib/supabase/queries/wiki-notes';
import { logAuditEvent } from '@/lib/audit/log';
import { logger } from '@/lib/logger';
import { noteReportMachine } from '@/lib/wiki/note-report-state';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { bindScopedPhaseWikiServices, resolveWikiReportWrite } from '@/lib/wiki/native-phase-services';

const nativeCloseSchema = wikiReportUpdateSchema.extend({
  expected_status: wikiReportUpdateSchema.shape.status,
  expected_updated_at: z.iso.datetime({ offset: true }),
}).strict();

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_WIKI_REPORT_ID');
    if (invalidId) return invalidId;

    const rawBody = await request.json();
    const zodResult = wikiReportUpdateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const to = zodResult.data.status;
    const target = await resolveWikiReportWrite(id);
    if (target.kind === 'phase') {
      const parsed = nativeCloseSchema.safeParse(rawBody);
      if (!parsed.success) {
        const issues = formatZodErrors(parsed.error);
        throw new UserFacingError(issues, { code: 'validation_failed', params: { issues } });
      }
      const { owner } = target;
      await bindScopedPhaseWikiServices({ owner, player: admin }, request).closeReport(owner.phase_id, id.toLowerCase(), to, {
        status: parsed.data.expected_status, updatedAt: parsed.data.expected_updated_at,
      });
      return NextResponse.json<ApiResult<{ updated: true }>>({ success: true, data: { updated: true } });
    }
    const from = target.status;
    if (!from) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Report not found', code: 'wiki_report_not_found' },
        { status: 404 },
      );
    }
    noteReportMachine.assertTransition(from, to, 'admin');
    if (!(await updateNoteReportStatus(id, to, from))) {
      logger.warn('api/admin/wiki/reports', 'report update refused: the status changed since it was read', { reportId: id, from, to });
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Another moderator already closed this report. Reload to see its current status.',
          code: 'wiki_report_changed',
        },
        { status: 409 },
      );
    }
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
