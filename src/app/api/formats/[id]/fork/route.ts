import { NextRequest, NextResponse } from 'next/server';
import { requireFormatViewer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readBoundedJsonOrEmpty } from '@/lib/format-studio/api-body';
import { formatForkSchema, validationFailedResponse } from '@/lib/format-studio/api-schemas';
import { forkDefinition, type CreatedFormat } from '@/lib/format-studio/library';
import { logAuditEvent } from '@/lib/audit/log';
import { expireFormatLibraryReads } from '@/lib/revalidation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/formats/[id]/fork
 *
 * Admin tiers, for a definition the caller may view. Copies the latest published spec (the draft, for the owner
 * and site admins when nothing is published) into a new private definition owned by the caller, with
 * `identity.based_on` and `forked_from` set. The body is optional; its only member is a slug.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { player, definition } = await requireFormatViewer(id);

    const rate = await checkRateLimit('format-create', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = formatForkSchema.safeParse(await readBoundedJsonOrEmpty(request));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const forked = await forkDefinition(player, definition, parsed.data.slug);
    expireFormatLibraryReads();

    logAuditEvent({
      action: 'format.fork',
      actor_id: player.playerId,
      actor_name: player.name,
      resource_type: 'format',
      resource_id: forked.definition.id,
      resource_name: forked.definition.slug,
      metadata: { forked_from: definition.id, source_slug: definition.slug },
    });

    return NextResponse.json<ApiResult<CreatedFormat>>({ success: true, data: forked }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fork format');
  }
}
