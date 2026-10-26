import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { safeErrorResponse } from '@/lib/api/error-response';
import { assertEnvelopeDocument, readBoundedJson } from '@/lib/ruleset-studio/api-body';
import { rulesetDraftSchema, validationFailedResponse } from '@/lib/ruleset-studio/api-schemas';
import { requireRulesetViewer } from '@/lib/ruleset-studio/guards';
import { assertCanEditDraft, saveDraft, type SavedDraft } from '@/lib/ruleset-studio/library';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/ruleset-definitions/[id]/draft
 *
 * Owner, league admin of a league-owned ruleset or site admin. Saves the draft with a compare-and-set on `draft_rev`: a stale
 * revision answers 409 `ruleset_stale_revision` carrying the current revision. A draft may be invalid (the editor saves
 * half-built ones); the response carries the check. Draft saves are not audited. A saved draft changes no league: leagues pin
 * published versions.
 *
 * Order: guard, edit rule, rate limit, bounded body, document pre-check, envelope, then the database.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { player, definition, actor } = await requireRulesetViewer(id);
    assertCanEditDraft(actor, definition);

    const rate = await checkRateLimit('ruleset-draft', player.playerId, { limit: 300, windowSeconds: 10 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const raw = await readBoundedJson(request);
    assertEnvelopeDocument(raw);
    const parsed = rulesetDraftSchema.safeParse(raw);
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const saved = await saveDraft(definition, { draftRev: parsed.data.draft_rev, document: parsed.data.document });
    revalidatePath('/admin/rulesets');

    return NextResponse.json<ApiResult<SavedDraft>>({ success: true, data: saved });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to save ruleset draft');
  }
}
