import { NextRequest, NextResponse } from 'next/server';
import { requireFormatViewer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readBoundedJson } from '@/lib/format-studio/api-body';
import { formatVisibilitySchema, validationFailedResponse } from '@/lib/format-studio/api-schemas';
import {
  assertCanEditDraft,
  changeVisibility,
  getFormatDetail,
  removeDefinition,
} from '@/lib/format-studio/library';
import type { FormatDefinitionDetail, FormatDefinitionSummary } from '@/lib/format-studio/library-types';
import { logAuditEvent } from '@/lib/audit/log';
import { expireFormatLibraryReads } from '@/lib/revalidation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const WRITE_LIMIT = { limit: 60, windowSeconds: 60 * 60 } as const;

/**
 * GET /api/formats/[id]
 *
 * Admin tiers only, and only for a definition the caller may view (their own, shared with all admins, or any
 * for a site admin). The draft, the version list and the check of the draft are for the owner and site admins.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { player, definition } = await requireFormatViewer(id);
    const detail = await getFormatDetail(player, definition);
    return NextResponse.json<ApiResult<FormatDefinitionDetail>>({ success: true, data: detail });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load format');
  }
}

/**
 * PATCH /api/formats/[id]
 *
 * Changes the visibility. The owner moves a custom format between `private` and `league`; `gallery`, and any
 * change of a gallery or preset row, is for site admins. Sharing needs a published version.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { player, definition } = await requireFormatViewer(id);

    const rate = await checkRateLimit('format-write', player.playerId, WRITE_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = formatVisibilitySchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const updated = await changeVisibility(player, definition, parsed.data.visibility);
    expireFormatLibraryReads();

    logAuditEvent({
      action: 'format.visibility',
      actor_id: player.playerId,
      actor_name: player.name,
      resource_type: 'format',
      resource_id: definition.id,
      resource_name: definition.slug,
      changes: { visibility: { before: definition.visibility, after: updated.visibility } },
    });

    return NextResponse.json<ApiResult<{ definition: FormatDefinitionSummary }>>({
      success: true,
      data: { definition: updated },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update format');
  }
}

/**
 * DELETE /api/formats/[id]
 *
 * Owner or site admin. Only a definition that was never published and is attached nowhere can be deleted.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { player, definition } = await requireFormatViewer(id);
    assertCanEditDraft(player, definition);

    const rate = await checkRateLimit('format-write', player.playerId, WRITE_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    await removeDefinition(player, definition);
    expireFormatLibraryReads();

    logAuditEvent({
      action: 'format.delete',
      actor_id: player.playerId,
      actor_name: player.name,
      resource_type: 'format',
      resource_id: definition.id,
      resource_name: definition.slug,
    });

    return NextResponse.json<ApiResult<{ deleted: true }>>({ success: true, data: { deleted: true } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete format');
  }
}
