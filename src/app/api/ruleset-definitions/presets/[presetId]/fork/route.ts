import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readBoundedJsonOrEmpty } from '@/lib/ruleset-studio/api-body';
import { presetForkSchema, validationFailedResponse } from '@/lib/ruleset-studio/api-schemas';
import { forkPreset, type CreatedRuleset } from '@/lib/ruleset-studio/library';
import { logAuditEvent } from '@/lib/audit/log';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ presetId: string }>;
}

/**
 * POST /api/ruleset-definitions/presets/[presetId]/fork
 *
 * Admin tiers. Starts a new private ruleset owned by the caller from a catalog preset (`gen9ou`, `gen9natdexdraft`, ...): the
 * preset as the base and, with `tour_overlay`, the preset's documented Smogon tour clauses and bans as ordinary editable
 * entries (a 400 for a preset that has none). An id the catalog does not know is 404 `ruleset_preset_unknown`. The body is
 * optional; its members are a slug and `tour_overlay`.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requireAnyAdmin();
    const { presetId } = await params;

    const rate = await checkRateLimit('ruleset-create', player.playerId, { limit: 20, windowSeconds: 60 * 60 });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = presetForkSchema(presetId).safeParse(await readBoundedJsonOrEmpty(request));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const created = await forkPreset(player, presetId, { slug: parsed.data.slug, tourOverlay: parsed.data.tour_overlay });
    revalidatePath('/admin/rulesets');

    logAuditEvent({
      action: 'ruleset.fork',
      actor_id: player.playerId,
      actor_name: player.name,
      resource_type: 'ruleset',
      resource_id: created.definition.id,
      resource_name: created.definition.slug,
      metadata: { preset: presetId, ...(parsed.data.tour_overlay === true ? { tour_overlay: true } : {}) },
    });

    return NextResponse.json<ApiResult<CreatedRuleset>>({ success: true, data: created }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to start a ruleset from a preset');
  }
}
