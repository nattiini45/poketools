import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { wikiNoteCreateSchema, formatZodErrors } from '@/lib/validation';
import { createNote } from '@/lib/supabase/queries/wiki-notes';
import { logAuditEvent } from '@/lib/audit/log';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import type { WikiNote, WikiNoteInsert } from '@/types/wiki';

export async function POST(request: NextRequest) {
  try {
    const player = await requirePlayer();

    const rateResult = await checkRateLimit('wiki-notes', player.playerId, { limit: 10, windowSeconds: 24 * 60 * 60 });
    if (!rateResult.allowed) return rateLimitedResponse(rateResult.retryAfterSeconds);

    const rawBody = await request.json();
    const zodResult = wikiNoteCreateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const note = await createNote(player.playerId, zodResult.data as unknown as WikiNoteInsert);
    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'wiki.note.create',
      resource_type: 'wiki_note',
      resource_id: note.id,
      resource_name: `${note.entity_type}:${note.entity_name}`,
      metadata: {
        entity_type: note.entity_type,
        entity_name: note.entity_name,
        moderation_flags: note.moderation_flags ?? [],
      },
      ip_address: request.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json<ApiResult<WikiNote>>(
      { success: true, data: note },
      { status: 201 },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create note');
  }
}
