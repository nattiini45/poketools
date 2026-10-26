import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { readBoundedJson } from '@/lib/format-studio/api-body';
import {
  seasonFormatAttachSchema,
  seasonFormatQuerySchema,
  validationFailedResponse,
} from '@/lib/format-studio/api-schemas';
import { attachFormatToSeason, detachFormatFromSeason, type AttachedStage } from '@/lib/format-studio/attach';
import type { EngineGap, SeasonFormatSummary } from '@/lib/format-studio/library-types';
import { isSeasonStarted } from '@/lib/season/season-started';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getSeasonFormat, getSeasonFormatSummary, getSeasonStartSignals } from '@/lib/supabase/queries/season-formats';
import { logAuditEvent } from '@/lib/audit/log';
import { expireSeasonReads } from '@/lib/revalidation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { FormatDefinition } from '@/lib/format-kit/client';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ATTACH_LIMIT = { limit: 30, windowSeconds: 60 * 60 } as const;

export interface SeasonFormatState {
  /** `not_custom`: the league uses a legacy type; `unattached`: custom without a format; `attached`. */
  status: 'not_custom' | 'unattached' | 'attached';
  /** False for a custom league without an attached format: it cannot start. */
  can_start: boolean;
  started: boolean;
  season_format: SeasonFormatSummary | null;
  spec?: FormatDefinition;
}

export interface SeasonFormatAttachResult {
  season_format: SeasonFormatSummary;
  stages: AttachedStage[];
  warnings: EngineGap[];
}

function seasonNotFound(): UserFacingError {
  return new UserFacingError('Season not found', { code: 'season_not_found', status: 404 });
}

/**
 * GET /api/seasons/[id]/format
 *
 * League admin (or site admin). Whether the league's format is attached, whether the league can start, and (with
 * `?include=spec`) the frozen spec. The seed and the amendments never leave the server.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('season', id);

    const query = seasonFormatQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!query.success) return validationFailedResponse(query.error);

    const season = await getSeasonById(id);
    if (season === null) throw seasonNotFound();

    const custom = season.format_type === 'custom';
    const [summary, signals] = await Promise.all([
      custom ? getSeasonFormatSummary(id) : Promise.resolve(null),
      getSeasonStartSignals(id),
    ]);
    const status: SeasonFormatState['status'] = !custom ? 'not_custom' : summary === null ? 'unattached' : 'attached';
    const state: SeasonFormatState = {
      status,
      can_start: status !== 'unattached',
      started: signals !== null && isSeasonStarted(signals),
      season_format: summary,
    };
    if (query.data.include === 'spec' && summary !== null) {
      const full = await getSeasonFormat(id);
      if (full !== null) state.spec = full.spec;
    }
    return NextResponse.json<ApiResult<SeasonFormatState>>({ success: true, data: state });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load league format');
  }
}

/**
 * POST /api/seasons/[id]/format
 *
 * League admin (or site admin). Attaches a published format version to a custom league that has not started:
 * freezes the spec and creates one phase per format stage. 201 for a first attach, 200 when it replaced an
 * earlier one. `warnings` lists what the engine does not run yet (codes and params).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('season', id);

    const rate = await checkRateLimit('format-attach', admin.playerId, ATTACH_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = seasonFormatAttachSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const outcome = await attachFormatToSeason({
      actor: admin,
      seasonId: id,
      definitionId: parsed.data.definition_id,
      versionNo: parsed.data.version_no,
    });
    expireSeasonReads(id, outcome.touched_stage_ids);

    logAuditEvent({
      action: 'season.format.attach',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'season',
      resource_id: id,
      metadata: {
        definition_id: outcome.definition.id,
        version_no: outcome.version_no,
        spec_hash: outcome.spec_hash,
        stage_count: outcome.stages.length,
        replaced: outcome.replaced,
      },
    });

    return NextResponse.json<ApiResult<SeasonFormatAttachResult>>(
      {
        success: true,
        data: { season_format: outcome.season_format, stages: outcome.stages, warnings: outcome.warnings },
      },
      { status: outcome.replaced ? 200 : 201 },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to attach format');
  }
}

/**
 * DELETE /api/seasons/[id]/format
 *
 * League admin (or site admin). Detaches the format from a league that has not started and removes the phases it
 * created. 404 `format_nothing_attached`, 409 `format_season_started`, 409 `format_detach_blocked` (teams still
 * point at a phase).
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('season', id);

    const rate = await checkRateLimit('format-attach', admin.playerId, ATTACH_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const { removed_stage_ids } = await detachFormatFromSeason(id);
    expireSeasonReads(id, removed_stage_ids);

    logAuditEvent({
      action: 'season.format.detach',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'season',
      resource_id: id,
      metadata: { removed_stage_count: removed_stage_ids.length },
    });

    return NextResponse.json<ApiResult<{ removed_stage_ids: string[] }>>({
      success: true,
      data: { removed_stage_ids },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to detach format');
  }
}
