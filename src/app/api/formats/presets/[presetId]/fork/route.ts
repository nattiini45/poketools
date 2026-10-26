import { NextRequest, NextResponse } from 'next/server';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readBoundedJsonOrEmpty } from '@/lib/format-studio/api-body';
import { formatForkSchema, validationFailedResponse } from '@/lib/format-studio/api-schemas';
import { forkPreset, type CreatedFormat } from '@/lib/format-studio/library';
import { logAuditEvent } from '@/lib/audit/log';
import { expireFormatLibraryReads } from '@/lib/revalidation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ presetId: string }>;
}

/**
 * POST /api/formats/presets/[presetId]/fork
 *
 * Admin tiers only. Copies one of the shipped example formats (a code constant, not a stored row) into a new
 * private definition owned by the caller, with `identity.based_on` set to the example's id. An unknown example
 * is a 404 `format_preset_not_found`. The body is optional; its only member is a slug.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requireAnyAdmin();
    const { presetId } = await params;

    const rate = await checkRateLimit('format-create', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = formatForkSchema.safeParse(await readBoundedJsonOrEmpty(request));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const forked = await forkPreset(player, presetId, parsed.data.slug);
    expireFormatLibraryReads();

    logAuditEvent({
      action: 'format.fork',
      actor_id: player.playerId,
      actor_name: player.name,
      resource_type: 'format',
      resource_id: forked.definition.id,
      resource_name: forked.definition.slug,
      metadata: { preset_id: presetId },
    });

    return NextResponse.json<ApiResult<CreatedFormat>>({ success: true, data: forked }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fork example format');
  }
}
