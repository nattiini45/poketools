import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { wikiNoteReportSchema, formatZodErrors } from '@/lib/validation';
import { createNoteReport, getNoteById } from '@/lib/supabase/queries/wiki-notes';
import { logAuditEvent } from '@/lib/audit/log';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import type { WikiNoteReport } from '@/types/wiki';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;

    const rateResult = checkRateLimit(`wiki-report:${player.playerId}`, 10, 24 * 60 * 60 * 1000);
    if (!rateResult.allowed) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `Rate limit exceeded. Try again in ${rateResult.retryAfterSeconds}s.`,
          code: 'rate_limited',
          params: { seconds: rateResult.retryAfterSeconds },
        },
        { status: 429, headers: { 'Retry-After': String(rateResult.retryAfterSeconds) } }
      );
    }

    const rawBody = await request.json();
    const zodResult = wikiNoteReportSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const note = await getNoteById(id);
    if (!note || !note.approved) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Note not found', code: 'wiki_note_not_found' },
        { status: 404 },
      );
    }

    const report = await createNoteReport(
      player.playerId,
      id,
      zodResult.data.reason,
      zodResult.data.details,
    );

    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'wiki.note.report',
      resource_type: 'wiki_note',
      resource_id: id,
      resource_name: `${note.entity_type}:${note.entity_name}`,
      metadata: { reason: report.reason },
      ip_address: request.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json<ApiResult<WikiNoteReport>>(
      { success: true, data: report },
      { status: 201 },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to report note');
  }
}