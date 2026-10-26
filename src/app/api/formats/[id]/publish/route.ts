import { NextRequest, NextResponse } from 'next/server';
import { requireFormatViewer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readBoundedJson } from '@/lib/format-studio/api-body';
import { formatPublishSchema, validationFailedResponse } from '@/lib/format-studio/api-schemas';
import { assertCanEditDraft, publish, type PublishedFormat } from '@/lib/format-studio/library';
import { logAuditEvent } from '@/lib/audit/log';
import { expireFormatLibraryReads } from '@/lib/revalidation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/formats/[id]/publish
 *
 * Owner or site admin. Publishes the draft as the next immutable version. Refused with 422
 * `format_publish_invalid` when the draft has an error diagnostic, 409 `format_stale_revision` when the client
 * saw an older draft revision, 409 `format_nothing_to_publish` when nothing changed since the latest version,
 * and 403 `format_published_locked` for a gallery format (site admins publish those).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { player, definition } = await requireFormatViewer(id);
    assertCanEditDraft(player, definition);

    const rate = await checkRateLimit('format-publish', player.playerId, { limit: 30, windowSeconds: 60 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = formatPublishSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const published = await publish(player, definition, {
      draftRev: parsed.data.draft_rev,
      changelog: parsed.data.changelog ?? null,
    });
    expireFormatLibraryReads();

    logAuditEvent({
      action: 'format.publish',
      actor_id: player.playerId,
      actor_name: player.name,
      resource_type: 'format',
      resource_id: definition.id,
      resource_name: definition.slug,
      metadata: { version_no: published.version.version_no, content_hash: published.version.content_hash },
    });

    return NextResponse.json<ApiResult<PublishedFormat>>({ success: true, data: published }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to publish format');
  }
}
