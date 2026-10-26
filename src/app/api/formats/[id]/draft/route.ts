import { NextRequest, NextResponse } from 'next/server';
import { requireFormatViewer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { assertEnvelopeDocument, readBoundedJson } from '@/lib/format-studio/api-body';
import { formatDraftSchema, validationFailedResponse } from '@/lib/format-studio/api-schemas';
import { assertCanEditDraft, saveDraft, type SavedDraft } from '@/lib/format-studio/library';
import { expireFormatLibraryReads } from '@/lib/revalidation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/formats/[id]/draft
 *
 * Owner or site admin. Saves the draft with a compare-and-set on `draft_rev`: a stale revision answers 409
 * `format_stale_revision` carrying the current revision. A draft may be an invalid format (the editor saves
 * half-built ones); the response carries the check. Draft saves are not audited.
 *
 * Order: guard, edit rule, rate limit, bounded body, document pre-check, envelope, then the database.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { player, definition } = await requireFormatViewer(id);
    assertCanEditDraft(player, definition);

    const rate = await checkRateLimit('format-draft', player.playerId, { limit: 300, windowSeconds: 10 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const raw = await readBoundedJson(request);
    assertEnvelopeDocument(raw);
    const parsed = formatDraftSchema.safeParse(raw);
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const saved = await saveDraft(definition, { draftRev: parsed.data.draft_rev, document: parsed.data.document });
    expireFormatLibraryReads();

    return NextResponse.json<ApiResult<SavedDraft>>({ success: true, data: saved });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to save format draft');
  }
}
