import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readBoundedJson } from '@/lib/ruleset-studio/api-body';
import { rulesetPublishSchema, validationFailedResponse } from '@/lib/ruleset-studio/api-schemas';
import { requireRulesetViewer } from '@/lib/ruleset-studio/guards';
import { assertCanEditDraft, publish, type PublishedRuleset } from '@/lib/ruleset-studio/library';
import { logAuditEvent } from '@/lib/audit/log';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/ruleset-definitions/[id]/publish
 *
 * Owner, league admin of a league-owned ruleset or site admin (a gallery ruleset: site admins only). Publishes the draft as
 * the next immutable version after a clean compile, with the effective rules computed once and frozen in the version. Leagues
 * keep the version they pin: moving them is `POST .../pins`.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { player, definition, actor } = await requireRulesetViewer(id);
    assertCanEditDraft(actor, definition);

    const rate = await checkRateLimit('ruleset-publish', player.playerId, { limit: 30, windowSeconds: 60 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = rulesetPublishSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const published = await publish(
      player,
      definition,
      { draftRev: parsed.data.draft_rev, changelog: parsed.data.changelog ?? null },
      actor.leagueIds,
    );
    revalidatePath('/admin/rulesets');

    logAuditEvent({
      action: 'ruleset.publish',
      actor_id: player.playerId,
      actor_name: player.name,
      resource_type: 'ruleset',
      resource_id: definition.id,
      resource_name: definition.slug,
      metadata: {
        version_no: published.version.version_no,
        content_hash: published.version.content_hash,
        resolved_hash: published.version.resolved_hash,
      },
    });

    return NextResponse.json<ApiResult<PublishedRuleset>>({ success: true, data: published }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to publish ruleset');
  }
}
