import { NextRequest, NextResponse } from 'next/server';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readBoundedJsonOrEmpty } from '@/lib/format-studio/api-body';
import { presetForkSchema, validationFailedResponse } from '@/lib/format-studio/api-schemas';
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
 * is a 404 `format_preset_not_found`. The body is optional; its members are a slug and a Showdown format
 * (`showdown_format`, a catalog id) that is pre-picked on every stage of the copy.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requireAnyAdmin();
    const { presetId } = await params;

    const rate = await checkRateLimit('format-create', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = presetForkSchema.safeParse(await readBoundedJsonOrEmpty(request));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const forked = await forkPreset(player, presetId, { slug: parsed.data.slug, showdownFormat: parsed.data.showdown_format });
    expireFormatLibraryReads();

    logAuditEvent({
      action: 'format.fork',
      actor_id: player.playerId,
      actor_name: player.name,
      resource_type: 'format',
      resource_id: forked.definition.id,
      resource_name: forked.definition.slug,
      metadata: { preset_id: presetId, ...(parsed.data.showdown_format !== undefined && { showdown_format: parsed.data.showdown_format }) },
    });

    return NextResponse.json<ApiResult<CreatedFormat>>({ success: true, data: forked }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fork example format');
  }
}
