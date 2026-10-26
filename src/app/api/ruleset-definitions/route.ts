import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { assertEnvelopeDocument, readBoundedJson } from '@/lib/ruleset-studio/api-body';
import { rulesetCreateSchema, rulesetListQuerySchema, validationFailedResponse } from '@/lib/ruleset-studio/api-schemas';
import { createFromBody, toActor, type CreatedRuleset } from '@/lib/ruleset-studio/library';
import type { RulesetDefinitionSummary } from '@/lib/ruleset-studio/library-types';
import { logAuditEvent } from '@/lib/audit/log';
import { listRulesetDefinitions } from '@/lib/supabase/queries/ruleset-definitions';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

export interface RulesetListResult {
  items: RulesetDefinitionSummary[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * GET /api/ruleset-definitions
 *
 * Admin tiers only. Lists the rulesets the caller may see: their own, and those shared with all admins (`league` or
 * `gallery`); site admins see every row. The public, read-only ruleset API is `GET /api/rulesets` (unchanged URL and shape).
 */
export async function GET(request: NextRequest) {
  try {
    const player = await requireAnyAdmin();

    const parsed = rulesetListQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) return validationFailedResponse(parsed.error);
    const query = parsed.data;

    const { items, total } = await listRulesetDefinitions({
      actor: toActor(player),
      // The gallery is the rows shared with everyone: the visibility filter does the work.
      scope: query.scope === 'gallery' ? 'all' : query.scope,
      visibility: query.scope === 'gallery' ? 'gallery' : query.visibility,
      kind: query.kind,
      limit: query.limit,
      offset: query.offset,
    });
    return NextResponse.json<ApiResult<RulesetListResult>>({
      success: true,
      data: { items, total, limit: query.limit, offset: query.offset },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to list rulesets');
  }
}

/**
 * POST /api/ruleset-definitions
 *
 * Admin tiers only. Creates a private custom ruleset owned by the caller, from a whole document or from a name (a blank
 * start, or a copy of a catalog preset). Order: guard, rate limit, bounded body, document pre-check, envelope, then the
 * database.
 */
export async function POST(request: NextRequest) {
  try {
    const player = await requireAnyAdmin();

    const rate = await checkRateLimit('ruleset-create', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const raw = await readBoundedJson(request);
    assertEnvelopeDocument(raw);
    const parsed = rulesetCreateSchema.safeParse(raw);
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const created = await createFromBody(player, parsed.data);
    revalidatePath('/admin/rulesets');

    logAuditEvent({
      action: 'ruleset.create',
      actor_id: player.playerId,
      actor_name: player.name,
      resource_type: 'ruleset',
      resource_id: created.definition.id,
      resource_name: created.definition.slug,
    });

    return NextResponse.json<ApiResult<CreatedRuleset>>({ success: true, data: created }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create ruleset');
  }
}
