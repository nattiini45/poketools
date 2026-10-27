import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { safeErrorResponse } from '@/lib/api/error-response';
import { leagueTrashBlockError } from '@/lib/league-trash/errors';
import { readBoundedJson } from '@/lib/ruleset-studio/api-body';
import { rulesetVisibilitySchema, validationFailedResponse } from '@/lib/ruleset-studio/api-schemas';
import { requireRulesetViewer } from '@/lib/ruleset-studio/guards';
import { assertCanEditDraft, changeVisibility, getRulesetDetail, removeDefinition } from '@/lib/ruleset-studio/library';
import type { RulesetDefinitionDetail, RulesetDefinitionSummary } from '@/lib/ruleset-studio/library-types';
import { logAuditEvent } from '@/lib/audit/log';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const WRITE_LIMIT = { limit: 60, windowSeconds: 60 * 60 } as const;

/**
 * GET /api/ruleset-definitions/[id]
 *
 * Admin tiers, for a definition the caller may view. The summary and the latest published version; the draft, the version
 * list and the draft check only for those who may edit it.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { actor, definition } = await requireRulesetViewer(id);
    const detail = await getRulesetDetail(actor, definition);
    return NextResponse.json<ApiResult<RulesetDefinitionDetail>>({ success: true, data: detail });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load ruleset');
  }
}

/**
 * PATCH /api/ruleset-definitions/[id]
 *
 * Changes the visibility. Site admins: any change. An owner: private <-> league. Sharing needs a published version.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { player, definition } = await requireRulesetViewer(id);

    const rate = await checkRateLimit('ruleset-write', player.playerId, WRITE_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = rulesetVisibilitySchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const updated = await changeVisibility(player, definition, parsed.data.visibility);
    revalidatePath('/admin/rulesets');

    logAuditEvent({
      action: 'ruleset.visibility',
      actor_id: player.playerId,
      actor_name: player.name,
      resource_type: 'ruleset',
      resource_id: definition.id,
      resource_name: definition.slug,
      changes: { visibility: { before: definition.visibility, after: updated.visibility } },
    });

    return NextResponse.json<ApiResult<{ definition: RulesetDefinitionSummary }>>({
      success: true,
      data: { definition: updated },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update ruleset');
  }
}

/**
 * DELETE /api/ruleset-definitions/[id]
 *
 * Owner (or league admin of a league-owned ruleset) or site admin. A ruleset that a league or phase pins answers 409
 * `ruleset_in_use` with the number of pins; a league in the trash that still uses it answers its own 409.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { player, definition, actor } = await requireRulesetViewer(id);
    assertCanEditDraft(actor, definition);

    const rate = await checkRateLimit('ruleset-write', player.playerId, WRITE_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    try {
      await removeDefinition(actor, definition);
    } catch (err) {
      throw leagueTrashBlockError(err) ?? err;
    }
    revalidatePath('/admin/rulesets');

    logAuditEvent({
      action: 'ruleset.delete',
      actor_id: player.playerId,
      actor_name: player.name,
      resource_type: 'ruleset',
      resource_id: definition.id,
      resource_name: definition.slug,
    });

    return NextResponse.json<ApiResult<{ deleted: true }>>({ success: true, data: { deleted: true } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete ruleset');
  }
}
