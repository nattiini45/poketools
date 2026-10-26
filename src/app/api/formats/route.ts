import { NextRequest, NextResponse } from 'next/server';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { assertEnvelopeDocument, readBoundedJson } from '@/lib/format-studio/api-body';
import {
  formatCreateSchema,
  formatListQuerySchema,
  validationFailedResponse,
} from '@/lib/format-studio/api-schemas';
import { createFromBody, toActor, type CreatedFormat } from '@/lib/format-studio/library';
import type { FormatDefinitionSummary, FormatGalleryItem } from '@/lib/format-studio/library-types';
import { logAuditEvent } from '@/lib/audit/log';
import { formatReads } from '@/lib/cache/format-reads';
import { expireFormatLibraryReads } from '@/lib/revalidation';
import { listFormatDefinitions } from '@/lib/supabase/queries/format-definitions';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

export interface FormatListResult {
  items: FormatDefinitionSummary[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * GET /api/formats
 *
 * Admin tiers only. Lists the formats the caller may see: their own, and those shared with all admins
 * (`league` or `gallery`); site admins see every row. `scope=gallery` answers from the cached shelf of
 * published gallery formats, which holds no owner and no draft.
 */
export async function GET(request: NextRequest) {
  try {
    const player = await requireAnyAdmin();

    const parsed = formatListQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) return validationFailedResponse(parsed.error);
    const query = parsed.data;

    if (query.scope === 'gallery') {
      const items = await formatReads.gallery();
      return NextResponse.json<ApiResult<{ items: FormatGalleryItem[] }>>({ success: true, data: { items } });
    }

    const { items, total } = await listFormatDefinitions({
      actor: toActor(player),
      scope: query.scope,
      visibility: query.visibility,
      kind: query.kind,
      limit: query.limit,
      offset: query.offset,
    });
    return NextResponse.json<ApiResult<FormatListResult>>({
      success: true,
      data: { items, total, limit: query.limit, offset: query.offset },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to list formats');
  }
}

/**
 * POST /api/formats
 *
 * Admin tiers only. Creates a private custom format owned by the caller, from a whole document or from a name.
 * Order: guard, rate limit, bounded body, document pre-check, envelope, then the database.
 */
export async function POST(request: NextRequest) {
  try {
    const player = await requireAnyAdmin();

    const rate = await checkRateLimit('format-create', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const raw = await readBoundedJson(request);
    assertEnvelopeDocument(raw);
    const parsed = formatCreateSchema.safeParse(raw);
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const created = await createFromBody(player, parsed.data);
    expireFormatLibraryReads();

    logAuditEvent({
      action: 'format.create',
      actor_id: player.playerId,
      actor_name: player.name,
      resource_type: 'format',
      resource_id: created.definition.id,
      resource_name: created.definition.slug,
    });

    return NextResponse.json<ApiResult<CreatedFormat>>({ success: true, data: created }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create format');
  }
}
