import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readBoundedJsonOrEmpty } from '@/lib/ruleset-studio/api-body';
import { rulesetForkSchema, validationFailedResponse } from '@/lib/ruleset-studio/api-schemas';
import { canEditDraft } from '@/lib/ruleset-studio/access';
import { requireRulesetViewer } from '@/lib/ruleset-studio/guards';
import { forkDefinition, type CreatedRuleset } from '@/lib/ruleset-studio/library';
import { logAuditEvent } from '@/lib/audit/log';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/ruleset-definitions/[id]/fork
 *
 * Admin tiers, for a definition the caller may view. Copies the latest published document (the draft, for those who may edit
 * it when nothing is published) into a new private definition owned by the caller, with `identity.based_on` and `forked_from`
 * set. The body is optional; its only member is a slug.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { player, definition, actor } = await requireRulesetViewer(id);

    const rate = await checkRateLimit('ruleset-create', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = rulesetForkSchema.safeParse(await readBoundedJsonOrEmpty(request));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const forked = await forkDefinition(player, definition, canEditDraft(actor, definition), parsed.data.slug);
    revalidatePath('/admin/rulesets');

    logAuditEvent({
      action: 'ruleset.fork',
      actor_id: player.playerId,
      actor_name: player.name,
      resource_type: 'ruleset',
      resource_id: forked.definition.id,
      resource_name: forked.definition.slug,
      metadata: { forked_from: definition.id, source_slug: definition.slug },
    });

    return NextResponse.json<ApiResult<CreatedRuleset>>({ success: true, data: forked }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fork ruleset');
  }
}
